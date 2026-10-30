import { Module } from '@nestjs/common';
import { AgentRunner } from './agent/agent-runner';
import { PropertyQuery } from './agent/property-query';
import { ToolsFactory } from './agent/tools';
import { Extractor } from './extraction/extractor';
import { assistantModelFactoryProvider } from './model';

@Module({
  providers: [assistantModelFactoryProvider, PropertyQuery, ToolsFactory, Extractor, AgentRunner],
})
export class AssistantModule {}
