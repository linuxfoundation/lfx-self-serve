// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  BOILERPLATES_FRAMEWORK_ANSWER_KEY,
  BRAND_KIT_FRAMEWORK_ANSWER_KEY,
  FAQ_FRAMEWORK_ANSWER_KEY,
  BRAND_KIT_APPROVAL_REQUIRED_MESSAGE,
  FOUNDATION_MESSAGE_ANSWER_MAX_CHARS,
  FOUNDATION_MESSAGE_DOCUMENT_MAX_CHARS,
  FOUNDATION_MESSAGE_DOCUMENT_TITLE_MAX_CHARS,
  FOUNDATION_MESSAGE_FILE_NAME_HEADER,
  FOUNDATION_MESSAGE_FILE_UPLOAD_CONTENT_TYPE,
  FOUNDATION_MESSAGE_READ_REASONS,
  MKTG_AGENTS,
  MKTG_AGENT_INTAKES,
  MKTG_RUN_QUESTIONS_ID_REGEX,
  MKTG_ARTIFACT_PARTITION_REGEX,
  MKTG_CHAT_MESSAGE_MAX_CHARS,
} from '@lfx-one/shared/constants';
import {
  BoilerplatesAnswersRequest,
  BoilerplatesAnswersResponse,
  BoilerplatesGenerateRequest,
  BoilerplatesGenerateResponse,
  BoilerplatesResultRequest,
  BoilerplatesResultResponse,
  BrandKitAnswersRequest,
  BrandKitAnswersResponse,
  BrandKitGenerateRequest,
  BrandKitGenerateResponse,
  BrandKitLogoFile,
  BrandKitResultRequest,
  BrandKitResultResponse,
  BrandKitStoredResponse,
  FaqAnswersRequest,
  FaqAnswersResponse,
  FaqGenerateRequest,
  FaqGenerateResponse,
  FaqResultRequest,
  FaqResultResponse,
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
  MktgLastIntakeStart,
  MktgReadText,
  MktgRunAnswer,
  MktgRunAnswersRequest,
  MktgPublicRunAnswersResponse,
  MktgRunResultResponse,
} from '@lfx-one/shared/interfaces';
import {
  countFoundationMessageWords,
  validateBoilerplatesAnswers,
  validateBoilerplatesIntakeAnswers,
  validateBrandKitAnswers,
  validateBrandKitIntakeAnswers,
  validateBrandKitLogoFiles,
  validateFaqAnswers,
  validateFaqDocuments,
  validateFaqIntakeAnswers,
  validateFoundationMessageAnswers,
  validateFoundationMessageDocuments,
  validateFoundationMessageIntakeAnswers,
  validateIcpIntakeAnswers,
} from '@lfx-one/shared/utils';
import { BRAND_KIT_INTAKE, FOUNDATION_MESSAGE_INTAKE, BOILERPLATES_INTAKE, FAQ_INTAKE } from '@lfx-one/shared/constants/mktg-run.constants';
import { findMktgRunIntake } from '@lfx-one/shared/utils/mktg-document-store.utils';
import { MKTG_STARTED_RUN_ID_REGEX } from '@lfx-one/shared/constants/mktg-document-store.constants';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { AuthenticationError, AuthorizationError, MicroserviceError, ResourceNotFoundError, ServiceValidationError, PreconditionFailedError } from '../errors';
import { BoilerplatesService } from '../services/boilerplates.service';
import { BrandKitService } from '../services/brand-kit.service';
import { FaqService } from '../services/faq.service';
import { FoundationMessageService } from '../services/foundation-message.service';
import { GuildService } from '../services/guild.service';
import { IcpService } from '../services/icp.service';
import { logger } from '../services/logger.service';
import { MktgSourceTextService } from '../services/mktg-source-text.service';
import { MktgDocumentRunService } from '../services/mktg-document-run.service';
import { MktgDocumentRedraftContextService } from '../services/mktg-document-redraft-context.service';
import { MktgLastIntakeService } from '../services/mktg-last-intake.service';
import { ProjectService } from '../services/project.service';
import { getEffectiveSub, getEffectiveUsername } from '../utils/auth-helper';
import { createSessionOwnerToken, verifySessionOwnerToken } from '../utils/mktg-session-token.util';

export class MktgAgentsController {
  private readonly guildService = new GuildService();
  private readonly boilerplatesService = new BoilerplatesService();
  private readonly brandKitService = new BrandKitService();
  private readonly faqService = new FaqService();
  private readonly foundationMessageService = new FoundationMessageService();
  private readonly icpService = new IcpService();
  private readonly mktgSourceTextService = new MktgSourceTextService();
  private readonly projectService = new ProjectService();
  private readonly documentRuns = new MktgDocumentRunService();
  private readonly redrafts = new MktgDocumentRedraftContextService();
  private readonly lastIntake = new MktgLastIntakeService();

  /** GET /api/mktg-agents/intakes/:agentKey/last?project=<uid> — writer-only scalar prefill. */
  public async getLastIntake(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_last_intake_get';
    const startTime = logger.startOperation(req, operation, {});
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const intake = await this.lastIntake.read(req, req.query['project'], req.params['agentKey']);
      logger.success(req, operation, startTime, { found: intake !== null });
      res.json({ intake });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/chat
   * No sessionId → create a session and return `{ sessionId, ownerToken }`.
   * With sessionId → verify the owner token, post a follow-up, return `{ success: true }`.
   */
  public async chat(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { agentId, message, sessionId, ownerToken, project: rawProject } = (req.body ?? {}) as MktgChatRequest;

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

    if (message.trim().length > MKTG_CHAT_MESSAGE_MAX_CHARS) {
      next(
        ServiceValidationError.forField('message', `message must be at most ${MKTG_CHAT_MESSAGE_MAX_CHARS} characters`, {
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

    // Dedicated one-off forms own project authorization; generic chat cannot bypass it.
    if (MKTG_AGENT_INTAKES[agent.id]?.oneOffDocument) {
      next(ServiceValidationError.forField('agentId', 'Use the dedicated project-authorized form for this agent.'));
      return;
    }

    // Only `active` agents have a live Guild handle; reject `coming-soon` agents
    // so a placeholder can never be routed to a default/incorrect Guild agent.
    if (agent.status !== 'active' || agent.formOnly) {
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
      const project = await this.documentRuns.resolveCatalogProject(req, agent.id, rawProject);
      if (!validSessionId) {
        if (project) await this.documentRuns.assertSingleActiveCatalogRun(req, project, agent.id, req.body?.discard);
        // New session: bind it to the creator via an opaque owner token.
        const newSessionId = await this.guildService.createSession(req, { message: message.trim(), handle: agent.guildAgentHandle });
        if (project) {
          await this.trackStart(req, agent.id, project, newSessionId);
        }
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

      if (await this.redrafts.forSession(req, validSessionId)) {
        throw new AuthorizationError('Generic chat follow-ups are refused on comments-only redraft sessions.');
      }
      const turnId = randomUUID();
      await this.guildService.sendFollowUp(req, validSessionId, { message: message.trim(), handle: agent.guildAgentHandle });
      if (project) {
        // Chat supplies no prior-version hint; this metadata field is generate-path only.
        await this.trackStart(req, agent.id, project, validSessionId, 0, turnId);
      }
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
   * Starts a Brand Kit draft from the intake form: the project name, the
   * website and the brand page as URLs (the agent reads them itself), the
   * notes, the browser-attached messaging framework (the attach path reads
   * approved current; this endpoint validates JSON but does not re-check
   * approval), serialized, at most
   * `BRAND_KIT_MAX_FRAMEWORK_CHARS` characters, carrying the umbrella message
   * or brand line the Voice chapter comes from), the LFX project uid, and
   * the uploaded logo files — an SVG as its text, a PNG or a ZIP as its
   * base64 bytes, a link as the URL the agent fetches. Every submission is a
   * fresh draft — the agent's draft form
   * carries no prior version or feedback, so a body with either is refused
   * rather than silently ignored. Returns the session id + creator-binding
   * owner token for polling the result.
   */
  public async generateBrandKit(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { answers, logoFiles, feedback, priorVersion, project } = (req.body ?? {}) as Partial<BrandKitGenerateRequest>;
    const fail = (field: string, message: string): void =>
      next(ServiceValidationError.forField(field, message, { operation: 'brand_kit_generate', service: 'mktg_agents_controller', path: req.path }));

    const answersResult = validateBrandKitIntakeAnswers(answers);
    if (!answersResult.valid) {
      fail('answers', answersResult.errors.join('; '));
      return;
    }
    const logoFilesResult = validateBrandKitLogoFiles(logoFiles);
    if (!logoFilesResult.valid) {
      fail('logoFiles', logoFilesResult.errors.join('; '));
      return;
    }
    if (feedback !== undefined || priorVersion !== undefined) {
      fail('feedback', 'The Brand Kit is revised by commenting on it in Documents; a generate takes no feedback or prior version.');
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
          operation: 'brand_kit_generate',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    // Routing handle comes from the shared catalog only — never the client.
    const agent = MKTG_AGENTS.find((candidate) => candidate.id === 'brand-kit');
    if (!agent || agent.status !== 'active' || !agent.guildAgentHandle) {
      fail('agentId', 'The Brand Kit agent is not available.');
      return;
    }

    // Safe: validateBrandKitLogoFiles guaranteed the shape. Names are trimmed; contents pass through verbatim.
    const files: BrandKitLogoFile[] = ((logoFiles ?? []) as BrandKitLogoFile[]).map((file) => ({ ...file, name: file.name.trim() }));
    // The messaging framework rides the answers (validated above as a JSON object): its size is worth a log line, never its contents.
    const frameworkChars = ((answers as Record<string, string>)[BRAND_KIT_FRAMEWORK_ANSWER_KEY] ?? '').length;
    const startTime = logger.startOperation(req, 'brand_kit_generate', { logo_files: files.length, framework_chars: frameworkChars });

    try {
      // Safe: validateBrandKitIntakeAnswers guaranteed a string record. Blank
      // optionals are dropped so the renderer takes its "none" branch.
      const trimmedAnswers = Object.fromEntries(
        Object.entries(answers as Record<string, string>)
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value !== '')
      );
      const project = await this.documentRuns.resolveProject(req, trimmedProject);
      await this.documentRuns.assertSingleActiveCatalogRun(req, project, agent.id, req.body?.discard);
      const sessionId = await this.brandKitService.startGeneration(req, trimmedAnswers, files, project, agent.guildAgentHandle);
      const runId = await this.trackStart(req, agent.id, project, sessionId);
      logger.success(req, 'brand_kit_generate', startTime, { session_created: true });
      const response: BrandKitGenerateResponse = { sessionId, ownerToken: createSessionOwnerToken(userId, sessionId), runId };
      res.json(response);
      this.recordLastIntake(req, { project, agentId: agent.id, runId, answers: answers as Record<string, string>, documentCount: 0, logoCount: files.length });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/brand-kit/answers
   * Sends the requester's answers to the session's questions turn — one per
   * question asked, each accepted, edited or written from scratch; no skip,
   * no TBD, no empty — as the answers turn on the SAME session. Only the
   * session's creator may answer (owner-token proof, like every session
   * write). The run page polls the result again afterwards.
   */
  public async brandKitAnswers(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { sessionId, ownerToken, answers } = (req.body ?? {}) as Partial<BrandKitAnswersRequest>;
    const fail = (field: string, message: string): void =>
      next(ServiceValidationError.forField(field, message, { operation: 'brand_kit_answers', service: 'mktg_agents_controller', path: req.path }));

    const validSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined;
    if (!validSessionId) {
      fail('sessionId', 'sessionId is required and must be a non-empty string');
      return;
    }
    const answersResult = validateBrandKitAnswers(answers);
    if (!answersResult.valid) {
      fail('answers', answersResult.errors.join('; '));
      return;
    }

    const userId = getEffectiveSub(req);
    if (!userId) {
      next(
        new AuthenticationError('Could not identify the requesting user.', {
          operation: 'brand_kit_answers',
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
          operation: 'brand_kit_answers',
          service: 'mktg_agents_controller',
        })
      );
      return;
    }

    // Routing handle comes from the shared catalog only — never the client.
    const agent = MKTG_AGENTS.find((candidate) => candidate.id === 'brand-kit');
    if (!agent || agent.status !== 'active' || !agent.guildAgentHandle) {
      fail('agentId', 'The Brand Kit agent is not available.');
      return;
    }

    // Safe: validateBrandKitAnswers guaranteed the shape.
    const validAnswers = (answers as MktgRunAnswer[]).map((answer) => ({ key: answer.key, text: answer.text.trim(), origin: answer.origin }));
    const startTime = logger.startOperation(req, 'brand_kit_answers', { answers: validAnswers.length });

    try {
      const project = await this.answersProject(req);
      if (await this.redrafts.forSession(req, validSessionId)) throw new AuthorizationError('Free-text answers are refused on comments-only redraft sessions.');
      await this.brandKitService.sendAnswers(req, validSessionId, validAnswers, agent.guildAgentHandle);
      if (project) {
        await this.documentRuns.resumeAfterQuestions(req, project, validSessionId, req.body.questionsId);
      }
      logger.success(req, 'brand_kit_answers', startTime, { answers: validAnswers.length });
      const response: BrandKitAnswersResponse = { success: true };
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
      const result: BrandKitResultResponse = await this.guildService.resolveRunOutcome(
        req,
        validSessionId,
        await this.brandKitService.getResult(req, validSessionId, validProjectUid)
      );
      await this.trackResult(req, validSessionId, result, validProjectUid);
      logger.success(req, 'brand_kit_result', startTime, { status: result.status });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/mktg-agents/brand-kit/stored?project=<uid>[&sidecar=true]
   * Returns approved-current branding bytes and receipt metadata, or 404
   * when none is approved. `sidecar=true` includes tokens, chapters, artwork
   * and date. Only a true pre-revision plain read retains legacy fallback.
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

    const withSidecar = req.query['sidecar'] === 'true';
    const startTime = logger.startOperation(req, 'brand_kit_stored', { with_sidecar: withSidecar });

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

      const stored: BrandKitStoredResponse | null = await this.brandKitService.getStoredBrandKit(req, project.uid, withSidecar);
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
   * Starts a Messaging Framework draft from the intake form: the project name
   * and description, the website, the repository and the page fields as URLs
   * (the agent fetches and researches them itself), the LFX project uid, and
   * the optional documents — an uploaded file as the text the BFF read from
   * it, a link as its URL, each tagged with what it is. The website is the
   * one required source — a real http(s) page, never blank or "none", as
   * `validateFoundationMessageIntakeAnswers` holds it — and every other
   * source is optional: a link or a document alone is refused with a 400,
   * matching the guided form's own rule. Every submission is a fresh
   * draft — a redraft from comments and a check of a hand-edited version are
   * later work, so a body with feedback or a prior version is refused rather
   * than silently ignored. Returns the session id + creator-binding owner
   * token for polling the result.
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
      fail('feedback', 'A generate is always a fresh draft of the Messaging Framework; it takes no feedback or prior version.');
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
      fail('agentId', 'The Messaging Framework agent is not available.');
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
      const project = await this.documentRuns.resolveProject(req, trimmedProject);
      await this.documentRuns.assertSingleActiveCatalogRun(req, project, agent.id, req.body?.discard);
      const sessionId = await this.foundationMessageService.startGeneration(req, trimmedAnswers, submitted, project, agent.guildAgentHandle);
      const runId = await this.trackStart(req, agent.id, project, sessionId);
      logger.success(req, 'foundation_message_generate', startTime, { session_created: true });
      const response: FoundationMessageGenerateResponse = { sessionId, ownerToken: createSessionOwnerToken(userId, sessionId), runId };
      res.json(response);
      this.recordLastIntake(req, {
        project,
        agentId: agent.id,
        runId,
        answers: answers as Record<string, string>,
        documentCount: submitted.length,
        logoCount: 0,
      });
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
      fail('agentId', 'The Messaging Framework agent is not available.');
      return;
    }

    // Safe: validateFoundationMessageAnswers guaranteed the shape.
    const validAnswers = (answers as MktgRunAnswer[]).map((answer) => ({ key: answer.key, text: answer.text.trim(), origin: answer.origin }));
    const startTime = logger.startOperation(req, 'foundation_message_answers', { answers: validAnswers.length });

    try {
      const project = await this.answersProject(req);
      if (await this.redrafts.forSession(req, validSessionId)) throw new AuthorizationError('Free-text answers are refused on comments-only redraft sessions.');
      await this.foundationMessageService.sendAnswers(req, validSessionId, validAnswers, agent.guildAgentHandle);
      if (project) {
        await this.documentRuns.resumeAfterQuestions(req, project, validSessionId, req.body.questionsId);
      }
      logger.success(req, 'foundation_message_answers', startTime, { answers: validAnswers.length });
      const response: FoundationMessageAnswersResponse = { success: true };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/foundation-message/documents/file
   * Reads one uploaded document (PDF, Word .docx, PowerPoint .pptx, Markdown
   * or text; raw `application/octet-stream` body, at most 20 MB) to text and returns
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
   * Polls a generation session for the validated Messaging Framework — the
   * run's asset, or the agent's questions while it waits for answers. Only
   * the session's creator may read the result (owner-token proof).
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
      const result: FoundationMessageResultResponse = await this.guildService.resolveRunOutcome(
        req,
        validSessionId,
        await this.foundationMessageService.getResult(req, validSessionId, validProjectUid)
      );
      await this.trackResult(req, validSessionId, result, validProjectUid);
      logger.success(req, 'foundation_message_result', startTime, { status: result.status });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/boilerplates/generate
   * Starts a Boilerplates draft from the intake form: the project name, the
   * website as a URL (the agent reads it, and its host is the domain the
   * 100-word version ends on), the notes, the project's messaging framework
   * (required — the run page attaches approved-current JSON, serialized, at most
   * `BOILERPLATES_MAX_FRAMEWORK_CHARS` characters, carrying the framework's
   * content, which the boilerplates' positioning and proof come from) and the
   * LFX project uid. Every submission is a fresh draft — comments per length
   * (a redraft) and a check of a hand edit are later work, so a body with
   * feedback, a prior version, documents or logo files is refused rather
   * than silently ignored. Returns the session id + creator-binding owner
   * token for polling the result.
   */
  public async generateBoilerplates(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { answers, documents, logoFiles, feedback, priorVersion, project } = (req.body ?? {}) as Partial<BoilerplatesGenerateRequest>;
    const fail = (field: string, message: string): void =>
      next(ServiceValidationError.forField(field, message, { operation: 'boilerplates_generate', service: 'mktg_agents_controller', path: req.path }));

    const answersResult = validateBoilerplatesIntakeAnswers(answers);
    if (!answersResult.valid) {
      fail('answers', answersResult.errors.join('; '));
      return;
    }
    if (feedback !== undefined || priorVersion !== undefined) {
      fail('feedback', 'A generate is always a fresh draft of the Boilerplates; it takes no feedback or prior version.');
      return;
    }
    if (documents !== undefined || logoFiles !== undefined) {
      fail('documents', 'The Boilerplates read their sources themselves; a generate takes no documents or logo files.');
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
          operation: 'boilerplates_generate',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    // Routing handle comes from the shared catalog only — never the client.
    const agent = MKTG_AGENTS.find((candidate) => candidate.id === 'boilerplates');
    if (!agent || agent.status !== 'active' || !agent.guildAgentHandle) {
      fail('agentId', 'The Boilerplates agent is not available.');
      return;
    }

    // The messaging framework rides the answers (validated above as a framework's JSON): its size is worth a log line, never its contents.
    const frameworkChars = ((answers as Record<string, string>)[BOILERPLATES_FRAMEWORK_ANSWER_KEY] ?? '').length;
    const startTime = logger.startOperation(req, 'boilerplates_generate', { framework_chars: frameworkChars });

    try {
      // Safe: validateBoilerplatesIntakeAnswers guaranteed a string record.
      // Blank optionals are dropped so the renderer takes its "none" branch.
      const trimmedAnswers = Object.fromEntries(
        Object.entries(answers as Record<string, string>)
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value !== '')
      );
      const project = await this.documentRuns.resolveProject(req, trimmedProject);
      await this.documentRuns.assertSingleActiveCatalogRun(req, project, agent.id, req.body?.discard);
      const sessionId = await this.boilerplatesService.startGeneration(req, trimmedAnswers, project, agent.guildAgentHandle);
      const runId = await this.trackStart(req, agent.id, project, sessionId);
      logger.success(req, 'boilerplates_generate', startTime, { session_created: true });
      const response: BoilerplatesGenerateResponse = { sessionId, ownerToken: createSessionOwnerToken(userId, sessionId), runId };
      res.json(response);
      this.recordLastIntake(req, { project, agentId: agent.id, runId, answers: answers as Record<string, string>, documentCount: 0, logoCount: 0 });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/boilerplates/answers
   * Sends the requester's answers to the session's questions turn — one per
   * question, each accepted, edited or written from scratch; no skip, no TBD,
   * no empty — as the answers turn on the SAME session. Only the session's
   * creator may answer (owner-token proof, like every session write). The
   * run page polls the result again afterwards.
   */
  public async boilerplatesAnswers(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { sessionId, ownerToken, answers } = (req.body ?? {}) as Partial<BoilerplatesAnswersRequest>;
    const fail = (field: string, message: string): void =>
      next(ServiceValidationError.forField(field, message, { operation: 'boilerplates_answers', service: 'mktg_agents_controller', path: req.path }));

    const validSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined;
    if (!validSessionId) {
      fail('sessionId', 'sessionId is required and must be a non-empty string');
      return;
    }
    const answersResult = validateBoilerplatesAnswers(answers);
    if (!answersResult.valid) {
      fail('answers', answersResult.errors.join('; '));
      return;
    }

    const userId = getEffectiveSub(req);
    if (!userId) {
      next(
        new AuthenticationError('Could not identify the requesting user.', {
          operation: 'boilerplates_answers',
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
          operation: 'boilerplates_answers',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    // Routing handle comes from the shared catalog only — never the client.
    const agent = MKTG_AGENTS.find((candidate) => candidate.id === 'boilerplates');
    if (!agent || agent.status !== 'active' || !agent.guildAgentHandle) {
      fail('agentId', 'The Boilerplates agent is not available.');
      return;
    }

    // Safe: validateBoilerplatesAnswers guaranteed the shape.
    const validAnswers = (answers as MktgRunAnswer[]).map((answer) => ({ key: answer.key, text: answer.text.trim(), origin: answer.origin }));
    const startTime = logger.startOperation(req, 'boilerplates_answers', { answers: validAnswers.length });

    try {
      const project = await this.answersProject(req);
      if (await this.redrafts.forSession(req, validSessionId)) throw new AuthorizationError('Free-text answers are refused on comments-only redraft sessions.');
      await this.boilerplatesService.sendAnswers(req, validSessionId, validAnswers, agent.guildAgentHandle);
      if (project) {
        await this.documentRuns.resumeAfterQuestions(req, project, validSessionId, req.body.questionsId);
      }
      logger.success(req, 'boilerplates_answers', startTime, { answers: validAnswers.length });
      const response: BoilerplatesAnswersResponse = { success: true };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/boilerplates/result
   * Polls a generation session for the validated Boilerplates — the run's
   * asset, the agent's questions while it waits for answers, or its one
   * plain reply when it ended the run without the boilerplates. Only the
   * session's creator may read the result (owner-token proof).
   *
   * `project` (the run's LFX project uid) scopes the persistence write that
   * rides a ready result: the document store resolves it server-side and
   * requires the caller's writer grant before anything enters that
   * project's storage partition. It is passed through untrusted — the
   * partition is the RESOLVED project's uid, never this raw value.
   */
  public async boilerplatesResult(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { sessionId, ownerToken, project } = (req.body ?? {}) as Partial<BoilerplatesResultRequest>;

    const validSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined;
    if (!validSessionId) {
      next(
        ServiceValidationError.forField('sessionId', 'sessionId is required and must be a non-empty string', {
          operation: 'boilerplates_result',
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
          operation: 'boilerplates_result',
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
          operation: 'boilerplates_result',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    // Type-gate the run scope like every other body field; an absent one means
    // "no project to persist into", never "persist wherever the agent said".
    // Its SHAPE gate lives with the resolution itself in the shared
    // MktgArtifactService, so it degrades like every other persistence
    // refusal: the caller still gets the boilerplates.
    const validProjectUid = typeof project === 'string' && project.trim() ? project.trim() : undefined;

    const startTime = logger.startOperation(req, 'boilerplates_result', {});

    try {
      const result: BoilerplatesResultResponse = await this.guildService.resolveRunOutcome(
        req,
        validSessionId,
        await this.boilerplatesService.getResult(req, validSessionId, validProjectUid)
      );
      await this.trackResult(req, validSessionId, result, validProjectUid);
      logger.success(req, 'boilerplates_result', startTime, { status: result.status });
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
    const { answers, feedback, priorVersion, project: rawProject } = (req.body ?? {}) as Partial<IcpGenerateRequest>;

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
    if (typeof feedback === 'string' && feedback.trim().length > FOUNDATION_MESSAGE_ANSWER_MAX_CHARS) {
      next(
        ServiceValidationError.forField('feedback', `feedback must be at most ${FOUNDATION_MESSAGE_ANSWER_MAX_CHARS} characters`, {
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
      const project = await this.documentRuns.resolveProject(req, rawProject);
      await this.documentRuns.assertSingleActiveCatalogRun(req, project, agent.id, req.body?.discard);
      const { sessionId, readme } = await this.icpService.startGeneration(req, trimmedAnswers, { feedback, priorVersion }, agent.guildAgentHandle);
      const runId = await this.trackStart(req, agent.id, project, sessionId, priorVersion ?? 0);
      logger.success(req, 'icp_generate', startTime, { session_created: true, readme_fetched: readme.fetched, readme_source: readme.source });
      // The README outcome rides the response so the run shell can label a
      // document generated WITHOUT a README instead of leaving a thin document
      // unexplained.
      const response: IcpGenerateResponse = { sessionId, ownerToken: createSessionOwnerToken(userId, sessionId), readme, runId };
      res.json(response);
      this.recordLastIntake(req, { project, agentId: agent.id, runId, answers: answers as Record<string, string>, documentCount: 0, logoCount: 0 });
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
      const result: IcpResultResponse = await this.guildService.resolveRunOutcome(
        req,
        validSessionId,
        await this.icpService.getResult(req, validSessionId, validProjectUid)
      );
      await this.trackResult(req, validSessionId, result, validProjectUid);
      logger.success(req, 'icp_result', startTime, { status: result.status });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/mktg-agents/foundation-message/stored?project=<uid>[&sidecar=true]
   * Plain and sidecar responses return approved current, never a newer Draft.
   * No approved selection returns 404; a true pre-revision plain fallback
   * remains server-owned. With `sidecar=true`, the response also carries
   * envelope JSON and date for consumers such as the Brand Kit.
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

    const withSidecar = req.query['sidecar'] === 'true';
    const startTime = logger.startOperation(req, 'foundation_message_stored', { with_sidecar: withSidecar });

    try {
      // Entitlement gate: resolve the project by uid WITH the caller's access
      // annotation and require the writer grant — the same per-project write
      // entitlement that gates the agents that produce these documents.
      const project = await this.projectService.getProjectById(req, projectUid, true);
      if (!project.writer) {
        next(
          new AuthorizationError('You do not have permission to read this project’s Messaging Framework.', {
            operation: 'foundation_message_stored',
            service: 'mktg_agents_controller',
            path: req.path,
          })
        );
        return;
      }

      const stored: FoundationMessageStoredResponse | null = await this.foundationMessageService.getStoredFoundationMessage(req, project.uid, withSidecar);
      if (!stored) {
        next(
          withSidecar
            ? new MicroserviceError(BRAND_KIT_APPROVAL_REQUIRED_MESSAGE, 404, 'MKTG_FRAMEWORK_NOT_APPROVED', {
                operation: 'foundation_message_stored',
                service: 'mktg_agents_controller',
                path: req.path,
              })
            : new ResourceNotFoundError('Stored Messaging Framework', project.uid, {
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

  /**
   * POST /api/mktg-agents/faq/generate
   * Starts an FAQ draft from the intake form: the project name and
   * description, the website (required, a real http(s) page) and the GitHub
   * repository as URLs the agent reads itself, the notes, the LFX project
   * uid, the documents — an upload as the text the BFF read from it, a link as
   * its URL, each tagged press, deck, doc or plan — and the project's
   * messaging framework (required: the latest stored revision's JSON, which
   * must carry the framework itself, since the agent refuses a run without
   * one). Every submission here is a fresh draft; comment redrafts use the
   * Documents revise endpoint. Feedback or a prior version in this body is
   * refused rather than silently ignored. Returns the
   * session id + creator-binding owner token for polling the result.
   */
  public async generateFaq(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { answers, documents, feedback, priorVersion, project } = (req.body ?? {}) as Partial<FaqGenerateRequest>;
    const fail = (field: string, message: string): void =>
      next(ServiceValidationError.forField(field, message, { operation: 'faq_generate', service: 'mktg_agents_controller', path: req.path }));

    const answersResult = validateFaqIntakeAnswers(answers);
    if (!answersResult.valid) {
      fail('answers', answersResult.errors.join('; '));
      return;
    }
    const documentsResult = validateFaqDocuments(documents);
    if (!documentsResult.valid) {
      fail('documents', documentsResult.errors.join('; '));
      return;
    }
    if (feedback !== undefined || priorVersion !== undefined) {
      fail('feedback', 'A generate is always a fresh draft of the FAQ; it takes no feedback or prior version.');
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
        new AuthenticationError('Could not identify the requesting user.', { operation: 'faq_generate', service: 'mktg_agents_controller', path: req.path })
      );
      return;
    }

    // Routing handle comes from the shared catalog only — never the client.
    const agent = MKTG_AGENTS.find((candidate) => candidate.id === 'faq');
    if (!agent || agent.status !== 'active' || !agent.guildAgentHandle) {
      fail('agentId', 'The FAQ agent is not available.');
      return;
    }

    const submitted = documents ?? [];
    // The framework rides the answers (validated above): its size is worth a log line, never its contents.
    const frameworkChars = ((answers as Record<string, string>)[FAQ_FRAMEWORK_ANSWER_KEY] ?? '').length;
    const startTime = logger.startOperation(req, 'faq_generate', { documents: submitted.length, framework_chars: frameworkChars });

    try {
      // Safe: validateFaqIntakeAnswers guaranteed a string record. Blank
      // optionals are dropped so the renderer takes its "none" branch.
      const trimmedAnswers = Object.fromEntries(
        Object.entries(answers as Record<string, string>)
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value !== '')
      );
      const project = await this.documentRuns.resolveProject(req, trimmedProject);
      await this.documentRuns.assertSingleActiveCatalogRun(req, project, agent.id, req.body?.discard);
      const sessionId = await this.faqService.startGeneration(req, trimmedAnswers, submitted, project, agent.guildAgentHandle);
      const runId = await this.trackStart(req, agent.id, project, sessionId);
      logger.success(req, 'faq_generate', startTime, { session_created: true });
      const response: FaqGenerateResponse = { sessionId, ownerToken: createSessionOwnerToken(userId, sessionId), runId };
      res.json(response);
      this.recordLastIntake(req, {
        project,
        agentId: agent.id,
        runId,
        answers: answers as Record<string, string>,
        documentCount: submitted.length,
        logoCount: 0,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/faq/answers
   * Sends the requester's answers to the session's questions turn — one per
   * question, at most six, each accepted, edited or written from scratch; no
   * skip, no TBD, no empty — as the answers turn on the SAME session. Only
   * the session's creator may answer (owner-token proof, like every session
   * write). The run page polls the result again afterwards.
   */
  public async faqAnswers(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { sessionId, ownerToken, answers } = (req.body ?? {}) as Partial<FaqAnswersRequest>;
    const fail = (field: string, message: string): void =>
      next(ServiceValidationError.forField(field, message, { operation: 'faq_answers', service: 'mktg_agents_controller', path: req.path }));

    const validSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined;
    if (!validSessionId) {
      fail('sessionId', 'sessionId is required and must be a non-empty string');
      return;
    }
    const answersResult = validateFaqAnswers(answers);
    if (!answersResult.valid) {
      fail('answers', answersResult.errors.join('; '));
      return;
    }

    const userId = getEffectiveSub(req);
    if (!userId) {
      next(new AuthenticationError('Could not identify the requesting user.', { operation: 'faq_answers', service: 'mktg_agents_controller', path: req.path }));
      return;
    }

    // Type-gate body fields — never rely on downstream defensive coercion.
    const validOwnerToken = typeof ownerToken === 'string' && ownerToken ? ownerToken : undefined;
    if (!verifySessionOwnerToken(validOwnerToken, userId, validSessionId)) {
      next(
        new AuthorizationError('You do not have permission to post to this session.', {
          operation: 'faq_answers',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    // Routing handle comes from the shared catalog only — never the client.
    const agent = MKTG_AGENTS.find((candidate) => candidate.id === 'faq');
    if (!agent || agent.status !== 'active' || !agent.guildAgentHandle) {
      fail('agentId', 'The FAQ agent is not available.');
      return;
    }

    // Safe: validateFaqAnswers guaranteed the shape.
    const validAnswers = (answers as MktgRunAnswer[]).map((answer) => ({ key: answer.key, text: answer.text.trim(), origin: answer.origin }));
    const startTime = logger.startOperation(req, 'faq_answers', { answers: validAnswers.length });

    try {
      const project = await this.answersProject(req);
      if (await this.redrafts.forSession(req, validSessionId)) throw new AuthorizationError('Free-text answers are refused on comments-only redraft sessions.');
      await this.faqService.sendAnswers(req, validSessionId, validAnswers, agent.guildAgentHandle);
      if (project) {
        await this.documentRuns.resumeAfterQuestions(req, project, validSessionId, req.body.questionsId);
      }
      logger.success(req, 'faq_answers', startTime, { answers: validAnswers.length });
      const response: FaqAnswersResponse = { success: true };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/mktg-agents/faq/result
   * Polls a generation session for the validated FAQ — the run's asset, the
   * agent's questions while it waits for answers, or the reply that ended the
   * run without one. Only the session's creator may read the result
   * (owner-token proof).
   *
   * `project` (the run's LFX project uid) scopes the persistence write that
   * rides a ready result: it is resolved server-side and the caller's writer
   * grant is required before the FAQ can enter that project's storage
   * partition. It is passed through untrusted — the partition is the
   * RESOLVED project's uid, never this raw value.
   */
  public async faqResult(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Normalize a missing/null body so malformed requests get a 400, not a throw.
    const { sessionId, ownerToken, project } = (req.body ?? {}) as Partial<FaqResultRequest>;

    const validSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined;
    if (!validSessionId) {
      next(
        ServiceValidationError.forField('sessionId', 'sessionId is required and must be a non-empty string', {
          operation: 'faq_result',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    const userId = getEffectiveSub(req);
    if (!userId) {
      next(new AuthenticationError('Could not identify the requesting user.', { operation: 'faq_result', service: 'mktg_agents_controller', path: req.path }));
      return;
    }

    // Type-gate body fields — never rely on downstream defensive coercion.
    const validOwnerToken = typeof ownerToken === 'string' && ownerToken ? ownerToken : undefined;
    if (!verifySessionOwnerToken(validOwnerToken, userId, validSessionId)) {
      next(
        new AuthorizationError('You do not have permission to read this session.', {
          operation: 'faq_result',
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }

    // An absent project means "no project to persist into", never "persist
    // wherever the agent said"; its shape gate lives with the resolution in
    // the shared artifact layer, so it degrades like every other persistence
    // refusal: the caller still gets the FAQ.
    const validProjectUid = typeof project === 'string' && project.trim() ? project.trim() : undefined;

    const startTime = logger.startOperation(req, 'faq_result', {});

    try {
      const result: FaqResultResponse = await this.guildService.resolveRunOutcome(
        req,
        validSessionId,
        await this.faqService.getResult(req, validSessionId, validProjectUid)
      );
      await this.trackResult(req, validSessionId, result, validProjectUid);
      logger.success(req, 'faq_result', startTime, { status: result.status });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /** Record the ACK through the catalog-aware domain service. */
  /** Project-writer continuation for a kit run, deliberately separate from creator-token session writes. */
  public async runAnswers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_run_answers';
    const runId = req.params['runId'];
    const body = (req.body ?? {}) as Partial<MktgRunAnswersRequest>;
    if (
      typeof runId !== 'string' ||
      !MKTG_STARTED_RUN_ID_REGEX.test(runId) ||
      typeof body.questionsId !== 'string' ||
      !MKTG_RUN_QUESTIONS_ID_REGEX.test(body.questionsId)
    ) {
      next(
        ServiceValidationError.forField('run', 'A valid run id and questions id are required.', {
          operation,
          service: 'mktg_agents_controller',
          path: req.path,
        })
      );
      return;
    }
    const started = logger.startOperation(req, operation, { run: runId });
    try {
      if (!getEffectiveSub(req)) throw new AuthenticationError('Could not identify the requesting user.');
      const run = await this.documentRuns.questionsForAnswers(req, body.project, runId, body.questionsId);
      const intake = findMktgRunIntake(run.agentKey);
      const agent = MKTG_AGENTS.find((entry) => entry.id === intake?.agentId && entry.status === 'active');
      const handle = agent?.status === 'active' ? agent.guildAgentHandle : undefined;
      const adapter = this.livingAnswers(intake?.endpoints.answers);
      if (!handle || !adapter) throw new PreconditionFailedError('This run has no registered answers path.');
      const checked = adapter.validate(body.answers);
      if (!checked.valid || !Array.isArray(body.answers))
        throw ServiceValidationError.forField('answers', checked.errors.join('; ') || 'Valid answers are required.');
      if (await this.redrafts.forSession(req, run.sessionId)) throw new AuthorizationError('Free-text answers are refused on comments-only redraft sessions.');
      const answers = body.answers.map((answer) => ({ key: answer.key, text: answer.text.trim(), origin: answer.origin }));
      await adapter.send(req, run.sessionId, answers, handle);
      await this.documentRuns.resumeAfterQuestions(req, run.project, run.sessionId, body.questionsId);
      logger.success(req, operation, started, { agent: run.agentKey, count: answers.length });
      const response: MktgPublicRunAnswersResponse = { runId: run.runId, state: 'writing' };
      res.json(response);
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

  /** Detached from the response: a stalled snapshot must never delay an accepted Generate ACK. */
  private recordLastIntake(req: Request, input: MktgLastIntakeStart): void {
    void this.lastIntake.recordStartBestEffort(req, input).catch(() => {
      // Defensive collaborator boundary; never log the rejected error or the validated input body.
      logger.warning(req, 'mktg_last_intake_write', 'Run accepted, but scalar intake history could not be saved');
    });
  }

  /** Reuse the same domain validators and renderers as the private per-agent answers endpoints. */
  private livingAnswers(endpoint: string | undefined) {
    if (!endpoint) return null;
    switch (endpoint) {
      case BRAND_KIT_INTAKE.endpoints.answers:
        return { validate: validateBrandKitAnswers, send: this.brandKitService.sendAnswers.bind(this.brandKitService) };
      case FOUNDATION_MESSAGE_INTAKE.endpoints.answers:
        return { validate: validateFoundationMessageAnswers, send: this.foundationMessageService.sendAnswers.bind(this.foundationMessageService) };
      case BOILERPLATES_INTAKE.endpoints.answers:
        return { validate: validateBoilerplatesAnswers, send: this.boilerplatesService.sendAnswers.bind(this.boilerplatesService) };
      case FAQ_INTAKE.endpoints.answers:
        return { validate: validateFaqAnswers, send: this.faqService.sendAnswers.bind(this.faqService) };
      default:
        return null;
    }
  }

  private async trackStart(req: Request, agentId: string, project: string, sessionId: string, priorVersion = 0, turnId = 'initial'): Promise<string> {
    return this.documentRuns.startForCatalogAgent(req, agentId, project, sessionId, priorVersion, turnId);
  }

  private async answersProject(req: Request): Promise<string | undefined> {
    if (req.body.questionsId !== undefined && (typeof req.body.questionsId !== 'string' || !MKTG_RUN_QUESTIONS_ID_REGEX.test(req.body.questionsId))) {
      throw ServiceValidationError.forField('questionsId', 'Invalid questions block.');
    }
    return req.body.project === undefined ? undefined : this.documentRuns.resolveProject(req, req.body.project);
  }

  private async trackResult(req: Request, sessionId: string, result: MktgRunResultResponse, project?: string): Promise<void> {
    await this.documentRuns.recordResultBestEffort(req, sessionId, result, project);
  }

  /** Shape-gated `?project=` uid shared by the stored-artifact reads before any upstream lookup. */
  private readStoredArtifactProjectUid(req: Request): string | null {
    const projectParam = req.query['project'];
    const projectUid = typeof projectParam === 'string' ? projectParam.trim() : '';
    return projectUid && MKTG_ARTIFACT_PARTITION_REGEX.test(projectUid) ? projectUid : null;
  }
}
