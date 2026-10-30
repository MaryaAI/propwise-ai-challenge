import { createAnthropic } from '@ai-sdk/anthropic';
import type { Provider } from '@nestjs/common';
import type { LanguageModel } from 'ai';
import { config } from '../config';

export const ASSISTANT_MODEL_FACTORY = 'ASSISTANT_MODEL_FACTORY';

export type AssistantModelFactory = () => LanguageModel;

export const assistantModelFactoryProvider: Provider = {
  provide: ASSISTANT_MODEL_FACTORY,
  useValue: (): LanguageModel => createAnthropic({ apiKey: config.anthropicApiKey() })(config.assistantModel()),
};
