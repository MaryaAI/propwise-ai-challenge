import { Inject, Injectable } from '@nestjs/common';
import { generateText, NoObjectGeneratedError, Output } from 'ai';
import { AssistantModelFactory, ASSISTANT_MODEL_FACTORY } from '../model';
import { Evidence, FollowUpTiming, RequirementsState, Sourced } from '../types';
import { amountMatchesEvidence, quoteExists } from './normalize';
import { Extraction, ExtractionSchema } from './extraction.schema';
import { buildExtractionRepairPrompt, buildExtractionSystemPrompt, buildExtractionUserPrompt, ConversationMessage } from './prompts';

export class ExtractionFailedError extends Error {}

export interface RejectedField {
  field: string;
  reason: string;
}

export interface ExtractionResult {
  update: Partial<RequirementsState>;
  intent: Extraction['intent'];
  closed: boolean;
  followUp: FollowUpTiming | null;
  propertyRefs: string[];
  rejected: RejectedField[];
}

type ExtractionField<T> = { value: T | null; evidence: Evidence | null; status: 'stated' | 'missing' | 'ambiguous' };

function sourced<T>(value: T, evidence: Evidence): Sourced<T> {
  return { value, source: evidence.sourceId, evidence };
}

@Injectable()
export class Extractor {
  constructor(@Inject(ASSISTANT_MODEL_FACTORY) private readonly modelFactory: AssistantModelFactory) {}

  async extract(input: {
    agencyName: string;
    areas: string[];
    conversation: ConversationMessage[];
    analysedMessageId: string;
    abortSignal?: AbortSignal;
  }): Promise<ExtractionResult> {
    const system = buildExtractionSystemPrompt();
    const prompt = buildExtractionUserPrompt(input);
    const raw = await this.generate(system, prompt, input.abortSignal);
    return this.validate(raw, input);
  }

  private async generate(system: string, prompt: string, abortSignal?: AbortSignal): Promise<Extraction> {
    try {
      const result = await generateText({ model: this.modelFactory(), system, prompt, output: Output.object({ schema: ExtractionSchema }), abortSignal });
      return result.output;
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error)) throw error;
      const cause = String(error.cause ?? error.message);
      try {
        const result = await generateText({
          model: this.modelFactory(),
          system,
          prompt: buildExtractionRepairPrompt(prompt, cause),
          output: Output.object({ schema: ExtractionSchema }),
          abortSignal,
        });
        return result.output;
      } catch (retryError) {
        throw new ExtractionFailedError(`Extraction failed after a retry: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
      }
    }
  }

  private validate(raw: Extraction, input: { conversation: ConversationMessage[]; areas: string[] }): ExtractionResult {
    const rejected: RejectedField[] = [];
    const sourceById = new Map(input.conversation.map((m) => [m.id, m]));
    const areaByLower = new Map(input.areas.map((a) => [a.toLowerCase(), a]));

    const hasValidEvidence = (field: ExtractionField<unknown>): boolean => {
      if (field.status !== 'stated' || field.evidence === null) return false;
      const source = sourceById.get(field.evidence.sourceId);
      if (!source) return false;
      return quoteExists(field.evidence.quote, source.body);
    };

    const update: Partial<RequirementsState> = {};

    if (hasValidEvidence(raw.locations) && raw.locations.value) {
      const canonical: string[] = [];
      for (const loc of raw.locations.value) {
        const match = areaByLower.get(loc.toLowerCase());
        if (match) canonical.push(match);
        else rejected.push({ field: 'locations', reason: `"${loc}" is not one of this agency's areas` });
      }
      if (canonical.length > 0) update.locations = sourced(canonical, raw.locations.evidence!);
    } else if (raw.locations.status === 'stated') {
      rejected.push({ field: 'locations', reason: 'evidence quote not found in the cited message' });
    }

    if (hasValidEvidence(raw.bedrooms) && raw.bedrooms.value) {
      const { min, max } = raw.bedrooms.value;
      if (min <= max) update.bedrooms = sourced({ min, max }, raw.bedrooms.evidence!);
      else rejected.push({ field: 'bedrooms', reason: `min (${min}) is greater than max (${max})` });
    } else if (raw.bedrooms.status === 'stated') {
      rejected.push({ field: 'bedrooms', reason: 'evidence quote not found in the cited message' });
    }

    if (hasValidEvidence(raw.budget) && raw.budget.value) {
      const { minAed, maxAed, qualifier } = raw.budget.value;
      const quote = raw.budget.evidence!.quote;
      const claimed = maxAed ?? minAed;
      if (claimed === null || amountMatchesEvidence(claimed, quote)) {
        update.budget = sourced({ minAed, maxAed, qualifier }, raw.budget.evidence!);
      } else {
        rejected.push({ field: 'budget', reason: `claimed amount does not match the evidence quote "${quote}"` });
      }
    } else if (raw.budget.status === 'stated') {
      rejected.push({ field: 'budget', reason: 'evidence quote not found in the cited message' });
    }

    if (hasValidEvidence(raw.propertyType) && raw.propertyType.value) {
      update.propertyType = sourced(raw.propertyType.value, raw.propertyType.evidence!);
    } else if (raw.propertyType.status === 'stated') {
      rejected.push({ field: 'propertyType', reason: 'evidence quote not found in the cited message' });
    }

    if (hasValidEvidence(raw.transaction) && raw.transaction.value) {
      update.transaction = sourced(raw.transaction.value, raw.transaction.evidence!);
    } else if (raw.transaction.status === 'stated') {
      rejected.push({ field: 'transaction', reason: 'evidence quote not found in the cited message' });
    }

    const preferences: Sourced<string>[] = [];
    for (const pref of raw.preferences) {
      const source = sourceById.get(pref.evidence.sourceId);
      if (!source || !quoteExists(pref.evidence.quote, source.body)) {
        rejected.push({ field: 'preferences', reason: `evidence for "${pref.text}" not found in the cited message` });
        continue;
      }
      preferences.push(sourced(pref.text, pref.evidence));
    }
    if (preferences.length > 0) update.preferences = preferences;

    let followUp: FollowUpTiming | null = null;
    if (hasValidEvidence(raw.followUp) && raw.followUp.value) {
      const { kind, weekday, days, time } = raw.followUp.value;
      followUp = { kind, weekday, days, time, raw: raw.followUp.evidence!.quote };
    } else if (raw.followUp.status === 'stated') {
      rejected.push({ field: 'followUp', reason: 'evidence quote not found in the cited message' });
    }

    return { update, intent: raw.intent, closed: raw.closed, followUp, propertyRefs: raw.propertyRefs, rejected };
  }
}
