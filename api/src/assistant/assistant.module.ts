import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { AgentRunner } from './agent/agent-runner';
import { PropertyQuery } from './agent/property-query';
import { ToolsFactory } from './agent/tools';
import { AssistantService } from './assistant.service';
import { Extractor } from './extraction/extractor';
import { assistantModelFactoryProvider } from './model';

@Module({
  imports: [LeadsModule],
  providers: [assistantModelFactoryProvider, PropertyQuery, ToolsFactory, Extractor, AgentRunner, AssistantService],
})
export class AssistantModule {}
