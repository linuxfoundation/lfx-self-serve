// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_AGENTS } from '@lfx-one/shared/constants';
import {
  BrandKitGenerateRequest,
  BrandKitGenerateResponse,
  BrandKitResultRequest,
  BrandKitResultResponse,
  FoundationMessageGenerateRequest,
  FoundationMessageGenerateResponse,
  FoundationMessageResultRequest,
  FoundationMessageResultResponse,
  MktgChatRequest,
  MktgChatResponse,
  MktgHistoryRequest,
  MktgHistoryResponse,
} from '@lfx-one/shared/interfaces';
import { validateBrandKitIntakeAnswers, validateFoundationMessageIntakeAnswers } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, AuthorizationError, ServiceValidationError } from '../errors';
import { BrandKitService } from '../services/brand-kit.service';
import { FoundationMessageService } from '../services/foundation-message.service';
import { GuildService } from '../services/guild.service';
import { logger } from '../services/logger.service';
import { getEffectiveSub } from '../utils/auth-helper';
import { createSessionOwnerToken, verifySessionOwnerToken } from '../utils/mktg-session-token.util';

export class MktgAgentsController {
  private readonly guildService = new GuildService();
  private readonly brandKitService = new BrandKitService();
  private readonly foundationMessageService = new FoundationMessageService();

  /**
   * POST /api/mktg-agents/chat
   * No sessionId → create a session and return `{ sessionId, ownerToken }`.
   * With sessionId → verify the owner token, post a follow-up, return `{ success: true }`.
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
      next(
        new AuthenticationError('Could not identify the requesting user.', { operation: 'mktg_agents_chat', service: 'mktg_agents_controller', path: req.path })
      );
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

      // Follow-up: only the session's creator may post into it (reads are
      // owner-gated too — see history()).
      if (!verifySessionOwnerToken(ownerToken, userId, validSessionId)) {
        next(
          new AuthorizationError('You do not have permission to post to this session.', { operation: 'mktg_agents_chat', service: 'mktg_agents_controller' })
        );
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
   * POST /api/mktg-agents/history
   * Returns the session's messages mapped to the chat format.
   * Session transcripts can carry sensitive user input (e.g. the Brand Kit
   * intake answers ride the trigger_message), so reads require the same
   * creator-binding owner-token proof as writes — a session id alone must
   * never unlock another user's transcript. POST (not GET) so the owner
   * token travels in the body and stays out of access logs and proxies.
   */
  public async history(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { sessionId, ownerToken } = (req.body ?? {}) as Partial<MktgHistoryRequest>;

    const validSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined;
    if (!validSessionId) {
      next(
        ServiceValidationError.forField('sessionId', 'sessionId is required and must be a non-empty string', {
          operation: 'mktg_agents_history',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    const userId = getEffectiveSub(req);
    if (!userId) {
      next(
        new AuthenticationError('Could not identify the requesting user.', {
          operation: 'mktg_agents_history',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    const validOwnerToken = typeof ownerToken === 'string' && ownerToken.trim() ? ownerToken.trim() : undefined;
    if (!verifySessionOwnerToken(validOwnerToken, userId, validSessionId)) {
      next(
        new AuthorizationError('You do not have permission to read this session.', {
          operation: 'mktg_agents_history',
          service: 'mktg_agents_controller',
        })
      );
      return;
    }

    const startTime = logger.startOperation(req, 'mktg_agents_history', {});

    try {
      const messages = await this.guildService.getHistory(req, validSessionId);
      logger.success(req, 'mktg_agents_history', startTime, { message_count: messages.length });
      const response: MktgHistoryResponse = { messages };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/brand-kit/generate
   * Starts a one-shot form-mode Brand Kit generation from the one-page
   * intake form (all 7 answers, dec-brand-kit-intake-form). Returns the
   * session id + creator-binding owner token for polling the result.
   */
  public async generateBrandKit(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { answers } = (req.body ?? {}) as Partial<BrandKitGenerateRequest>;

    const answersResult = validateBrandKitIntakeAnswers(answers);
    if (!answersResult.valid) {
      next(
        ServiceValidationError.forField('answers', answersResult.errors.join('; '), {
          operation: 'brand_kit_generate',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    const userId = getEffectiveSub(req);
    if (!userId) {
      next(
        new AuthenticationError('Could not identify the requesting user.', {
          operation: 'brand_kit_generate',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    // Routing handle comes from the shared catalog only — never the client.
    const agent = MKTG_AGENTS.find((candidate) => candidate.id === 'brand-kit');
    if (!agent || agent.status !== 'active') {
      next(
        ServiceValidationError.forField('agentId', 'The Brand Kit agent is not available.', {
          operation: 'brand_kit_generate',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    const startTime = logger.startOperation(req, 'brand_kit_generate', {});

    try {
      // Safe: validateBrandKitIntakeAnswers guaranteed a complete string record.
      const trimmedAnswers = Object.fromEntries(Object.entries(answers as Record<string, string>).map(([key, value]) => [key, value.trim()]));
      const sessionId = await this.brandKitService.startGeneration(req, trimmedAnswers, agent.guildAgentHandle);
      logger.success(req, 'brand_kit_generate', startTime, { session_created: true });
      const response: BrandKitGenerateResponse = { sessionId, ownerToken: createSessionOwnerToken(userId, sessionId) };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/brand-kit/result
   * Polls a generation session for the validated Brand Kit document.
   * Only the session's creator may read the result (owner-token proof).
   */
  public async brandKitResult(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { sessionId, ownerToken } = (req.body ?? {}) as Partial<BrandKitResultRequest>;

    const validSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined;
    if (!validSessionId) {
      next(
        ServiceValidationError.forField('sessionId', 'sessionId is required and must be a non-empty string', {
          operation: 'brand_kit_result',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    const userId = getEffectiveSub(req);
    if (!userId) {
      next(
        new AuthenticationError('Could not identify the requesting user.', {
          operation: 'brand_kit_result',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    // Type-gate body fields — never rely on downstream defensive coercion.
    const validOwnerToken = typeof ownerToken === 'string' && ownerToken ? ownerToken : undefined;
    if (!verifySessionOwnerToken(validOwnerToken, userId, validSessionId)) {
      next(
        new AuthorizationError('You do not have permission to read this session.', {
          operation: 'brand_kit_result',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    const startTime = logger.startOperation(req, 'brand_kit_result', {});

    try {
      const result: BrandKitResultResponse = await this.brandKitService.getResult(req, validSessionId);
      logger.success(req, 'brand_kit_result', startTime, { status: result.status });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/foundation-message/generate
   * Starts a one-shot form-mode Message Foundation generation from the
   * batch intake form. The answers are validated against the agent's
   * conditional form contract (discovery answers required exactly when no
   * Brand Kit markdown is provided); regenerations arrive as a full resubmit
   * with `feedback` + `priorVersion` and run on a fresh session. Returns the
   * session id + creator-binding owner token for polling the result.
   */
  public async generateFoundationMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { answers, feedback, priorVersion } = (req.body ?? {}) as Partial<FoundationMessageGenerateRequest>;

    const answersResult = validateFoundationMessageIntakeAnswers(answers);
    if (!answersResult.valid) {
      next(
        ServiceValidationError.forField('answers', answersResult.errors.join('; '), {
          operation: 'foundation_message_generate',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    // Type-gate the regeneration fields — never rely on downstream coercion.
    if (feedback !== undefined && typeof feedback !== 'string') {
      next(
        ServiceValidationError.forField('feedback', 'feedback must be a string when provided', {
          operation: 'foundation_message_generate',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }
    if (priorVersion !== undefined && (typeof priorVersion !== 'number' || !Number.isInteger(priorVersion) || priorVersion < 1)) {
      next(
        ServiceValidationError.forField('priorVersion', 'priorVersion must be an integer >= 1 when provided', {
          operation: 'foundation_message_generate',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    const userId = getEffectiveSub(req);
    if (!userId) {
      next(
        new AuthenticationError('Could not identify the requesting user.', {
          operation: 'foundation_message_generate',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    // Routing handle comes from the shared catalog only — never the client.
    const agent = MKTG_AGENTS.find((candidate) => candidate.id === 'foundation-setup');
    if (!agent || agent.status !== 'active') {
      next(
        ServiceValidationError.forField('agentId', 'The Message Foundation agent is not available.', {
          operation: 'foundation_message_generate',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    const startTime = logger.startOperation(req, 'foundation_message_generate', { has_feedback: !!feedback, prior_version: priorVersion ?? 0 });

    try {
      // Safe: validateFoundationMessageIntakeAnswers guaranteed a string record.
      const trimmedAnswers = Object.fromEntries(
        Object.entries(answers as Record<string, string>)
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value !== '')
      );
      const sessionId = await this.foundationMessageService.startGeneration(req, trimmedAnswers, { feedback, priorVersion }, agent.guildAgentHandle);
      logger.success(req, 'foundation_message_generate', startTime, { session_created: true });
      const response: FoundationMessageGenerateResponse = { sessionId, ownerToken: createSessionOwnerToken(userId, sessionId) };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/foundation-message/result
   * Polls a generation session for the validated Message Foundation document
   * (and its word-count-locked derivatives). Only the session's creator may
   * read the result (owner-token proof).
   */
  public async foundationMessageResult(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { sessionId, ownerToken } = (req.body ?? {}) as Partial<FoundationMessageResultRequest>;

    const validSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined;
    if (!validSessionId) {
      next(
        ServiceValidationError.forField('sessionId', 'sessionId is required and must be a non-empty string', {
          operation: 'foundation_message_result',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    const userId = getEffectiveSub(req);
    if (!userId) {
      next(
        new AuthenticationError('Could not identify the requesting user.', {
          operation: 'foundation_message_result',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    // Type-gate body fields — never rely on downstream defensive coercion.
    const validOwnerToken = typeof ownerToken === 'string' && ownerToken ? ownerToken : undefined;
    if (!verifySessionOwnerToken(validOwnerToken, userId, validSessionId)) {
      next(
        new AuthorizationError('You do not have permission to read this session.', {
          operation: 'foundation_message_result',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    const startTime = logger.startOperation(req, 'foundation_message_result', {});

    try {
      const result: FoundationMessageResultResponse = await this.foundationMessageService.getResult(req, validSessionId);
      logger.success(req, 'foundation_message_result', startTime, { status: result.status });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}
