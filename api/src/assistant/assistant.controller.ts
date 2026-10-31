import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthAgent, CurrentAgent } from '../auth/decorators';
import { ActionsService } from './actions.service';
import { ChatMessageDto, CreateRunDto, ListRunsQuery } from './assistant.dto';
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

  /** Additive (architecture section 6): a follow-up turn, returning a NEW run with parentRunId set. */
  @Post('leads/:leadId/assistant/runs/:runId/messages')
  async chat(
    @CurrentAgent() agent: AuthAgent,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: ChatMessageDto,
  ) {
    const { run, actions, agentTimezone } = await this.assistantService.chat({
      agencyId: agent.agencyId,
      agentId: agent.id,
      leadId,
      runId,
      content: dto.content,
    });
    return toAssistantRunDto(run, actions, agentTimezone);
  }

  /** Additive (architecture section 6): the run history, newest first. */
  @Get('leads/:leadId/assistant/runs')
  async listRuns(@CurrentAgent() agent: AuthAgent, @Param('leadId', ParseUUIDPipe) leadId: string, @Query() query: ListRunsQuery) {
    const { items, total } = await this.assistantService.listRuns(agent.agencyId, leadId, query.limit);
    return {
      items: items.map(({ run, actions }) => toAssistantRunDto(run, actions, run.createdBy.timezone)),
      total,
    };
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
