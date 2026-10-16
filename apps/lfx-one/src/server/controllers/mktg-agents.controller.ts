// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FOUNDATION_MESSAGE_DOCUMENT_MAX_CHARS,
  FOUNDATION_MESSAGE_DOCUMENT_TITLE_MAX_CHARS,
  FOUNDATION_MESSAGE_FILE_NAME_HEADER,
  FOUNDATION_MESSAGE_FILE_UPLOAD_CONTENT_TYPE,
  FOUNDATION_MESSAGE_READ_REASONS,
  MKTG_AGENTS,
  MKTG_ARTIFACT_PARTITION_REGEX,
} from '@lfx-one/shared/constants';
import {
  BrandKitGenerateRequest,
  BrandKitGenerateResponse,
  BrandKitResultRequest,
  BrandKitResultResponse,
  BrandKitStoredResponse,
  FoundationMessageAnswersRequest,
  FoundationMessageAnswersResponse,
  FoundationMessageGenerateRequest,
  FoundationMessageGenerateResponse,
  FoundationMessageResultRequest,
  FoundationMessageResultResponse,
  FoundationMessageStoredResponse,
  IcpGenerateRequest,
  IcpGenerateResponse,
  IcpResultRequest,
  IcpResultResponse,
  MktgChatRequest,
  MktgChatResponse,
  MktgDocumentExtractResponse,
  MktgHistoryRequest,
  MktgHistoryResponse,
  MktgReadText,
  MktgRunAnswer,
} from '@lfx-one/shared/interfaces';
import {
  countFoundationMessageWords,
  validateBrandKitIntakeAnswers,
  validateFoundationMessageAnswers,
  validateFoundationMessageDocuments,
  validateFoundationMessageIntakeAnswers,
  validateIcpIntakeAnswers,
} from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, AuthorizationError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { BrandKitService } from '../services/brand-kit.service';
import { FoundationMessageService } from '../services/foundation-message.service';
import { GuildService } from '../services/guild.service';
import { IcpService } from '../services/icp.service';
import { logger } from '../services/logger.service';
import { MktgSourceTextService } from '../services/mktg-source-text.service';
import { ProjectService } from '../services/project.service';
import { getEffectiveSub, getEffectiveUsername } from '../utils/auth-helper';
import { createSessionOwnerToken, verifySessionOwnerToken } from '../utils/mktg-session-token.util';

export class MktgAgentsController {
  private readonly guildService = new GuildService();
  private readonly brandKitService = new BrandKitService();
  private readonly foundationMessageService = new FoundationMessageService();
  private readonly icpService = new IcpService();
  private readonly mktgSourceTextService = new MktgSourceTextService();
  private readonly projectService = new ProjectService();

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
   *
   * `project` (the run's LFX project uid) scopes the persistence write that
   * rides a ready result: the service resolves it server-side and requires
   * the caller's writer grant before the document can enter that project's
   * storage partition. It is passed through untrusted — the partition is the
   * RESOLVED project's uid, never this raw value.
   */
  public async brandKitResult(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { sessionId, ownerToken, project } = (req.body ?? {}) as Partial<BrandKitResultRequest>;

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

    // Type-gate the run scope like every other body field; an absent one means
    // "no project to persist into", never "persist wherever the agent said".
    // Its SHAPE gate (one safe path segment, before the uid is spent on the
    // unencoded `/projects/{uid}` lookup) lives with the resolution itself in
    // BrandKitService.resolveWritablePartition, so it degrades like every
    // other persistence refusal: the caller still gets the document.
    const validProjectUid = typeof project === 'string' && project.trim() ? project.trim() : undefined;

    const startTime = logger.startOperation(req, 'brand_kit_result', {});

    try {
      const result: BrandKitResultResponse = await this.brandKitService.getResult(req, validSessionId, validProjectUid);
      logger.success(req, 'brand_kit_result', startTime, { status: result.status });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/mktg-agents/brand-kit/stored?project=<uid>
   * Returns the project's LATEST server-persisted Brand Kit document with its
   * receipt metadata (the dec-agent-dependency-gating read path), or 404 when
   * nothing is stored for the project.
   *
   * AUTHZ — this is the read boundary for the persisted partition: the caller
   * must hold writer entitlement on the requested project (the
   * `ProjectService.getProjectById` + `project.writer` precedent shared with
   * writer.guard). The storage partition is derived from the SERVER-resolved
   * project uid — the same identifier the write path derives it from — never
   * from client input, so one project's caller can never be served another
   * project's partition.
   *
   * The raw uid is shape-gated to ONE safe path segment before it is used:
   * `getProjectById` interpolates it unencoded into `/projects/{uid}`, so an
   * ungated value carrying `/`, `?` or `#` could reshape the authenticated
   * upstream request that the writer check is then read from.
   */
  public async storedBrandKit(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = this.readStoredArtifactProjectUid(req);
    if (!projectUid) {
      next(
        ServiceValidationError.forField('project', 'project is required and must be a single-segment project uid', {
          operation: 'brand_kit_stored',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    const startTime = logger.startOperation(req, 'brand_kit_stored', {});

    try {
      // Entitlement gate: resolve the project by uid WITH the caller's access
      // annotation and require the writer grant — the same per-project write
      // entitlement that gates the agents that produce these documents.
      const project = await this.projectService.getProjectById(req, projectUid, true);
      if (!project.writer) {
        next(
          new AuthorizationError('You do not have permission to read this project’s Brand Kit.', {
            operation: 'brand_kit_stored',
            service: 'mktg_agents_controller',
            path: req.path,
          })
        );
        return;
      }

      const stored: BrandKitStoredResponse | null = await this.brandKitService.getStoredBrandKit(req, project.uid);
      if (!stored) {
        next(
          new ResourceNotFoundError('Stored Brand Kit', project.uid, {
            operation: 'brand_kit_stored',
            service: 'mktg_agents_controller',
            path: req.path,
          })
        );
        return;
      }

      logger.success(req, 'brand_kit_stored', startTime, { project: project.uid, version: stored.receipt.version });
      res.json(stored);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/foundation-message/generate
   * Starts a one-shot Messaging Document generation from the intake form: the
   * project name, the four sources and any other links as URLs (the agent
   * fetches and researches them itself), the LFX project uid, and the
   * optional existing documents — an uploaded file as the text the BFF read
   * from it, a link as its URL. Every submission is a fresh generate — the
   * agent's generate form carries no prior version or feedback, so a body
   * with either is refused rather than silently ignored. Returns the session
   * id + creator-binding owner token for polling the result.
   */
  public async generateFoundationMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { answers, documents, feedback, priorVersion, project } = (req.body ?? {}) as Partial<FoundationMessageGenerateRequest>;
    const fail = (field: string, message: string): void =>
      next(ServiceValidationError.forField(field, message, { operation: 'foundation_message_generate', service: 'mktg_agents_controller', path: req.path }));

    const answersResult = validateFoundationMessageIntakeAnswers(answers);
    if (!answersResult.valid) {
      fail('answers', answersResult.errors.join('; '));
      return;
    }
    const documentsResult = validateFoundationMessageDocuments(documents);
    if (!documentsResult.valid) {
      fail('documents', documentsResult.errors.join('; '));
      return;
    }
    if (feedback !== undefined || priorVersion !== undefined) {
      fail('feedback', 'The Messaging Document is revised by commenting on it in Documents; a generate takes no feedback or prior version.');
      return;
    }
    // The project uid goes to the agent as data (its LFX lookups), never as
    // the storage partition — that is the result endpoint's, resolved
    // server-side. Shape-gated all the same so a crafted value never rides
    // the form.
    const trimmedProject = typeof project === 'string' ? project.trim() : '';
    if (project !== undefined && (typeof project !== 'string' || !trimmedProject || !MKTG_ARTIFACT_PARTITION_REGEX.test(trimmedProject))) {
      fail('project', 'project must be a single-segment project uid when provided');
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
    if (!agent || agent.status !== 'active' || !agent.guildAgentHandle) {
      fail('agentId', 'The Messaging Document agent is not available.');
      return;
    }

    const submitted = documents ?? [];
    const startTime = logger.startOperation(req, 'foundation_message_generate', { documents: submitted.length });

    try {
      // Safe: validateFoundationMessageIntakeAnswers guaranteed a string record.
      const trimmedAnswers = Object.fromEntries(
        Object.entries(answers as Record<string, string>)
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value !== '')
      );
      const sessionId = await this.foundationMessageService.startGeneration(
        req,
        trimmedAnswers,
        submitted,
        trimmedProject || undefined,
        agent.guildAgentHandle
      );
      logger.success(req, 'foundation_message_generate', startTime, { session_created: true });
      const response: FoundationMessageGenerateResponse = { sessionId, ownerToken: createSessionOwnerToken(userId, sessionId) };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/foundation-message/answers
   * Sends the requester's answers to the session's questions turn — one per
   * question, each accepted, edited or written from scratch; no skip, no TBD,
   * no empty — as the answers turn on the SAME session. Only the session's
   * creator may answer (owner-token proof, like every session write). The
   * run page polls the result again afterwards.
   */
  public async foundationMessageAnswers(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { sessionId, ownerToken, answers } = (req.body ?? {}) as Partial<FoundationMessageAnswersRequest>;
    const fail = (field: string, message: string): void =>
      next(ServiceValidationError.forField(field, message, { operation: 'foundation_message_answers', service: 'mktg_agents_controller', path: req.path }));

    const validSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined;
    if (!validSessionId) {
      fail('sessionId', 'sessionId is required and must be a non-empty string');
      return;
    }
    const answersResult = validateFoundationMessageAnswers(answers);
    if (!answersResult.valid) {
      fail('answers', answersResult.errors.join('; '));
      return;
    }

    const userId = getEffectiveSub(req);
    if (!userId) {
      next(
        new AuthenticationError('Could not identify the requesting user.', {
          operation: 'foundation_message_answers',
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
        new AuthorizationError('You do not have permission to post to this session.', {
          operation: 'foundation_message_answers',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    // Routing handle comes from the shared catalog only — never the client.
    const agent = MKTG_AGENTS.find((candidate) => candidate.id === 'foundation-setup');
    if (!agent || agent.status !== 'active' || !agent.guildAgentHandle) {
      fail('agentId', 'The Messaging Document agent is not available.');
      return;
    }

    // Safe: validateFoundationMessageAnswers guaranteed the shape.
    const validAnswers = (answers as MktgRunAnswer[]).map((answer) => ({ key: answer.key, text: answer.text.trim(), origin: answer.origin }));
    const startTime = logger.startOperation(req, 'foundation_message_answers', { answers: validAnswers.length });

    try {
      await this.foundationMessageService.sendAnswers(req, validSessionId, validAnswers, agent.guildAgentHandle);
      logger.success(req, 'foundation_message_answers', startTime, { answers: validAnswers.length });
      const response: FoundationMessageAnswersResponse = { success: true };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/foundation-message/documents/file
   * Reads one uploaded existing document (PDF, Word .docx, Markdown or text;
   * raw `application/octet-stream` body, at most 20 MB) to text and returns
   * it, so the form can show what was read and submit the text with the run.
   * The file name travels URI-encoded in the `X-File-Name` header — never the
   * URL, which the request logger writes — and is logged by extension only.
   * Nothing is stored. A document given as a link is never read here: it
   * goes to the agent as its URL.
   */
  public async readFoundationMessageFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'foundation_message_read_file';
    const startTime = logger.startOperation(req, operation);
    try {
      // The username, not the sub: the read gate keys its per-user slots on it, so the two checks agree.
      if (!getEffectiveUsername(req)) {
        throw new AuthenticationError('Could not identify the requesting user.', { operation, service: 'mktg_agents_controller', path: req.path });
      }
      const fileName = this.readUploadFileName(req);
      if (!fileName) {
        throw ServiceValidationError.forField('fileName', `The ${FOUNDATION_MESSAGE_FILE_NAME_HEADER} header must carry the URI-encoded file name`, {
          operation,
        });
      }
      // `express.raw` skips a body whose type is not the one it reads, so a wrong type arrives here with no bytes.
      const file: unknown = req.body;
      if (!Buffer.isBuffer(file) || file.byteLength === 0) {
        throw ServiceValidationError.forField('file', `The file must be a non-empty ${FOUNDATION_MESSAGE_FILE_UPLOAD_CONTENT_TYPE} body.`, { operation });
      }

      const read = await this.mktgSourceTextService.readFile(req, fileName, file, FOUNDATION_MESSAGE_DOCUMENT_MAX_CHARS);
      const response = this.extractResponse(fileName, read);
      // The reason a file was not read rides the log with the operation's duration, so a read limit that bites can be seen and tuned.
      logger.success(req, operation, startTime, {
        extension: fileName.slice(fileName.lastIndexOf('.')),
        size_bytes: file.byteLength,
        read: response.read,
        ...(read.reason && { reason: read.reason }),
      });
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/foundation-message/result
   * Polls a generation session for the validated Messaging Document (and its
   * word-count-locked copy primitives). Only the session's creator may
   * read the result (owner-token proof).
   *
   * `project` (the run's LFX project uid) scopes the persistence write that
   * rides a ready result: the service resolves it server-side and requires
   * the caller's writer grant before the document can enter that project's
   * storage partition. It is passed through untrusted — the partition is the
   * RESOLVED project's uid, never this raw value.
   */
  public async foundationMessageResult(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { sessionId, ownerToken, project } = (req.body ?? {}) as Partial<FoundationMessageResultRequest>;

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

    // Type-gate the run scope like every other body field; an absent one means
    // "no project to persist into", never "persist wherever the agent said".
    // Its SHAPE gate (one safe path segment, before the uid is spent on the
    // unencoded `/projects/{uid}` lookup) lives with the resolution itself in
    // the shared MktgArtifactService, so it degrades like every other
    // persistence refusal: the caller still gets the document.
    const validProjectUid = typeof project === 'string' && project.trim() ? project.trim() : undefined;

    const startTime = logger.startOperation(req, 'foundation_message_result', {});

    try {
      const result: FoundationMessageResultResponse = await this.foundationMessageService.getResult(req, validSessionId, validProjectUid);
      logger.success(req, 'foundation_message_result', startTime, { status: result.status });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/icp/generate
   * Starts a one-shot form-mode ICP & Target Markets generation from the batch
   * intake form. The answers are validated against the agent's own form
   * contract (project name, repo URL and the never-skip business outcome
   * required; the sibling documents and the remaining gap-fill answers
   * optional); regenerations arrive as a full resubmit with `feedback` +
   * `priorVersion` and run on a fresh session. Returns the session id +
   * creator-binding owner token for polling the result.
   */
  public async generateIcp(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { answers, feedback, priorVersion } = (req.body ?? {}) as Partial<IcpGenerateRequest>;

    const answersResult = validateIcpIntakeAnswers(answers);
    if (!answersResult.valid) {
      next(
        ServiceValidationError.forField('answers', answersResult.errors.join('; '), {
          operation: 'icp_generate',
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
          operation: 'icp_generate',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }
    if (priorVersion !== undefined && (typeof priorVersion !== 'number' || !Number.isInteger(priorVersion) || priorVersion < 1)) {
      next(
        ServiceValidationError.forField('priorVersion', 'priorVersion must be an integer >= 1 when provided', {
          operation: 'icp_generate',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }
    // Feedback is feedback ON a prior draft: the payload builder emits the
    // agent's "regenerate and finalize as N+1" directive whenever feedback is
    // present, so feedback with no prior version would mislabel a FIRST
    // document as v2. The UI never sends this shape; a direct call must not
    // be able to either.
    if (typeof feedback === 'string' && feedback.trim() !== '' && priorVersion === undefined) {
      next(
        ServiceValidationError.forField('feedback', 'feedback requires priorVersion — it is feedback on a prior draft', {
          operation: 'icp_generate',
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
          operation: 'icp_generate',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    // Routing handle comes from the shared catalog only — never the client.
    const agent = MKTG_AGENTS.find((candidate) => candidate.id === 'icp');
    if (!agent || agent.status !== 'active') {
      next(
        ServiceValidationError.forField('agentId', 'The ICP & Target Markets agent is not available.', {
          operation: 'icp_generate',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    const startTime = logger.startOperation(req, 'icp_generate', { has_feedback: !!feedback, prior_version: priorVersion ?? 0 });

    try {
      // Safe: validateIcpIntakeAnswers guaranteed a string record. Blank
      // optionals are dropped here so the agent takes its documented
      // "not provided" branch instead of reading an empty answer as substance.
      const trimmedAnswers = Object.fromEntries(
        Object.entries(answers as Record<string, string>)
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value !== '')
      );
      const { sessionId, readme } = await this.icpService.startGeneration(req, trimmedAnswers, { feedback, priorVersion }, agent.guildAgentHandle);
      logger.success(req, 'icp_generate', startTime, { session_created: true, readme_fetched: readme.fetched, readme_source: readme.source });
      // The README outcome rides the response so the run shell can label a
      // document generated WITHOUT a README instead of leaving a thin document
      // unexplained.
      const response: IcpGenerateResponse = { sessionId, ownerToken: createSessionOwnerToken(userId, sessionId), readme };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/icp/result
   * Polls a generation session for the validated ICP & Target Markets
   * document. Only the session's creator may read the result (owner-token
   * proof).
   *
   * `project` (the run's LFX project uid) scopes the persistence write that
   * rides a ready result: the service resolves it server-side and requires the
   * caller's writer grant before the document can enter that project's storage
   * partition. It is passed through untrusted — the partition is the RESOLVED
   * project's uid, never this raw value.
   */
  public async icpResult(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { sessionId, ownerToken, project } = (req.body ?? {}) as Partial<IcpResultRequest>;

    const validSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined;
    if (!validSessionId) {
      next(
        ServiceValidationError.forField('sessionId', 'sessionId is required and must be a non-empty string', {
          operation: 'icp_result',
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
          operation: 'icp_result',
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
          operation: 'icp_result',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    // Type-gate the run scope like every other body field; an absent one means
    // "no project to persist into", never "persist wherever the agent said".
    // Its SHAPE gate lives with the resolution itself in
    // IcpService.resolveWritablePartition, so it degrades like every other
    // persistence refusal: the caller still gets the document.
    const validProjectUid = typeof project === 'string' && project.trim() ? project.trim() : undefined;

    const startTime = logger.startOperation(req, 'icp_result', {});

    try {
      const result: IcpResultResponse = await this.icpService.getResult(req, validSessionId, validProjectUid);
      logger.success(req, 'icp_result', startTime, { status: result.status });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/mktg-agents/foundation-message/stored?project=<uid>
   * Returns the project's LATEST stored Messaging Document (the latest
   * revision of its foundation-message document) with its receipt metadata
   * (the dec-agent-dependency-gating read path), or 404 when nothing is stored
   * for the project. This is what lets a sibling agent — or the same user in a
   * different browser — reach a Messaging Document it did not generate.
   *
   * AUTHZ — the same read boundary as `storedBrandKit`, deliberately
   * identical: the caller must hold writer entitlement on the requested
   * project (the `ProjectService.getProjectById` + `project.writer` precedent
   * shared with writer.guard), and the storage partition is derived from the
   * SERVER-resolved project uid — the same identifier the write path derives
   * it from — never from client input, so one project's caller can never be
   * served another project's partition.
   *
   * The raw uid is shape-gated to ONE safe path segment before it is used:
   * `getProjectById` interpolates it unencoded into `/projects/{uid}`, so an
   * ungated value carrying `/`, `?` or `#` could reshape the authenticated
   * upstream request that the writer check is then read from.
   */
  public async storedFoundationMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = this.readStoredArtifactProjectUid(req);
    if (!projectUid) {
      next(
        ServiceValidationError.forField('project', 'project is required and must be a single-segment project uid', {
          operation: 'foundation_message_stored',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    const startTime = logger.startOperation(req, 'foundation_message_stored', {});

    try {
      // Entitlement gate: resolve the project by uid WITH the caller's access
      // annotation and require the writer grant — the same per-project write
      // entitlement that gates the agents that produce these documents.
      const project = await this.projectService.getProjectById(req, projectUid, true);
      if (!project.writer) {
        next(
          new AuthorizationError('You do not have permission to read this project’s Messaging Document.', {
            operation: 'foundation_message_stored',
            service: 'mktg_agents_controller',
            path: req.path,
          })
        );
        return;
      }

      const stored: FoundationMessageStoredResponse | null = await this.foundationMessageService.getStoredFoundationMessage(req, project.uid);
      if (!stored) {
        next(
          new ResourceNotFoundError('Stored Messaging Document', project.uid, {
            operation: 'foundation_message_stored',
            service: 'mktg_agents_controller',
            path: req.path,
          })
        );
        return;
      }

      logger.success(req, 'foundation_message_stored', startTime, { project: project.uid, version: stored.receipt.version });
      res.json(stored);
    } catch (error) {
      next(error);
    }
  }

  /** What reading an uploaded file produced, as the form shows it, with the text the run submits back. */
  private extractResponse(title: string, read: MktgReadText): MktgDocumentExtractResponse {
    const oneLine = title
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, FOUNDATION_MESSAGE_DOCUMENT_TITLE_MAX_CHARS);
    if (read.text === null) {
      return { title: oneLine, read: false, words: 0, truncated: false, reason: FOUNDATION_MESSAGE_READ_REASONS[read.reason ?? 'no-text'] };
    }
    return { title: oneLine, read: true, words: countFoundationMessageWords(read.text), truncated: read.truncated, text: read.text };
  }

  /** The upload's file name from its URI-encoded header: one line, no control characters, or '' when missing or undecodable. */
  private readUploadFileName(req: Request): string {
    const raw = req.headers[FOUNDATION_MESSAGE_FILE_NAME_HEADER.toLowerCase()];
    try {
      const decoded = typeof raw === 'string' ? decodeURIComponent(raw) : '';
      return (
        decoded
          // eslint-disable-next-line no-control-regex -- the point is to strip control characters
          .replace(/[\u0000-\u001f\u007f]/g, ' ')
          .trim()
          .slice(0, FOUNDATION_MESSAGE_DOCUMENT_TITLE_MAX_CHARS)
      );
    } catch {
      return '';
    }
  }

  /**
   * The `?project=` uid of a stored-artifact read, shape-gated to ONE safe
   * path segment, or null when it is absent or malformed. Shared by every
   * agent's `/stored` endpoint so the gate that protects the unencoded
   * `/projects/{uid}` lookup can never be present on one and missing on
   * another. Pure: the caller owns the 400 response and its operation name.
   */
  private readStoredArtifactProjectUid(req: Request): string | null {
    const projectParam = req.query['project'];
    const projectUid = typeof projectParam === 'string' ? projectParam.trim() : '';
    return projectUid && MKTG_ARTIFACT_PARTITION_REGEX.test(projectUid) ? projectUid : null;
  }
}
