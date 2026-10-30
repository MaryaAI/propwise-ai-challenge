import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { ActionsService } from './actions.service';
import { AgentRunner } from './agent/agent-runner';
import { PropertyQuery } from './agent/property-query';
import { ToolsFactory } from './agent/tools';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { Extractor } from './extraction/extractor';
import { assistantModelFactoryProvider } from './model';

@Module({
  imports: [LeadsModule],
  controllers: [AssistantController],
  providers: [assistantModelFactoryProvider, PropertyQuery, ToolsFactory, Extractor, AgentRunner, AssistantService, ActionsService],
})
export class AssistantModule {}
