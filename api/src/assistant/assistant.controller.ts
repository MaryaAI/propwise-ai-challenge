import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuthAgent, CurrentAgent } from '../auth/decorators';
import { ActionsService } from './actions.service';
import { CreateRunDto } from './assistant.dto';
import { toAssistantRunDto } from './assistant.mapper';
import { AssistantService } from './assistant.service';

@Controller()
export class AssistantController {
  constructor(
    private readonly assistantService: AssistantService,
    private readonly actionsService: ActionsService,
  ) {}

  @Post('leads/:leadId/assistant/runs')
  async createRun(@CurrentAgent() agent: AuthAgent, @Param('leadId', ParseUUIDPipe) leadId: string, @Body() dto: CreateRunDto) {
    const { run, actions, agentTimezone } = await this.assistantService.run({
      agencyId: agent.agencyId,
      agentId: agent.id,
      leadId,
      messageId: dto.messageId,
    });
    return toAssistantRunDto(run, actions, agentTimezone);
  }

  @Get('leads/:leadId/assistant/runs/:runId')
  async getRun(
    @CurrentAgent() agent: AuthAgent,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    const result = await this.assistantService.getRun(agent.agencyId, leadId, runId);
    if (!result) throw new NotFoundException('Run not found');
    return toAssistantRunDto(result.run, result.actions, result.run.createdBy.timezone);
  }

  @Post('leads/:leadId/assistant/runs/:runId/actions/:actionId/approve')
  @HttpCode(200)
  approve(
    @CurrentAgent() agent: AuthAgent,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
  ) {
    return this.actionsService.approve(agent.agencyId, leadId, runId, actionId, agent.id);
  }

  @Post('leads/:leadId/assistant/runs/:runId/actions/:actionId/reject')
  @HttpCode(200)
  reject(
    @CurrentAgent() agent: AuthAgent,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
  ) {
    return this.actionsService.reject(agent.agencyId, leadId, runId, actionId, agent.id);
  }
}
