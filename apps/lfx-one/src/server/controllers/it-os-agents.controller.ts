// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { IT_OS_CHAT_MESSAGE_MAX_CHARS, IT_OS_GUILD_AGENTS, IT_OS_PROJECT_UID_REGEX } from '@lfx-one/shared/constants';
import { ItOsGuildChatRequest, ItOsGuildChatResponse, ItOsGuildHistoryRequest, ItOsGuildHistoryResponse } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, AuthorizationError, MicroserviceError, ServiceValidationError } from '../errors';
import { GuildService } from '../services/guild.service';
import { logger } from '../services/logger.service';
import { ProjectService } from '../services/project.service';
import { getEffectiveSub } from '../utils/auth-helper';
import { createSessionOwnerToken, verifySessionOwnerToken } from '../utils/mktg-session-token.util';

/** The first message carries the project slug on its own line, ahead of what the user typed. */
const PROJECT_LINE_RE = /^Project slug: [^\n]*\n\n/;

/**
 * IT OS live agents (#4257): a thin proxy from the IT OS chat to its agents on Guild.
 *
 * - Dev only. Every call is refused unless GUILD_IT_OS_WORKSPACE_NAME is set, and that is set only in dev.
 * - The caller must have write access to the project. The server looks up the project's slug and puts it
 *   in the first message itself, so the browser never chooses which project the agent works on.
 * - Sessions are bound to the user who started them and to the project and agent (owner token), and
 *   every follow-up and history read re-checks write access.
 */
export class ItOsAgentsController {
  private readonly projectService = new ProjectService();

  /**
   * POST /api/it-os-agents/chat
   * No sessionId → start a session and return `{ sessionId, ownerToken }`.
   * With sessionId → check the owner token, post a follow-up and return `{ success: true }`.
   */
  public async chat(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { agentId, project, message, sessionId, ownerToken } = (req.body ?? {}) as Partial<ItOsGuildChatRequest>;
    const context = { operation: 'it_os_agents_chat', service: 'it_os_agents_controller', path: req.path };

    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) {
      next(ServiceValidationError.forField('message', 'message is required and must be a non-empty string', context));
      return;
    }
    if (text.length > IT_OS_CHAT_MESSAGE_MAX_CHARS) {
      next(ServiceValidationError.forField('message', `message must be at most ${IT_OS_CHAT_MESSAGE_MAX_CHARS} characters`, context));
      return;
    }

    try {
      const { guild, handle, userId, projectUid } = this.checkRequest(req, agentId, project, context);
      const validSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined;
      const startTime = logger.startOperation(req, 'it_os_agents_chat', { agent_id: agentId, has_session: !!validSessionId });

      if (validSessionId && !verifySessionOwnerToken(ownerToken, userId, this.binding(agentId as string, projectUid, validSessionId))) {
        throw new AuthorizationError('You do not have permission to post to this session.', context);
      }

      const slug = await this.writableProjectSlug(req, projectUid, context);

      if (!validSessionId) {
        const newSessionId = await guild.createSession(req, { message: `Project slug: ${slug}\n\n${text}`, handle });
        logger.success(req, 'it_os_agents_chat', startTime, { agent_id: agentId, session_created: true });
        const response: ItOsGuildChatResponse = {
          sessionId: newSessionId,
          ownerToken: createSessionOwnerToken(userId, this.binding(agentId as string, projectUid, newSessionId)),
        };
        res.json(response);
        return;
      }

      await guild.sendFollowUp(req, validSessionId, { message: text, handle });
      logger.success(req, 'it_os_agents_chat', startTime, { agent_id: agentId, session_created: false });
      const response: ItOsGuildChatResponse = { success: true };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/it-os-agents/history
   * Returns the session's messages. POST so the owner token stays out of URLs and access logs.
   */
  public async history(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { agentId, project, sessionId, ownerToken } = (req.body ?? {}) as Partial<ItOsGuildHistoryRequest>;
    const context = { operation: 'it_os_agents_history', service: 'it_os_agents_controller', path: req.path };

    const validSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined;
    if (!validSessionId) {
      next(ServiceValidationError.forField('sessionId', 'sessionId is required and must be a non-empty string', context));
      return;
    }

    try {
      const { guild, userId, projectUid } = this.checkRequest(req, agentId, project, context);
      if (!verifySessionOwnerToken(ownerToken, userId, this.binding(agentId as string, projectUid, validSessionId))) {
        throw new AuthorizationError('You do not have permission to read this session.', context);
      }
      await this.writableProjectSlug(req, projectUid, context);

      const startTime = logger.startOperation(req, 'it_os_agents_history', { agent_id: agentId });
      const messages = (await guild.getHistory(req, validSessionId)).map((m) =>
        m.sender === 'user' ? { ...m, text: m.text.replace(PROJECT_LINE_RE, '') } : m
      );
      logger.success(req, 'it_os_agents_history', startTime, { message_count: messages.length });
      const response: ItOsGuildHistoryResponse = { messages };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** Checks that the route is configured, the agent is live, the user is known and the project uid is well formed. */
  private checkRequest(
    req: Request,
    agentId: unknown,
    project: unknown,
    context: Record<string, string>
  ): { guild: GuildService; handle: string; userId: string; projectUid: string } {
    const workspace = process.env['GUILD_IT_OS_WORKSPACE_NAME']?.trim();
    if (!workspace) {
      throw new MicroserviceError('IT OS agents are not available in this environment.', 503, 'IT_OS_NOT_CONFIGURED', context);
    }

    const handle = typeof agentId === 'string' ? IT_OS_GUILD_AGENTS[agentId] : undefined;
    if (!handle || !Object.hasOwn(IT_OS_GUILD_AGENTS, agentId as string)) {
      throw ServiceValidationError.forField('agentId', 'This IT OS agent is not available for chat.', context);
    }

    const projectUid = typeof project === 'string' ? project.trim() : '';
    if (!IT_OS_PROJECT_UID_REGEX.test(projectUid)) {
      throw ServiceValidationError.forField('project', 'A single-segment project uid is required.', context);
    }

    const userId = getEffectiveSub(req);
    if (!userId) {
      throw new AuthenticationError('Could not identify the requesting user.', context);
    }

    return { guild: new GuildService(workspace), handle, userId, projectUid };
  }

  /** Looks up the project with the caller's own token and requires write access. Returns its slug. */
  private async writableProjectSlug(req: Request, projectUid: string, context: Record<string, string>): Promise<string> {
    const found = await this.projectService.getProjectById(req, projectUid, true);
    if (!found.writer) {
      throw new AuthorizationError('You need write access to use this project’s IT OS agents.', context);
    }
    return found.slug;
  }

  /** What an owner token is bound to: the agent, the project and the session. */
  private binding(agentId: string, projectUid: string, sessionId: string): string {
    return `it-os:${agentId}:${projectUid}:${sessionId}`;
  }
}
