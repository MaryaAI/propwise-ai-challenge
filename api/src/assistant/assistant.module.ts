import { Module } from '@nestjs/common';
import { PropertyQuery } from './agent/property-query';
import { assistantModelFactoryProvider } from './model';

@Module({
  providers: [assistantModelFactoryProvider, PropertyQuery],
})
export class AssistantModule {}
