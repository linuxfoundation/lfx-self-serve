// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_AGENTS } from '@lfx-one/shared/constants';
import { MktgChatRequest, MktgChatResponse, MktgHistoryResponse } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { GuildService } from '../services/guild.service';
import { logger } from '../services/logger.service';

export class MktgAgentsController {
  private readonly guildService = new GuildService();

  /**
   * POST /api/mktg-agents/chat
   * No sessionId → create a session and return `{ sessionId }`.
   * With sessionId → post a follow-up and return `{ success: true }`.
   */
  public async chat(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { agentId, message, sessionId } = req.body as MktgChatRequest;

    if (!message || typeof message !== 'string' || !message.trim()) {
      next(
        ServiceValidationError.forField('message', 'message is required and must be a non-empty string', {
          operation: 'mktg_agents_chat',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    const trimmedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
    if (!trimmedAgentId) {
      next(
        ServiceValidationError.forField('agentId', 'agentId is required', {
          operation: 'mktg_agents_chat',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    const agent = MKTG_AGENTS.find((candidate) => candidate.id === trimmedAgentId);
    if (!agent) {
      next(
        ServiceValidationError.forField('agentId', `Unknown agentId: ${trimmedAgentId}`, {
          operation: 'mktg_agents_chat',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    // Only `active` agents have a live Guild handle; reject `coming-soon` agents
    // so a placeholder can never be routed to a default/incorrect Guild agent.
    if (agent.status !== 'active') {
      next(
        ServiceValidationError.forField('agentId', `Agent is not available for chat: ${trimmedAgentId}`, {
          operation: 'mktg_agents_chat',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    const validSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined;
    const startTime = logger.startOperation(req, 'mktg_agents_chat', { agent_id: trimmedAgentId, has_session: !!validSessionId });

    try {
      if (!validSessionId) {
        const newSessionId = await this.guildService.createSession(req, { message: message.trim(), handle: agent.guildAgentHandle });
        logger.success(req, 'mktg_agents_chat', startTime, { agent_id: trimmedAgentId, session_created: true });
        const response: MktgChatResponse = { sessionId: newSessionId };
        res.json(response);
        return;
      }

      await this.guildService.sendFollowUp(req, validSessionId, { message: message.trim(), handle: agent.guildAgentHandle });
      logger.success(req, 'mktg_agents_chat', startTime, { agent_id: trimmedAgentId, session_created: false });
      const response: MktgChatResponse = { success: true };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/mktg-agents/history?sessionId=
   * Returns the session's messages mapped to the chat format.
   */
  public async history(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawSessionId = req.query['sessionId'];
    const sessionId = typeof rawSessionId === 'string' && rawSessionId.trim() ? rawSessionId.trim() : undefined;

    if (!sessionId) {
      next(
        ServiceValidationError.forField('sessionId', 'sessionId query parameter is required', {
          operation: 'mktg_agents_history',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    const startTime = logger.startOperation(req, 'mktg_agents_history', {});

    try {
      const messages = await this.guildService.getHistory(req, sessionId);
      logger.success(req, 'mktg_agents_history', startTime, { message_count: messages.length });
      const response: MktgHistoryResponse = { messages };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}
