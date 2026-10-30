import { Module } from '@nestjs/common';
import { assistantModelFactoryProvider } from './model';

@Module({
  providers: [assistantModelFactoryProvider],
})
export class AssistantModule {}
