import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { Provider } from '@nestjs/common';
import type { LanguageModel } from 'ai';
import { config } from '../config';

export const ASSISTANT_MODEL_FACTORY = 'ASSISTANT_MODEL_FACTORY';

export type AssistantModelFactory = () => LanguageModel;

/**
 * Anthropic is the supported path and the default, per the brief.
 *
 * `OPENROUTER_API_KEY` is a local-development escape hatch: when it is set the model goes through
 * OpenRouter's OpenAI-compatible API instead, so the feature can still be shown when the
 * assessment key has no credit. It is unset in a normal checkout, so nothing about the delivered
 * behaviour changes.
 *
 * Two things to know if you use it. Model ids there carry a provider prefix, so
 * `ASSISTANT_MODEL=anthropic/claude-sonnet-4.5` rather than a bare name. And structured output
 * travels a different road: with Anthropic, `Output.object` uses the native output-format path,
 * while the OpenAI-compatible route depends on the chosen model supporting `json_schema`. If
 * extraction starts failing on an OpenRouter model, that is the first thing to suspect.
 */
function buildModel(): LanguageModel {
  const openRouterKey = config.openRouterApiKey();
  if (openRouterKey) {
    return createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: openRouterKey })(config.assistantModel());
  }
  return createAnthropic({ apiKey: config.anthropicApiKey() })(config.assistantModel());
}

export const assistantModelFactoryProvider: Provider = {
  provide: ASSISTANT_MODEL_FACTORY,
  useValue: buildModel,
};
