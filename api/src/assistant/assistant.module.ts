import { Module } from '@nestjs/common';
import { PropertyQuery } from './agent/property-query';
import { ToolsFactory } from './agent/tools';
import { assistantModelFactoryProvider } from './model';

@Module({
  providers: [assistantModelFactoryProvider, PropertyQuery, ToolsFactory],
})
export class AssistantModule {}
