// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_AGENTS } from '@lfx-one/shared/constants';
import { MktgChatRequest, MktgChatResponse, MktgHistoryResponse } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, AuthorizationError, ServiceValidationError } from '../errors';
import { getStringQueryParam } from '../helpers/validation.helper';
import { GuildService } from '../services/guild.service';
import { logger } from '../services/logger.service';
import { getEffectiveSub } from '../utils/auth-helper';
import { createSessionOwnerToken, verifySessionOwnerToken } from '../utils/mktg-session-token.util';

export class MktgAgentsController {
  private readonly guildService = new GuildService();

  /**
   * POST /api/mktg-agents/chat
   * No sessionId → create a session and return `{ sessionId }`.
   * With sessionId → post a follow-up and return `{ success: true }`.
   */
  public async chat(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { agentId, message, sessionId, ownerToken } = req.body as MktgChatRequest;

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

    // Identify the caller so sessions can be bound to their creator. On a
    // protected route the sub is always present; guard defensively.
    const userId = getEffectiveSub(req);
    if (!userId) {
      next(new AuthenticationError('Could not identify the requesting user.', { operation: 'mktg_agents_chat', service: 'mktg_agents_controller', path: req.path }));
      return;
    }

    const validSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined;
    const startTime = logger.startOperation(req, 'mktg_agents_chat', { agent_id: trimmedAgentId, has_session: !!validSessionId });

    try {
      if (!validSessionId) {
        // New session: bind it to the creator via an opaque owner token.
        const newSessionId = await this.guildService.createSession(req, { message: message.trim(), handle: agent.guildAgentHandle });
        logger.success(req, 'mktg_agents_chat', startTime, { agent_id: trimmedAgentId, session_created: true });
        const response: MktgChatResponse = { sessionId: newSessionId, ownerToken: createSessionOwnerToken(userId, newSessionId) };
        res.json(response);
        return;
      }

      // Follow-up: only the session's creator may post into it (reads stay open).
      if (!verifySessionOwnerToken(ownerToken, userId, validSessionId)) {
        next(new AuthorizationError('You do not have permission to post to this session.', { operation: 'mktg_agents_chat', service: 'mktg_agents_controller' }));
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
    const sessionId = getStringQueryParam(req, 'sessionId')?.trim() || undefined;

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
