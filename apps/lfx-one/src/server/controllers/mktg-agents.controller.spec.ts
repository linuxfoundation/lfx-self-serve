// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors brand-kit.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired
// into this app's vitest config with Angular-free resolution, so shared runtime
// collaborators are mocked — the catalog constants are re-exported from their
// real (Angular-free) source module so the routing lookups stay real.
const redraftContext = vi.hoisted(() => vi.fn());
vi.mock('../services/mktg-document-redraft-context.service', () => ({
  MktgDocumentRedraftContextService: class {
    public forSession = redraftContext;
  },
}));
const runMocks = vi.hoisted(() => ({
  resolveProject: vi.fn(),
  resolveCatalogProject: vi.fn(),
  assertSingleActiveCatalogRun: vi.fn(),
  assertRunOpen: vi.fn(),
  startForCatalogAgent: vi.fn(),
  recordResultBestEffort: vi.fn(),
  resumeAfterQuestions: vi.fn(),
}));
const lastIntakeMocks = vi.hoisted(() => ({ read: vi.fn(), recordStartBestEffort: vi.fn() }));
vi.mock('../services/mktg-last-intake.service', () => ({
  MktgLastIntakeService: class {
    public read = lastIntakeMocks.read;
    public recordStartBestEffort = lastIntakeMocks.recordStartBestEffort;
  },
}));
vi.mock('../services/mktg-document-run.service', () => ({
  MktgDocumentRunService: class {
    public resolveProject = runMocks.resolveProject;
    public resolveCatalogProject = runMocks.resolveCatalogProject;
    public assertSingleActiveCatalogRun = runMocks.assertSingleActiveCatalogRun;
    public assertRunOpen = runMocks.assertRunOpen;
    public startForCatalogAgent = runMocks.startForCatalogAgent;
    public recordResultBestEffort = runMocks.recordResultBestEffort;
    public resumeAfterQuestions = runMocks.resumeAfterQuestions;
  },
}));
const projectMocks = vi.hoisted(() => ({
  getProjectById: vi.fn(),
}));
const brandKitMocks = vi.hoisted(() => ({
  getStoredBrandKit: vi.fn(),
  getResult: vi.fn(),
  startGeneration: vi.fn(),
  sendAnswers: vi.fn(),
}));
const boilerplatesMocks = vi.hoisted(() => ({
  getResult: vi.fn(),
  startGeneration: vi.fn(),
  sendAnswers: vi.fn(),
}));
const icpMocks = vi.hoisted(() => ({
  startGeneration: vi.fn(),
  getResult: vi.fn(),
}));
const validatorMocks = vi.hoisted(() => ({
  validateIcpIntakeAnswers: vi.fn<(answers: unknown) => { valid: boolean; errors: string[] }>(),
}));
const foundationMessageMocks = vi.hoisted(() => ({
  getStoredFoundationMessage: vi.fn(),
  getResult: vi.fn(),
  startGeneration: vi.fn(),
  sendAnswers: vi.fn(),
}));
const faqMocks = vi.hoisted(() => ({
  getResult: vi.fn(),
  startGeneration: vi.fn(),
  sendAnswers: vi.fn(),
}));
const guildMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  sendFollowUp: vi.fn(),
  getHistory: vi.fn(),
  getRawEventPayloads: vi.fn(),
  resolveRunOutcome: vi.fn(async (_req: unknown, _id: string, result: unknown) => result),
}));
const sourceTextMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
}));
const tokenMocks = vi.hoisted(() => ({
  createSessionOwnerToken: vi.fn(),
  verifySessionOwnerToken: vi.fn(() => true),
}));
const authMocks = vi.hoisted(() => ({
  getEffectiveSub: vi.fn((): string | null => 'auth0|user-1'),
  getEffectiveUsername: vi.fn((): string | null => 'user-1'),
}));
const loggerMocks = vi.hoisted(() => ({
  startOperation: vi.fn(() => 0),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@lfx-one/shared/constants', async () => {
  const agents = await vi.importActual<typeof import('@lfx-one/shared/constants/mktg-os-agents.constants')>(
    '../../../../../packages/shared/src/constants/mktg-os-agents.constants'
  );
  const brandKit = await vi.importActual('../../../../../packages/shared/src/constants/brand-kit.constants');
  const artifact = await vi.importActual('../../../../../packages/shared/src/constants/mktg-artifact.constants');
  const foundationMessage = await vi.importActual('../../../../../packages/shared/src/constants/foundation-message.constants');
  const boilerplates = await vi.importActual('../../../../../packages/shared/src/constants/boilerplates.constants');
  const faq = await vi.importActual('../../../../../packages/shared/src/constants/faq.constants');
  const run = await vi.importActual('../../../../../packages/shared/src/constants/mktg-run.constants');
  const documents = await vi.importActual('../../../../../packages/shared/src/constants/mktg-document-store.constants');
  return {
    ...run,
    ...agents,
    ...brandKit,
    ...artifact,
    ...foundationMessage,
    ...boilerplates,
    ...faq,
    ...documents,
    ...(await vi.importActual('../../../../../packages/shared/src/constants/member-360.constants')),
    // Exercise form-only denial while the independently mergeable catalog layer is coming soon.
    MKTG_AGENTS: agents.MKTG_AGENTS.map((agent) => (agent.id === 'member-360' ? { ...agent, status: 'active', guildAgentHandle: 'member-360' } : agent)),
  };
});
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/utils', async () => {
  // The Messaging Framework's, the Brand Kit's, the Boilerplates' and the FAQ's request validators and form builders run for real (pure, Angular-free); the rest are mocked.
  const foundationMessage = await vi.importActual('../../../../../packages/shared/src/utils/foundation-message.utils');
  const brandKit = await vi.importActual('../../../../../packages/shared/src/utils/brand-kit.utils');
  const boilerplates = await vi.importActual('../../../../../packages/shared/src/utils/boilerplates.utils');
  const faq = await vi.importActual('../../../../../packages/shared/src/utils/faq.utils');
  return { ...(foundationMessage as object), ...(brandKit as object), ...(boilerplates as object), ...(faq as object), ...validatorMocks };
});
vi.mock('../services/mktg-source-text.service', () => ({
  MktgSourceTextService: class {
    public readFile = sourceTextMocks.readFile;
  },
}));
vi.mock('../services/guild.service', () => ({
  GuildService: class {
    public resolveRunOutcome = guildMocks.resolveRunOutcome;
    public createSession = guildMocks.createSession;
    public sendFollowUp = guildMocks.sendFollowUp;
    public getHistory = guildMocks.getHistory;
    public getRawEventPayloads = guildMocks.getRawEventPayloads;
  },
}));
vi.mock('../services/brand-kit.service', () => ({
  BrandKitService: class {
    public getStoredBrandKit = brandKitMocks.getStoredBrandKit;
    public getResult = brandKitMocks.getResult;
    public startGeneration = brandKitMocks.startGeneration;
    public sendAnswers = brandKitMocks.sendAnswers;
  },
}));
vi.mock('../services/boilerplates.service', () => ({
  BoilerplatesService: class {
    public getResult = boilerplatesMocks.getResult;
    public startGeneration = boilerplatesMocks.startGeneration;
    public sendAnswers = boilerplatesMocks.sendAnswers;
  },
}));
vi.mock('../services/foundation-message.service', () => ({
  FoundationMessageService: class {
    public getStoredFoundationMessage = foundationMessageMocks.getStoredFoundationMessage;
    public getResult = foundationMessageMocks.getResult;
    public startGeneration = foundationMessageMocks.startGeneration;
    public sendAnswers = foundationMessageMocks.sendAnswers;
  },
}));
vi.mock('../services/faq.service', () => ({
  FaqService: class {
    public getResult = faqMocks.getResult;
    public startGeneration = faqMocks.startGeneration;
    public sendAnswers = faqMocks.sendAnswers;
  },
}));
vi.mock('../services/icp.service', () => ({
  IcpService: class {
    public startGeneration = icpMocks.startGeneration;
    public getResult = icpMocks.getResult;
  },
}));
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectById = projectMocks.getProjectById;
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: loggerMocks,
}));
vi.mock('../utils/auth-helper', () => authMocks);
vi.mock('../utils/mktg-session-token.util', () => tokenMocks);

import type { NextFunction, Request, Response } from 'express';
import {
  FOUNDATION_MESSAGE_ANSWER_MAX_CHARS,
  FOUNDATION_MESSAGE_MAX_OTHER_LINKS,
  MKTG_AGENT_INTAKES,
  MKTG_CHAT_MESSAGE_MAX_CHARS,
} from '@lfx-one/shared/constants';
import { MKTG_INTAKE_ANSWER_LIMITS, MKTG_INTAKE_URL_MAX_CHARS } from '../../../../../packages/shared/src/constants/mktg-intake.constants';
import { validateIcpIntakeAnswers as validateRealIcpIntakeAnswers } from '../../../../../packages/shared/src/utils/icp.utils';

import { AuthenticationError, AuthorizationError, ConflictError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { MktgAgentsController } from './mktg-agents.controller';
import { MKTG_ANSWERS_INCOMPLETE_MESSAGE } from '@lfx-one/shared/constants/mktg-run.constants';

function buildReq(query: Record<string, unknown> = {}): Request {
  return { path: '/api/mktg-agents/brand-kit/stored', query } as unknown as Request;
}

function buildResultReq(body: Record<string, unknown>): Request {
  return { path: '/api/mktg-agents/brand-kit/result', body } as unknown as Request;
}

function buildIcpReq(path: string, body: unknown): Request {
  return { path, body } as unknown as Request;
}

/** The three answers the ICP agent's form contract requires. */
const icpAnswers = (): Record<string, string> => ({
  project_name: ' TestOrbit ',
  github_url: 'https://github.com/example-org/testorbit',
  business_outcome: 'Membership growth',
});

function buildFoundationMessageReq(query: Record<string, unknown> = {}): Request {
  return { path: '/api/mktg-agents/foundation-message/stored', query } as unknown as Request;
}

function buildFoundationMessageResultReq(body: Record<string, unknown>): Request {
  return { path: '/api/mktg-agents/foundation-message/result', body } as unknown as Request;
}

function buildRes(): Response & { json: ReturnType<typeof vi.fn> } {
  return { json: vi.fn() } as unknown as Response & { json: ReturnType<typeof vi.fn> };
}

const STORED = {
  documentMarkdown: '# TestOrbit Brand Kit',
  receipt: { s3_key: 'brand-kit/testorbit/abc.md', content_sha256: 'a'.repeat(64), project: 'testorbit', version: 2, intake_mode: 'form' },
  storedAt: '2026-08-15T00:00:00.000Z',
};

const STORED_FOUNDATION_MESSAGE = {
  documentMarkdown: '{"mf":{},"icp":[],"mh":{},"nums":[]}',
  receipt: {
    s3_key: `documents/proj-uid-1/foundation-message/living/000002-${'b'.repeat(64)}.json`,
    content_sha256: 'b'.repeat(64),
    project: 'proj-uid-1',
    version: 2,
    intake_mode: 'form',
  },
  storedAt: '2026-09-01T00:00:00.000Z',
};

describe('MktgAgentsController', () => {
  const publicRunId = 'b'.repeat(64);
  const acknowledgement = (sessionId: string, extra: Record<string, unknown> = {}) => ({ sessionId, ownerToken: 'owner-token', runId: publicRunId, ...extra });
  const answersRequest = (questionsId = 'a1234567') =>
    buildIcpReq('/api/mktg-agents/answers', {
      sessionId: 'synthetic-session',
      ownerToken: 'synthetic-proof',
      project: 'requested-project',
      questionsId,
      answers: [{ key: 'voice', text: 'Synthetic answer', origin: 'requester' }],
    });
  const chatRequest = (followUp: boolean) =>
    buildIcpReq('/api/mktg-agents/chat', {
      agentId: 'brand-kit',
      message: 'Synthetic request',
      project: 'requested-project',
      ...(followUp && { sessionId: 'synthetic-chat-session', ownerToken: 'synthetic-proof' }),
    });
  let controller: MktgAgentsController;
  let next: NextFunction & ReturnType<typeof vi.fn>;

  async function refusesActive(invoke: () => Promise<void>, start: ReturnType<typeof vi.fn>): Promise<void> {
    const conflict = Object.assign(new Error('Active run'), { statusCode: 409, code: 'MKTG_RUN_ACTIVE' });
    runMocks.assertSingleActiveCatalogRun.mockRejectedValueOnce(conflict);
    await invoke();
    expect(next).toHaveBeenCalledWith(conflict);
    expect(start).not.toHaveBeenCalled();
    expect(runMocks.startForCatalogAgent).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    redraftContext.mockResolvedValue(null);
    // Every accepted Generate must finish even when the optional snapshot never settles.
    lastIntakeMocks.recordStartBestEffort.mockReset().mockImplementation(() => new Promise<void>(() => undefined));
    runMocks.resolveProject.mockReset().mockResolvedValue('proj-uid-1');
    runMocks.resolveCatalogProject.mockImplementation((req: unknown, _agentId: string, raw: unknown) => runMocks.resolveProject(req, raw));
    runMocks.assertRunOpen.mockReset().mockResolvedValue(undefined);
    runMocks.startForCatalogAgent.mockResolvedValue(publicRunId);
    runMocks.recordResultBestEffort.mockResolvedValue(undefined);
    runMocks.resumeAfterQuestions.mockResolvedValue(undefined);
    guildMocks.createSession.mockReset().mockResolvedValue('synthetic-chat-session');
    guildMocks.sendFollowUp.mockReset().mockResolvedValue(undefined);
    validatorMocks.validateIcpIntakeAnswers.mockImplementation(validateRealIcpIntakeAnswers);
    tokenMocks.verifySessionOwnerToken.mockReturnValue(true);
    controller = new MktgAgentsController();
    next = vi.fn() as NextFunction & ReturnType<typeof vi.fn>;
  });

  it('keeps display names but excludes known contacts, emails, caller subjects and raw record extras from history', async () => {
    guildMocks.getHistory.mockResolvedValue([
      {
        id: 'event-1',
        sender: 'agent',
        text: 'Synthetic Staff: ask synthetic-contact via synthetic@example.test (auth0|user-1, oidc|other-subject)',
        timestamp: '10:00',
        rawContacts: [{ email: 'private-record@example.test', sub: 'auth0|private-record' }],
        subject: 'auth0|user-1',
      },
    ]);
    guildMocks.getRawEventPayloads.mockResolvedValue([
      JSON.stringify({ contract: 'member-360-output/v1', tabs: { member_ranking: [{ key_contact: 'synthetic-contact' }] } }),
    ]);
    const json = vi.fn();
    const next = vi.fn();
    await controller.history({ body: { sessionId: 'session-1', ownerToken: 'synthetic-token' } } as Request, { json } as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({
      messages: [
        {
          id: 'event-1',
          sender: 'agent',
          text: 'Synthetic Staff: ask [contact redacted] via [contact redacted] ([contact redacted], [contact redacted])',
          timestamp: '10:00',
        },
      ],
    });
    expect(JSON.stringify(json.mock.calls)).not.toContain('private-record');
    expect(JSON.stringify(json.mock.calls)).not.toContain('auth0|');
    expect(JSON.stringify(json.mock.calls)).not.toContain('other-subject');
  });

  it('redacts a whole known contact containing a provider subject before rewriting identities', async () => {
    const contact = 'Synthetic Contact (oidc|contact-1)';
    guildMocks.getHistory.mockResolvedValue([{ id: 'event-1', sender: 'agent', text: `Ask ${contact}.`, timestamp: '10:00' }]);
    guildMocks.getRawEventPayloads.mockResolvedValue([
      JSON.stringify({ contract: 'member-360-output/v1', tabs: { member_ranking: [{ key_contact: contact }] } }),
    ]);
    const json = vi.fn();
    await controller.history({ body: { sessionId: 'session-1', ownerToken: 'synthetic-token' } } as Request, { json } as unknown as Response, vi.fn());
    expect(json).toHaveBeenCalledWith({ messages: [{ id: 'event-1', sender: 'agent', text: 'Ask [contact redacted].', timestamp: '10:00' }] });
  });

  describe('last intake GET', () => {
    it.each([null, { answers: { website_url: 'https://project.example' }, documentCount: 2, logoCount: 0 }])(
      'returns writer-only history without caching (%s)',
      async (intake) => {
        lastIntakeMocks.read.mockResolvedValueOnce(intake);
        const req = { query: { project: 'synthetic-project' }, params: { agentKey: 'foundation-message' } } as unknown as Request;
        const res = { ...buildRes(), setHeader: vi.fn() };
        await controller.getLastIntake(req, res as unknown as Response, next);
        expect(lastIntakeMocks.read).toHaveBeenCalledWith(req, 'synthetic-project', 'foundation-message');
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
        expect(res.json).toHaveBeenCalledWith({ intake });
        expect(next).not.toHaveBeenCalled();
        expect(guildMocks.createSession).not.toHaveBeenCalled();
      }
    );

    it.each([new AuthorizationError('No write access'), new MicroserviceError('History unavailable', 503, 'TEST')])(
      'delegates denial/outage rather than returning empty history',
      async (failure) => {
        lastIntakeMocks.read.mockRejectedValueOnce(failure);
        const req = { query: { project: 'synthetic-project' }, params: { agentKey: 'faq' } } as unknown as Request;
        const res = { ...buildRes(), setHeader: vi.fn() };
        await controller.getLastIntake(req, res as unknown as Response, next);
        expect(next).toHaveBeenCalledWith(failure);
        expect(res.json).not.toHaveBeenCalled();
      }
    );
  });

  it.each([undefined, 'existing-session'])('rejects dedicated one-off chat for a non-writer (session %s)', async (sessionId) => {
    const dedicated = Object.values(MKTG_AGENT_INTAKES).filter((intake) => intake.oneOffDocument);
    expect(dedicated.length).toBeGreaterThan(0);
    projectMocks.getProjectById.mockResolvedValue({ uid: 'project-one', writer: false });
    for (const intake of dedicated) {
      next.mockClear();
      const res = buildRes();
      await controller.chat(buildIcpReq('/api/mktg-agents/chat', { agentId: intake.agentId, message: 'Synthetic request', sessionId }), res, next);
      expect(next.mock.calls[0]?.[0]).toMatchObject({
        statusCode: 400,
        validationErrors: [expect.objectContaining({ field: 'agentId', message: 'Use the dedicated project-authorized form for this agent.' })],
      });
    }
    expect(guildMocks.createSession).not.toHaveBeenCalled();
    expect(guildMocks.sendFollowUp).not.toHaveBeenCalled();
  });

  describe('Member 360 form-only chat boundary', () => {
    it.each([false, true])('rejects free-text chat (follow-up: %s) before session handling', async (followUp) => {
      const req = {
        path: '/api/mktg-agents/chat',
        body: {
          agentId: 'member-360',
          message: 'Run a report for another project',
          ...(followUp && { sessionId: 'synthetic-session', ownerToken: 'synthetic-token' }),
        },
      } as Request;
      const res = buildRes();
      await controller.chat(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
      expect(res.json).not.toHaveBeenCalled();
      expect(tokenMocks.createSessionOwnerToken).not.toHaveBeenCalled();
      expect(tokenMocks.verifySessionOwnerToken).not.toHaveBeenCalled();
    });
  });

  it('refuses a second catalog chat before creating its Guild session', async () => {
    const req = chatRequest(false);
    req.body.discard = 'a'.repeat(64);
    await refusesActive(() => controller.chat(req, buildRes(), next), guildMocks.createSession);
    expect(runMocks.assertSingleActiveCatalogRun).toHaveBeenCalledWith(req, 'proj-uid-1', 'brand-kit', 'a'.repeat(64));
  });

  it('checks the live session before sending a chat follow-up without treating it as a second start', async () => {
    const req = chatRequest(true);
    await controller.chat(req, buildRes(), next);
    expect(runMocks.assertRunOpen).toHaveBeenCalledWith(req, 'proj-uid-1', 'brand-kit', req.body.sessionId);
    expect(runMocks.assertRunOpen.mock.invocationCallOrder[0]).toBeLessThan(guildMocks.sendFollowUp.mock.invocationCallOrder[0]);
    expect(runMocks.assertSingleActiveCatalogRun).not.toHaveBeenCalled();
    expect(guildMocks.sendFollowUp).toHaveBeenCalled();
  });

  it('refuses a discarded chat session before sending or recording a follow-up', async () => {
    const closed = new ConflictError('This run was closed.', 'MKTG_RUN_CLOSED');
    runMocks.assertRunOpen.mockRejectedValueOnce(closed);
    await controller.chat(chatRequest(true), buildRes(), next);
    expect(next).toHaveBeenCalledWith(closed);
    expect(closed.statusCode).toBe(409);
    expect(guildMocks.sendFollowUp).not.toHaveBeenCalled();
    expect(runMocks.startForCatalogAgent).not.toHaveBeenCalled();
  });

  it('does not start an ICP session when the project/store preflight fails', async () => {
    const failure = ServiceValidationError.forField('project', 'Synthetic unavailable project');
    runMocks.resolveProject.mockRejectedValueOnce(failure);
    await controller.generateIcp(buildIcpReq('/api/mktg-agents/icp/generate', { answers: icpAnswers(), project: 'synthetic-project' }), buildRes(), next);
    expect(next).toHaveBeenCalledWith(failure);
    expect(icpMocks.startGeneration).not.toHaveBeenCalled();
    expect(lastIntakeMocks.recordStartBestEffort).not.toHaveBeenCalled();
  });

  for (const [method, adapter] of [
    ['brandKitAnswers', brandKitMocks],
    ['foundationMessageAnswers', foundationMessageMocks],
    ['boilerplatesAnswers', boilerplatesMocks],
    ['faqAnswers', faqMocks],
  ] as const) {
    it(`${method}: returns a plain 400 for a non-answer without sending or resuming`, async () => {
      const req = answersRequest();
      req.body.answers = [{ key: 'voice', text: 'skip', origin: 'requester' }];
      const res = buildRes();
      await controller[method](req, res, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          validationErrors: [{ code: 'FIELD_VALIDATION_ERROR', field: 'answers', message: `${MKTG_ANSWERS_INCOMPLETE_MESSAGE}: voice` }],
        })
      );
      expect(adapter.sendAnswers).not.toHaveBeenCalled();
      expect(runMocks.resumeAfterQuestions).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
    it(`${method}: refuses free-text answers on a redraft-bound SID after owner proof`, async () => {
      redraftContext.mockResolvedValue({ runId: 'c'.repeat(64) });
      const req = answersRequest();
      await controller[method](req, buildRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
      expect(adapter.sendAnswers).not.toHaveBeenCalled();
      expect(runMocks.resumeAfterQuestions).not.toHaveBeenCalled();
      expect(tokenMocks.verifySessionOwnerToken.mock.invocationCallOrder[0]).toBeLessThan(redraftContext.mock.invocationCallOrder[0]);
    });
    it.each(['discarded', 'superseded'])(`${method}: refuses answers on a %s session before Guild`, async (state) => {
      const failure = new ConflictError(`This run was ${state}.`, 'MKTG_RUN_CLOSED');
      runMocks.assertRunOpen.mockRejectedValueOnce(failure);
      await controller[method](answersRequest(), buildRes(), next);
      expect(next).toHaveBeenCalledWith(failure);
      expect(adapter.sendAnswers).not.toHaveBeenCalled();
      expect(runMocks.resumeAfterQuestions).not.toHaveBeenCalled();
    });
    it(`${method}: omitted project cannot bypass the scoped check`, async () => {
      const req = answersRequest();
      delete req.body.project;
      const failure = ServiceValidationError.forField('project', 'Project is required.');
      runMocks.resolveProject.mockRejectedValueOnce(failure);
      await controller[method](req, buildRes(), next);
      expect(runMocks.resolveProject).toHaveBeenCalledWith(req, undefined);
      expect(next).toHaveBeenCalledWith(failure);
      expect(adapter.sendAnswers).not.toHaveBeenCalled();
    });
    it(`${method}: resolves canonical scope before answers and resumes only after accepted send`, async () => {
      runMocks.resolveProject.mockResolvedValueOnce('resolved-project');
      const req = answersRequest();
      const res = buildRes();
      await controller[method](req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(runMocks.resolveProject).toHaveBeenCalledWith(req, 'requested-project');
      expect(runMocks.resumeAfterQuestions).toHaveBeenCalledWith(req, 'resolved-project', 'synthetic-session', 'a1234567');
      expect(runMocks.resolveProject.mock.invocationCallOrder[0]).toBeLessThan(runMocks.assertRunOpen.mock.invocationCallOrder[0]);
      expect(runMocks.assertRunOpen).toHaveBeenCalledWith(req, 'resolved-project', expect.any(String), 'synthetic-session');
      expect(runMocks.assertRunOpen.mock.invocationCallOrder[0]).toBeLessThan(adapter.sendAnswers.mock.invocationCallOrder[0]);
      expect(adapter.sendAnswers.mock.invocationCallOrder[0]).toBeLessThan(runMocks.resumeAfterQuestions.mock.invocationCallOrder[0]);
    });
    it(`${method}: malformed questions and failed preflight never reach Guild`, async () => {
      await controller[method](answersRequest('../bad'), buildRes(), next);
      expect(runMocks.resolveProject).not.toHaveBeenCalled();
      expect(adapter.sendAnswers).not.toHaveBeenCalled();
      const failure = ServiceValidationError.forField('project', 'Synthetic unavailable scope');
      runMocks.resolveProject.mockRejectedValueOnce(failure);
      await controller[method](answersRequest(), buildRes(), next);
      expect(runMocks.resolveProject).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenLastCalledWith(failure);
      expect(adapter.sendAnswers).not.toHaveBeenCalled();
      expect(runMocks.resumeAfterQuestions).not.toHaveBeenCalled();
    });
  }

  it.each([false, true])('checks redraft binding after owner proof and preserves ordinary chat (bound=%s)', async (bound) => {
    redraftContext.mockResolvedValue(bound ? { runId: 'd'.repeat(64) } : null);
    await controller.chat(chatRequest(true), buildRes(), next);
    expect(tokenMocks.verifySessionOwnerToken.mock.invocationCallOrder[0]).toBeLessThan(redraftContext.mock.invocationCallOrder[0]);
    if (bound) {
      expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
      expect(guildMocks.sendFollowUp).not.toHaveBeenCalled();
      expect(guildMocks.createSession).not.toHaveBeenCalled();
    } else {
      expect(next).not.toHaveBeenCalled();
      expect(guildMocks.sendFollowUp).toHaveBeenCalledTimes(1);
    }
  });

  it.each([false, true])('chat tracks a new session/follow-up (%s) only after preflight and accepted Guild send', async (followUp) => {
    tokenMocks.createSessionOwnerToken.mockReturnValue('synthetic-proof');
    const req = chatRequest(followUp);
    const res = buildRes();
    await controller.chat(req, res, next);
    expect(next).not.toHaveBeenCalled();
    const send = followUp ? guildMocks.sendFollowUp : guildMocks.createSession;
    expect(runMocks.resolveCatalogProject).toHaveBeenCalledWith(req, 'brand-kit', 'requested-project');
    expect(runMocks.resolveCatalogProject.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(runMocks.startForCatalogAgent.mock.invocationCallOrder[0]);
    expect(runMocks.startForCatalogAgent.mock.invocationCallOrder[0]).toBeLessThan(res.json.mock.invocationCallOrder[0]);
    const call = runMocks.startForCatalogAgent.mock.calls[0];
    expect(call.slice(0, 5)).toEqual([req, 'brand-kit', 'proj-uid-1', 'synthetic-chat-session', 0]);
    expect(call[5]).toEqual(expect.any(String));
    if (followUp) expect(call[5]).not.toBe('initial');
  });

  it('does not track a chat turn rejected by Guild', async () => {
    guildMocks.sendFollowUp.mockRejectedValueOnce(new Error('Synthetic Guild failure'));
    await controller.chat(chatRequest(true), buildRes(), next);
    expect(runMocks.startForCatalogAgent).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  describe('chat message size cap', () => {
    it.each([undefined, 'existing-session'])('rejects a message over the cap before any Guild call (session %s)', async (sessionId) => {
      const req = buildIcpReq('/api/mktg-agents/chat', {
        agentId: 'member-360',
        message: 'a'.repeat(MKTG_CHAT_MESSAGE_MAX_CHARS + 1),
        sessionId,
        ownerToken: 'synthetic-token',
      });
      const res = buildRes();

      await controller.chat(req, res, next);

      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400, validationErrors: [expect.objectContaining({ field: 'message' })] });
      expect(guildMocks.createSession).not.toHaveBeenCalled();
      expect(guildMocks.sendFollowUp).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('measures the trimmed message, so one exactly at the cap passes the size gate', async () => {
      const req = buildIcpReq('/api/mktg-agents/chat', { agentId: 'member-360', message: `  ${'a'.repeat(MKTG_CHAT_MESSAGE_MAX_CHARS)}\n` });

      await controller.chat(req, buildRes(), next);

      // member-360 is form-only, so the request stops at the later agent gate —
      // proof the message cleared the size gate.
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400, validationErrors: [expect.objectContaining({ field: 'agentId' })] });
    });
  });

  describe('intake answer size caps', () => {
    const frameworkAnswers = {
      project_name: 'Synthetic Project',
      website_url: 'https://project.example',
      messaging_framework: '{"mf":{"positioning":"Synthetic positioning"}}',
    };
    const cases = [
      { agentId: 'icp', method: 'generateIcp', adapter: icpMocks, answers: icpAnswers() },
      { agentId: 'brand-kit', method: 'generateBrandKit', adapter: brandKitMocks, answers: frameworkAnswers },
      {
        agentId: 'foundation-setup',
        method: 'generateFoundationMessage',
        adapter: foundationMessageMocks,
        answers: { project_name: 'Synthetic Project', website_url: 'https://project.example' },
      },
      { agentId: 'boilerplates', method: 'generateBoilerplates', adapter: boilerplatesMocks, answers: frameworkAnswers },
      { agentId: 'faq', method: 'generateFaq', adapter: faqMocks, answers: frameworkAnswers },
    ] as const;

    function atLimit(key: string, maxChars: number): string {
      if (key === 'messaging_framework') {
        const prefix = '{"mf":{"positioning":"';
        const suffix = '"}}';
        return prefix + 'x'.repeat(maxChars - prefix.length - suffix.length) + suffix;
      }
      if (key === 'links') {
        return ('https://source.example/'.padEnd(MKTG_INTAKE_URL_MAX_CHARS, 'x') + '\r\n').repeat(FOUNDATION_MESSAGE_MAX_OTHER_LINKS);
      }
      if (key.endsWith('_url')) {
        return 'https://source.example/'.padEnd(maxChars, 'x');
      }
      return 'x'.repeat(maxChars);
    }

    describe.each(cases)('$agentId generate endpoint', ({ agentId, method, adapter, answers }) => {
      const endpoint = agentId === 'foundation-setup' ? 'foundation-message' : agentId;
      const path = `/api/mktg-agents/${endpoint}/generate`;

      it.each(Object.entries(MKTG_INTAKE_ANSWER_LIMITS[agentId]))('accepts %s exactly at its %i-character limit', async (key, maxChars) => {
        const value = atLimit(key, maxChars);
        expect(value.length).toBe(maxChars);
        adapter.startGeneration.mockResolvedValue(
          agentId === 'icp' ? { sessionId: 'synthetic-intake-session', readme: { fetched: false, skipReason: 'no-readme' } } : 'synthetic-intake-session'
        );
        const res = buildRes();

        await controller[method](buildIcpReq(path, { answers: { ...answers, [key]: value } }), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(adapter.startGeneration).toHaveBeenCalledTimes(1);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'synthetic-intake-session' }));
      });

      it.each(Object.entries(MKTG_INTAKE_ANSWER_LIMITS[agentId]))('rejects %s over its %i-character limit before generation', async (key, maxChars) => {
        const res = buildRes();

        await controller[method](buildIcpReq(path, { answers: { ...answers, [key]: atLimit(key, maxChars) + 'x' } }), res, next);

        expect(next.mock.calls[0]?.[0]).toMatchObject({
          statusCode: 400,
          validationErrors: [{ field: 'answers', message: `answers.${key} must be at most ${maxChars} characters` }],
        });
        for (const candidate of cases) {
          expect(candidate.adapter.startGeneration).not.toHaveBeenCalled();
        }
        expect(guildMocks.createSession).not.toHaveBeenCalled();
        expect(guildMocks.sendFollowUp).not.toHaveBeenCalled();
        expect(runMocks.resolveProject).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
      });
    });

    it('rejects an oversized individual URL even when the links answer is below its aggregate cap', async () => {
      await controller.generateFoundationMessage(
        buildIcpReq('/api/mktg-agents/foundation-message/generate', {
          answers: {
            project_name: 'Synthetic Project',
            website_url: 'https://project.example',
            links: 'https://source.example/'.padEnd(MKTG_INTAKE_URL_MAX_CHARS + 1, 'x'),
          },
        }),
        buildRes(),
        next
      );

      expect(next.mock.calls[0]?.[0]).toMatchObject({
        statusCode: 400,
        validationErrors: [{ field: 'answers', message: `answers.links URLs must be at most ${MKTG_INTAKE_URL_MAX_CHARS} characters each` }],
      });
      expect(foundationMessageMocks.startGeneration).not.toHaveBeenCalled();
      expect(guildMocks.createSession).not.toHaveBeenCalled();
    });
  });

  describe('storedBrandKit (GET /api/mktg-agents/brand-kit/stored)', () => {
    it('rejects a missing project query param with a validation error, resolving nothing', async () => {
      const res = buildRes();

      await controller.storedBrandKit(buildReq(), res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
      expect(projectMocks.getProjectById).not.toHaveBeenCalled();
      expect(brandKitMocks.getStoredBrandKit).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it.each(['../projects/other', 'proj/../../admin', 'proj-uid-1?access=all', 'proj-uid-1#frag', 'proj uid'])(
      'refuses %j before the upstream lookup — a uid is one path segment, never a URL fragment',
      async (projectUid) => {
        const res = buildRes();

        await controller.storedBrandKit(buildReq({ project: projectUid }), res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
        // `getProjectById` interpolates the uid unencoded into
        // `/projects/{uid}`, so the gate has to run BEFORE the authenticated
        // upstream request the writer check is read from.
        expect(projectMocks.getProjectById).not.toHaveBeenCalled();
        expect(brandKitMocks.getStoredBrandKit).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
      }
    );

    it('serves the stored document to a writer-entitled caller, partitioned by the SERVER-resolved project uid', async () => {
      projectMocks.getProjectById.mockResolvedValue({ uid: 'proj-uid-1', slug: 'testorbit', writer: true });
      brandKitMocks.getStoredBrandKit.mockResolvedValue(STORED);
      const req = buildReq({ project: 'proj-uid-1' });
      const res = buildRes();

      await controller.storedBrandKit(req, res, next);

      expect(next).not.toHaveBeenCalled();
      // The entitlement lookup runs with the access annotation requested.
      expect(projectMocks.getProjectById).toHaveBeenCalledWith(req, 'proj-uid-1', true);
      // The partition comes from the RESOLVED project's uid — never the raw
      // client input, and never the agent's own slug — so a caller can never
      // address another partition and the write path addresses the same one.
      expect(brandKitMocks.getStoredBrandKit).toHaveBeenCalledWith(req, 'proj-uid-1', false);
      expect(res.json).toHaveBeenCalledWith(STORED);
    });

    it('serves the latest revision with its sidecar and date on ?sidecar=true — what a print reads the kit from — and 404s when there is none', async () => {
      projectMocks.getProjectById.mockResolvedValue({ uid: 'proj-uid-1', slug: 'testorbit', writer: true });
      const latest = { ...STORED, storedAt: '2026-10-18T09:00:00.000Z', revisionNumber: 3, sidecar: { contract: 'brand-kit-output/v1' } };
      brandKitMocks.getStoredBrandKit.mockResolvedValue(latest);
      const req = buildReq({ project: 'proj-uid-1', sidecar: 'true' });
      const res = buildRes();

      await controller.storedBrandKit(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(brandKitMocks.getStoredBrandKit).toHaveBeenCalledWith(req, 'proj-uid-1', true);
      expect(res.json).toHaveBeenCalledWith(latest);

      brandKitMocks.getStoredBrandKit.mockResolvedValue(null);
      await controller.storedBrandKit(buildReq({ project: 'proj-uid-1', sidecar: 'true' }), buildRes(), next);

      expect(next.mock.calls[0][0]).toBeInstanceOf(ResourceNotFoundError);
    });

    it('denies a caller without the project writer entitlement before any storage read (403)', async () => {
      projectMocks.getProjectById.mockResolvedValue({ uid: 'proj-uid-1', slug: 'testorbit', writer: false });
      const res = buildRes();

      await controller.storedBrandKit(buildReq({ project: 'proj-uid-1' }), res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(next.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
      expect(brandKitMocks.getStoredBrandKit).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('returns 404 when the project has no stored Brand Kit', async () => {
      projectMocks.getProjectById.mockResolvedValue({ uid: 'proj-uid-1', slug: 'testorbit', writer: true });
      brandKitMocks.getStoredBrandKit.mockResolvedValue(null);
      const res = buildRes();

      await controller.storedBrandKit(buildReq({ project: 'proj-uid-1' }), res, next);

      expect(next).toHaveBeenCalledOnce();
      const error = next.mock.calls[0][0];
      expect(error).toBeInstanceOf(ResourceNotFoundError);
      expect((error as ResourceNotFoundError).statusCode).toBe(404);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('reports 404 with the resolved uid, never the caller’s raw input, as the missing resource id', async () => {
      projectMocks.getProjectById.mockResolvedValue({ uid: 'proj-uid-1', slug: 'testorbit', writer: true });
      brandKitMocks.getStoredBrandKit.mockResolvedValue(null);

      await controller.storedBrandKit(buildReq({ project: 'proj-uid-1' }), buildRes(), next);

      expect((next.mock.calls[0][0] as ResourceNotFoundError).message).toContain('proj-uid-1');
    });

    it('forwards a project-resolution failure (unknown uid / upstream error) to the error handler', async () => {
      const failure = new ResourceNotFoundError('Project', 'proj-uid-1');
      projectMocks.getProjectById.mockRejectedValue(failure);
      const res = buildRes();

      await controller.storedBrandKit(buildReq({ project: 'proj-uid-1' }), res, next);

      expect(next).toHaveBeenCalledWith(failure);
      expect(brandKitMocks.getStoredBrandKit).not.toHaveBeenCalled();
    });
  });

  describe('generateBrandKit (POST /api/mktg-agents/brand-kit/generate)', () => {
    const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    /** The approved framework sidecar as the run page attaches it, serialized. */
    const FRAMEWORK = '{"contract":"messaging-document-output/v1","fields":{"md.tagline":{"value":"Open standards","source":"Site","status":"approved"}}}';
    const brandKitAnswers = (): Record<string, string> => ({
      project_name: ' TestOrbit ',
      website_url: 'https://testorbit.example.org',
      brand_page_url: 'none',
      notes: '  ',
      messaging_framework: FRAMEWORK,
    });

    it('refuses an active Brand Kit before starting a Guild session', async () => {
      const req = buildIcpReq('/api/mktg-agents/brand-kit/generate', { answers: brandKitAnswers(), project: 'synthetic-project', discard: 'a'.repeat(64) });
      await refusesActive(() => controller.generateBrandKit(req, buildRes(), next), brandKitMocks.startGeneration);
      expect(runMocks.assertSingleActiveCatalogRun).toHaveBeenCalledWith(req, 'proj-uid-1', 'brand-kit', 'a'.repeat(64));
    });

    it('routes with the catalog handle, passes the trimmed answers, the logo files and the project uid, and mints an owner token', async () => {
      brandKitMocks.startGeneration.mockResolvedValue('sess-bk');
      tokenMocks.createSessionOwnerToken.mockReturnValue('owner-token');
      const req = buildIcpReq('/api/mktg-agents/brand-kit/generate', {
        answers: brandKitAnswers(),
        logoFiles: [
          { name: ' testorbit.svg ', text: SVG },
          { name: 'symbol.svg', url: 'https://testorbit.example.org/symbol.svg' },
        ],
        project: 'proj-uid-1',
      });
      const res = buildRes();

      await controller.generateBrandKit(req, res, next);

      expect(next).not.toHaveBeenCalled();
      // Blank optionals are dropped so the renderer takes its "none" branch; file names are trimmed, contents pass through verbatim.
      expect(brandKitMocks.startGeneration).toHaveBeenCalledWith(
        req,
        { project_name: 'TestOrbit', website_url: 'https://testorbit.example.org', brand_page_url: 'none', messaging_framework: FRAMEWORK },
        [
          { name: 'testorbit.svg', text: SVG },
          { name: 'symbol.svg', url: 'https://testorbit.example.org/symbol.svg' },
        ],
        'proj-uid-1',
        'brand-kit'
      );
      expect(lastIntakeMocks.recordStartBestEffort).toHaveBeenCalledWith(
        req,
        expect.objectContaining({
          project: 'proj-uid-1',
          agentId: 'brand-kit',
          runId: publicRunId,
          documentCount: 0,
          logoCount: 2,
          answers: req.body.answers,
        })
      );
      expect(res.json.mock.invocationCallOrder[0]).toBeLessThan(lastIntakeMocks.recordStartBestEffort.mock.invocationCallOrder[0]);
      expect(res.json).toHaveBeenCalledWith(acknowledgement('sess-bk'));
      expect(runMocks.startForCatalogAgent).toHaveBeenCalledWith(req, 'brand-kit', 'proj-uid-1', 'sess-bk', 0, 'initial');
      expect(runMocks.resolveProject.mock.invocationCallOrder[0]).toBeLessThan(brandKitMocks.startGeneration.mock.invocationCallOrder[0]);
      expect(runMocks.startForCatalogAgent.mock.invocationCallOrder[0]).toBeLessThan(res.json.mock.invocationCallOrder[0]);
    });

    it('does not fail or leak a rejected detached snapshot after the Generate ACK', async () => {
      brandKitMocks.startGeneration.mockResolvedValue('sess-bk');
      tokenMocks.createSessionOwnerToken.mockReturnValue('owner-token');
      lastIntakeMocks.recordStartBestEffort.mockRejectedValueOnce(new MicroserviceError('private-body-marker', 503, 'TEST'));
      const res = buildRes();
      await controller.generateBrandKit(buildIcpReq('/api/mktg-agents/brand-kit/generate', { answers: brandKitAnswers(), project: 'proj-uid-1' }), res, next);
      await Promise.resolve();
      expect(res.json).toHaveBeenCalledWith(acknowledgement('sess-bk'));
      expect(next).not.toHaveBeenCalled();
      expect(loggerMocks.warning).toHaveBeenCalledWith(expect.anything(), 'mktg_last_intake_write', expect.any(String));
      expect(JSON.stringify(loggerMocks.warning.mock.calls)).not.toContain('private-body-marker');
    });

    it('refuses a form without the website, without the messaging framework, a logo file with two contents, and a feedback or prior version', async () => {
      await controller.generateBrandKit(buildIcpReq('/api/mktg-agents/brand-kit/generate', { answers: { project_name: 'TestOrbit' } }), buildRes(), next);
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);

      // The run order is the messaging framework first: a form without its JSON never reaches the agent.
      next.mockClear();
      const withoutFramework: Record<string, string> = brandKitAnswers();
      delete withoutFramework['messaging_framework'];
      await controller.generateBrandKit(buildIcpReq('/api/mktg-agents/brand-kit/generate', { answers: withoutFramework }), buildRes(), next);
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
      expect((next.mock.calls[0][0] as ServiceValidationError).validationErrors[0].message).toContain('Approve a messaging framework first');

      next.mockClear();
      await controller.generateBrandKit(
        buildIcpReq('/api/mktg-agents/brand-kit/generate', { answers: brandKitAnswers(), logoFiles: [{ name: 'a.svg', text: SVG, base64: 'AA==' }] }),
        buildRes(),
        next
      );
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);

      next.mockClear();
      await controller.generateBrandKit(buildIcpReq('/api/mktg-agents/brand-kit/generate', { answers: brandKitAnswers(), priorVersion: 1 }), buildRes(), next);
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
      expect(brandKitMocks.startGeneration).not.toHaveBeenCalled();
    });
  });

  describe('brandKitAnswers (POST /api/mktg-agents/brand-kit/answers)', () => {
    it('sends the trimmed answers on the same session, routed by the catalog handle', async () => {
      brandKitMocks.sendAnswers.mockResolvedValue(undefined);
      const req = buildIcpReq('/api/mktg-agents/brand-kit/answers', {
        sessionId: 'sess-bk',
        ownerToken: 'token-1',
        answers: [{ key: 'voice', text: ' Open standards for orbital computing ', origin: 'accepted' }],
      });
      const res = buildRes();

      await controller.brandKitAnswers(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(brandKitMocks.sendAnswers).toHaveBeenCalledWith(
        req,
        'sess-bk',
        [{ key: 'voice', text: 'Open standards for orbital computing', origin: 'accepted' }],
        'brand-kit'
      );
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('refuses an answer key that is not one of the four gaps, and never posts when the owner token does not verify', async () => {
      await controller.brandKitAnswers(
        buildIcpReq('/api/mktg-agents/brand-kit/answers', {
          sessionId: 'sess-bk',
          ownerToken: 'token-1',
          answers: [{ key: 'audiences', text: 'Engineers', origin: 'requester' }],
        }),
        buildRes(),
        next
      );
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);

      next.mockClear();
      tokenMocks.verifySessionOwnerToken.mockReturnValueOnce(false);
      await controller.brandKitAnswers(
        buildIcpReq('/api/mktg-agents/brand-kit/answers', {
          sessionId: 'sess-bk',
          ownerToken: 'nope',
          answers: [{ key: 'voice', text: 'A line', origin: 'requester' }],
        }),
        buildRes(),
        next
      );
      expect(next.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
      expect(brandKitMocks.sendAnswers).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['brandKitResult', brandKitMocks],
    ['foundationMessageResult', foundationMessageMocks],
    ['boilerplatesResult', boilerplatesMocks],
    ['icpResult', icpMocks],
    ['faqResult', faqMocks],
  ] as const)('%s tracks the resolved provider failure, never the earlier pending outcome', async (method, service) => {
    const pending = { status: 'pending' };
    const failed = { status: 'failed', failure: { eventType: 'runtime_error', reason: 'The agent could not complete this run. Retry.' } };
    service.getResult.mockResolvedValueOnce(pending);
    guildMocks.resolveRunOutcome.mockResolvedValueOnce(failed);
    const req = buildResultReq({ sessionId: 'sess-1', ownerToken: 'token-1', project: 'proj-uid-1' });
    const res = buildRes();
    runMocks.recordResultBestEffort.mockImplementationOnce(async () => {
      expect(loggerMocks.success).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    await controller[method](req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(guildMocks.resolveRunOutcome).toHaveBeenCalledWith(req, 'sess-1', pending);
    expect(runMocks.recordResultBestEffort).toHaveBeenCalledWith(req, 'sess-1', failed, 'proj-uid-1');
    expect(res.json).toHaveBeenCalledWith(failed);
  });

  describe('brandKitResult (POST /api/mktg-agents/brand-kit/result)', () => {
    it('preserves the ready result and project scope through best-effort tracking', async () => {
      const result = { status: 'ready', documentMarkdown: '# Synthetic result', version: 1 };
      brandKitMocks.getResult.mockResolvedValue(result);
      const req = buildResultReq({ sessionId: 'sess-1', ownerToken: 'token-1', project: ' proj-uid-1 ' });
      const res = buildRes();

      await controller.brandKitResult(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(brandKitMocks.getResult).toHaveBeenCalledWith(req, 'sess-1', 'proj-uid-1');
      expect(runMocks.recordResultBestEffort).toHaveBeenCalledWith(req, 'sess-1', result, 'proj-uid-1');
      expect(res.json).toHaveBeenCalledWith(result);
    });

    it('treats a non-string / blank project as no scope rather than coercing it into a partition', async () => {
      brandKitMocks.getResult.mockResolvedValue({ status: 'pending' });
      const req = buildResultReq({ sessionId: 'sess-1', ownerToken: 'token-1', project: { uid: 'proj-uid-1' } });

      await controller.brandKitResult(req, buildRes(), next);

      expect(brandKitMocks.getResult).toHaveBeenCalledWith(req, 'sess-1', undefined);
    });

    it('never reaches the service when the owner token does not verify', async () => {
      tokenMocks.verifySessionOwnerToken.mockReturnValueOnce(false);

      await controller.brandKitResult(buildResultReq({ sessionId: 'sess-1', ownerToken: 'nope', project: 'proj-uid-1' }), buildRes(), next);

      expect(next.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
      expect(brandKitMocks.getResult).not.toHaveBeenCalled();
    });
  });

  describe('generateIcp (POST /api/mktg-agents/icp/generate)', () => {
    it('refuses an active ICP before starting a Guild session', async () => {
      await refusesActive(
        () => controller.generateIcp(buildIcpReq('/api/mktg-agents/icp/generate', { answers: icpAnswers(), project: 'synthetic-project' }), buildRes(), next),
        icpMocks.startGeneration
      );
    });
    it('routes with the catalog handle and mints a creator-binding owner token', async () => {
      icpMocks.startGeneration.mockResolvedValue({ sessionId: 'sess-icp', readme: { fetched: true, source: 'repository' } });
      tokenMocks.createSessionOwnerToken.mockReturnValue('owner-token');
      const req = buildIcpReq('/api/mktg-agents/icp/generate', { answers: icpAnswers() });
      const res = buildRes();

      await controller.generateIcp(req, res, next);

      expect(next).not.toHaveBeenCalled();
      // Answers are trimmed before submission and the handle comes from the
      // shared catalog, never from the client.
      expect(icpMocks.startGeneration).toHaveBeenCalledWith(
        req,
        expect.objectContaining({ project_name: 'TestOrbit' }),
        { feedback: undefined, priorVersion: undefined },
        'icp'
      );
      expect(lastIntakeMocks.recordStartBestEffort).toHaveBeenCalledWith(
        req,
        expect.objectContaining({ project: 'proj-uid-1', agentId: 'icp', runId: publicRunId, documentCount: 0, logoCount: 0 })
      );
      expect(res.json).toHaveBeenCalledWith(acknowledgement('sess-icp', { readme: { fetched: true, source: 'repository' } }));
    });

    it('drops blank optional answers so the agent takes its documented "not provided" branch', async () => {
      icpMocks.startGeneration.mockResolvedValue({ sessionId: 'sess-icp', readme: { fetched: false, skipReason: 'no-readme' } });
      const req = buildIcpReq('/api/mktg-agents/icp/generate', { answers: { ...icpAnswers(), competitive_landscape: '   ' } });

      await controller.generateIcp(req, buildRes(), next);

      expect(icpMocks.startGeneration.mock.calls[0][1]).not.toHaveProperty('competitive_landscape');
    });

    it('trims the sibling documents before they reach the service, whatever the client posted', async () => {
      // The payload builder passes sibling documents through verbatim; the
      // controller is the only trim, so this pins the bytes the API path
      // actually hands to the service (see icp.utils.spec for the util-level
      // pass-through property).
      icpMocks.startGeneration.mockResolvedValue({ sessionId: 'sess-icp', readme: { fetched: false, skipReason: 'no-readme' } });
      const req = buildIcpReq('/api/mktg-agents/icp/generate', {
        answers: { ...icpAnswers(), brand_kit_markdown: '\n# TestOrbit Brand Kit\n', message_foundation_markdown: '  \n  ' },
      });

      await controller.generateIcp(req, buildRes(), next);

      expect(next).not.toHaveBeenCalled();
      const submitted = icpMocks.startGeneration.mock.calls[0][1] as Record<string, string>;
      expect(submitted['brand_kit_markdown']).toBe('# TestOrbit Brand Kit');
      expect(submitted).not.toHaveProperty('message_foundation_markdown');
    });

    it('rejects answers that fail the agent’s form contract before any session is created', async () => {
      validatorMocks.validateIcpIntakeAnswers.mockReturnValue({
        valid: false,
        errors: ['answers.business_outcome is required and must be a non-empty string'],
      });

      await controller.generateIcp(buildIcpReq('/api/mktg-agents/icp/generate', { answers: {} }), buildRes(), next);

      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
      expect(icpMocks.startGeneration).not.toHaveBeenCalled();
    });

    it('rejects a prior version that is not a positive integer', async () => {
      await controller.generateIcp(buildIcpReq('/api/mktg-agents/icp/generate', { answers: icpAnswers(), priorVersion: 0 }), buildRes(), next);

      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
      expect(icpMocks.startGeneration).not.toHaveBeenCalled();
    });

    it('rejects a non-string feedback rather than coercing it', async () => {
      await controller.generateIcp(buildIcpReq('/api/mktg-agents/icp/generate', { answers: icpAnswers(), feedback: 42 }), buildRes(), next);

      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
      expect(icpMocks.startGeneration).not.toHaveBeenCalled();
    });

    it('rejects feedback over the per-answer cap before starting a generation', async () => {
      await controller.generateIcp(
        buildIcpReq('/api/mktg-agents/icp/generate', { answers: icpAnswers(), feedback: 'f'.repeat(FOUNDATION_MESSAGE_ANSWER_MAX_CHARS + 1), priorVersion: 1 }),
        buildRes(),
        next
      );

      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400, validationErrors: [expect.objectContaining({ field: 'feedback' })] });
      expect(icpMocks.startGeneration).not.toHaveBeenCalled();
    });

    it('measures the trimmed feedback, so one exactly at the cap starts a generation', async () => {
      icpMocks.startGeneration.mockResolvedValue({ sessionId: 'sess-icp', readme: { fetched: true, source: 'repository' } });
      const feedback = `  ${'f'.repeat(FOUNDATION_MESSAGE_ANSWER_MAX_CHARS)}\n`;

      await controller.generateIcp(buildIcpReq('/api/mktg-agents/icp/generate', { answers: icpAnswers(), feedback, priorVersion: 1 }), buildRes(), next);

      expect(next).not.toHaveBeenCalled();
      expect(icpMocks.startGeneration).toHaveBeenCalledWith(expect.anything(), expect.anything(), { feedback, priorVersion: 1 }, 'icp');
    });

    it('rejects feedback without a prior version so a first document is never finalized as v2', async () => {
      await controller.generateIcp(buildIcpReq('/api/mktg-agents/icp/generate', { answers: icpAnswers(), feedback: 'Sharpen persona two.' }), buildRes(), next);

      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
      expect(icpMocks.startGeneration).not.toHaveBeenCalled();
    });

    it('still accepts a blank feedback string on a first run (the UI sends the empty control value)', async () => {
      icpMocks.startGeneration.mockResolvedValue({ sessionId: 'sess-icp', readme: { fetched: false, skipReason: 'no-readme' } });

      await controller.generateIcp(buildIcpReq('/api/mktg-agents/icp/generate', { answers: icpAnswers(), feedback: '   ' }), buildRes(), next);

      expect(next).not.toHaveBeenCalled();
      expect(icpMocks.startGeneration).toHaveBeenCalledTimes(1);
    });

    it('treats a missing body as a validation error, never a throw', async () => {
      validatorMocks.validateIcpIntakeAnswers.mockReturnValue({ valid: false, errors: ['answers must be an object keyed by intake field key'] });

      await controller.generateIcp(buildIcpReq('/api/mktg-agents/icp/generate', undefined), buildRes(), next);

      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    });
  });

  describe('icpResult (POST /api/mktg-agents/icp/result)', () => {
    it('passes the run’s project scope to the service so the write is entitlement-checked and partitioned', async () => {
      icpMocks.getResult.mockResolvedValue({ status: 'pending' });
      const req = buildIcpReq('/api/mktg-agents/icp/result', { sessionId: 'sess-1', ownerToken: 'token-1', project: ' proj-uid-1 ' });

      await controller.icpResult(req, buildRes(), next);

      expect(next).not.toHaveBeenCalled();
      expect(icpMocks.getResult).toHaveBeenCalledWith(req, 'sess-1', 'proj-uid-1');
    });

    it('treats a non-string project as no scope rather than coercing it into a partition', async () => {
      icpMocks.getResult.mockResolvedValue({ status: 'pending' });
      const req = buildIcpReq('/api/mktg-agents/icp/result', { sessionId: 'sess-1', ownerToken: 'token-1', project: { uid: 'proj-uid-1' } });

      await controller.icpResult(req, buildRes(), next);

      expect(icpMocks.getResult).toHaveBeenCalledWith(req, 'sess-1', undefined);
    });

    it('never reaches the service when the owner token does not verify', async () => {
      tokenMocks.verifySessionOwnerToken.mockReturnValueOnce(false);

      await controller.icpResult(buildIcpReq('/api/mktg-agents/icp/result', { sessionId: 'sess-1', ownerToken: 'nope' }), buildRes(), next);

      expect(next.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
      expect(icpMocks.getResult).not.toHaveBeenCalled();
    });

    it('rejects a missing session id with a validation error', async () => {
      await controller.icpResult(buildIcpReq('/api/mktg-agents/icp/result', { ownerToken: 'token-1' }), buildRes(), next);

      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
      expect(icpMocks.getResult).not.toHaveBeenCalled();
    });
  });

  describe('generateFoundationMessage (POST /api/mktg-agents/foundation-message/generate)', () => {
    const messagingAnswers = (): Record<string, string> => ({
      project_name: ' TestOrbit ',
      description: 'An open source release toolkit.',
      website_url: 'https://testorbit.example.org',
      github_url: 'https://github.com/testorbit/testorbit',
      links: 'https://blog.example.org/launch',
    });
    const generateReq = (body: unknown): Request => ({ path: '/api/mktg-agents/foundation-message/generate', body }) as unknown as Request;

    it('refuses an active framework before starting a Guild session', async () => {
      await refusesActive(
        () => controller.generateFoundationMessage(generateReq({ answers: messagingAnswers(), project: 'synthetic-project' }), buildRes(), next),
        foundationMessageMocks.startGeneration
      );
    });

    it('starts a fresh draft with the trimmed answers, the tagged documents and the project uid, routed by the catalog handle', async () => {
      foundationMessageMocks.startGeneration.mockResolvedValue('sess-1');
      tokenMocks.createSessionOwnerToken.mockReturnValue('owner-token');
      const documents = [
        { kind: 'file', title: 'deck.pdf', text: 'Deck.', tag: 'deck' },
        { kind: 'link', title: 'Press', url: 'https://press.example.org/testorbit', tag: 'press' },
      ];
      const res = buildRes();

      const req = generateReq({ answers: messagingAnswers(), documents, project: ' proj-uid-1 ' });
      await controller.generateFoundationMessage(req, res, next);

      expect(next).not.toHaveBeenCalled();
      const [, answers, sentDocuments, project, handle] = foundationMessageMocks.startGeneration.mock.calls[0];
      expect(answers['project_name']).toBe('TestOrbit');
      expect(answers['links']).toBe('https://blog.example.org/launch');
      expect(answers['github_url']).toBe('https://github.com/testorbit/testorbit');
      expect(sentDocuments).toEqual(documents);
      expect(project).toBe('proj-uid-1');
      expect(handle).toBe('foundation-message');
      expect(lastIntakeMocks.recordStartBestEffort).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          project: 'proj-uid-1',
          agentId: 'foundation-setup',
          runId: publicRunId,
          answers: req.body.answers,
          documentCount: 2,
          logoCount: 0,
        })
      );
      expect(res.json).toHaveBeenCalledWith(acknowledgement('sess-1'));
    });

    it('requires a writable project before generation and refuses a malformed one', async () => {
      const failure = ServiceValidationError.forField('project', 'A single-segment project uid is required.');
      runMocks.resolveProject.mockRejectedValueOnce(failure);
      await controller.generateFoundationMessage(generateReq({ answers: messagingAnswers() }), buildRes(), next);
      expect(runMocks.resolveProject).toHaveBeenCalledWith(expect.anything(), '');
      expect(next).toHaveBeenCalledWith(failure);
      expect(foundationMessageMocks.startGeneration).not.toHaveBeenCalled();

      next.mockClear();
      await controller.generateFoundationMessage(generateReq({ answers: messagingAnswers(), project: 'a/b' }), buildRes(), next);
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
      expect(foundationMessageMocks.startGeneration).not.toHaveBeenCalled();
    });

    it('refuses the retired source, notes and question keys — the agent reads the website and links and asks the gaps itself', async () => {
      await controller.generateFoundationMessage(
        generateReq({ answers: { ...messagingAnswers(), other_links: 'https://blog.example.org/a' } }),
        buildRes(),
        next
      );
      await controller.generateFoundationMessage(generateReq({ answers: { ...messagingAnswers(), notes: 'Audience: platform teams.' } }), buildRes(), next);
      await controller.generateFoundationMessage(generateReq({ answers: { ...messagingAnswers(), vision_mission: 'TBD' } }), buildRes(), next);

      expect(next.mock.calls.map(([error]) => error instanceof ServiceValidationError)).toEqual([true, true, true]);
      expect(foundationMessageMocks.startGeneration).not.toHaveBeenCalled();
    });

    it('needs the website — the form’s one required source; a deck or a link without it is refused, as on the form', async () => {
      foundationMessageMocks.startGeneration.mockResolvedValue('sess-1');
      tokenMocks.createSessionOwnerToken.mockReturnValue('owner-token');
      const deck = [{ kind: 'file', title: 'deck.pdf', text: 'Deck.', tag: 'deck' }];

      await controller.generateFoundationMessage(
        generateReq({ answers: { project_name: 'TestOrbit', github_url: 'https://github.com/testorbit/testorbit' } }),
        buildRes(),
        next
      );
      await controller.generateFoundationMessage(
        generateReq({ answers: { project_name: 'TestOrbit', website_url: 'none' }, documents: deck }),
        buildRes(),
        next
      );
      await controller.generateFoundationMessage(
        generateReq({ answers: { project_name: 'TestOrbit', links: 'https://blog.example.org/launch' } }),
        buildRes(),
        next
      );
      expect(next.mock.calls.map(([error]) => error instanceof ServiceValidationError)).toEqual([true, true, true]);
      expect(JSON.stringify((next.mock.calls[0][0] as ServiceValidationError).validationErrors)).toContain('website_url is required');
      expect(foundationMessageMocks.startGeneration).not.toHaveBeenCalled();

      // The website alone starts a draft.
      await controller.generateFoundationMessage(
        generateReq({ answers: { project_name: 'TestOrbit', website_url: 'https://testorbit.example.org' } }),
        buildRes(),
        next
      );
      expect(foundationMessageMocks.startGeneration).toHaveBeenCalledTimes(1);
    });

    it('refuses feedback or a prior version — a generate is always a fresh draft', async () => {
      await controller.generateFoundationMessage(generateReq({ answers: messagingAnswers(), feedback: 'Sharper' }), buildRes(), next);

      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
      expect(foundationMessageMocks.startGeneration).not.toHaveBeenCalled();
    });

    it('refuses a link whose text the browser claims to have read, and an untagged document', async () => {
      await controller.generateFoundationMessage(
        generateReq({ answers: messagingAnswers(), documents: [{ kind: 'link', title: 'Doc', url: 'https://wiki.example.org/doc' }] }),
        buildRes(),
        next
      );
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
      const documents = [{ kind: 'link', title: 'Doc', url: 'https://wiki.example.org/doc', text: 'forged', tag: 'doc' }];

      await controller.generateFoundationMessage(generateReq({ answers: messagingAnswers(), documents }), buildRes(), next);

      expect(next.mock.calls[1][0]).toBeInstanceOf(ServiceValidationError);
      expect(foundationMessageMocks.startGeneration).not.toHaveBeenCalled();
    });
  });

  describe('foundationMessageAnswers (POST /api/mktg-agents/foundation-message/answers)', () => {
    const answersReq = (body: unknown): Request => ({ path: '/api/mktg-agents/foundation-message/answers', body }) as unknown as Request;
    const answers = [
      { key: 'ranked-goals', text: ' Adoption first. ', origin: 'accepted' },
      { key: 'words-to-avoid', text: 'Avoid "synergy".', origin: 'requester' },
    ];

    it('sends the trimmed answers to the session, routed by the catalog handle, for the session’s creator', async () => {
      foundationMessageMocks.sendAnswers.mockResolvedValue(undefined);
      const res = buildRes();

      await controller.foundationMessageAnswers(answersReq({ sessionId: ' sess-1 ', ownerToken: 'token-1', answers }), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(tokenMocks.verifySessionOwnerToken).toHaveBeenCalledWith('token-1', 'auth0|user-1', 'sess-1');
      const [, sessionId, sent, handle] = foundationMessageMocks.sendAnswers.mock.calls[0];
      expect(sessionId).toBe('sess-1');
      expect(sent).toEqual([
        { key: 'ranked-goals', text: 'Adoption first.', origin: 'accepted' },
        { key: 'words-to-avoid', text: 'Avoid "synergy".', origin: 'requester' },
      ]);
      expect(handle).toBe('foundation-message');
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('refuses a skip, a TBD or an empty answer, and a missing session id', async () => {
      await controller.foundationMessageAnswers(
        answersReq({ sessionId: 'sess-1', ownerToken: 'token-1', answers: [{ key: 'ranked-goals', text: 'TBD', origin: 'edited' }] }),
        buildRes(),
        next
      );
      await controller.foundationMessageAnswers(answersReq({ ownerToken: 'token-1', answers }), buildRes(), next);

      expect(next.mock.calls.map(([error]) => error instanceof ServiceValidationError)).toEqual([true, true]);
      expect(foundationMessageMocks.sendAnswers).not.toHaveBeenCalled();
    });

    it('never reaches the session when the owner token does not verify', async () => {
      tokenMocks.verifySessionOwnerToken.mockReturnValueOnce(false);

      await controller.foundationMessageAnswers(answersReq({ sessionId: 'sess-1', ownerToken: 'nope', answers }), buildRes(), next);

      expect(next.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
      expect(foundationMessageMocks.sendAnswers).not.toHaveBeenCalled();
    });
  });

  describe('documents (POST /api/mktg-agents/foundation-message/documents/file)', () => {
    const fileReq = (headers: Record<string, string>, body: unknown): Request =>
      ({ path: '/api/mktg-agents/foundation-message/documents/file', headers, body }) as unknown as Request;

    it('reads an uploaded file and returns its text, word count and decoded name', async () => {
      sourceTextMocks.readFile.mockResolvedValue({ text: 'Vision and mission notes.', truncated: false });
      const res = buildRes();

      await controller.readFoundationMessageFile(fileReq({ 'x-file-name': encodeURIComponent('Brand guide.pdf') }, Buffer.from('%PDF-1.7')), res, next);

      expect(sourceTextMocks.readFile.mock.calls[0][1]).toBe('Brand guide.pdf');
      expect(res.json).toHaveBeenCalledWith({ title: 'Brand guide.pdf', read: true, words: 4, truncated: false, text: 'Vision and mission notes.' });
    });

    it('says why a file could not be read', async () => {
      sourceTextMocks.readFile.mockResolvedValue({ text: null, truncated: false, reason: 'encrypted' });
      const res = buildRes();

      await controller.readFoundationMessageFile(fileReq({ 'x-file-name': 'locked.pdf' }, Buffer.from('%PDF-1.7')), res, next);

      expect(res.json.mock.calls[0][0]).toMatchObject({ read: false, words: 0, reason: expect.stringContaining('password') });
    });

    it('needs the file name header and a non-empty body', async () => {
      await controller.readFoundationMessageFile(fileReq({}, Buffer.from('x')), buildRes(), next);
      await controller.readFoundationMessageFile(fileReq({ 'x-file-name': 'a.txt' }, {}), buildRes(), next);

      expect(next.mock.calls.map(([error]) => error instanceof ServiceValidationError)).toEqual([true, true]);
      expect(sourceTextMocks.readFile).not.toHaveBeenCalled();
    });

    it('refuses a caller with no LFID username, the key the read gate holds slots on, even when a sub is present', async () => {
      authMocks.getEffectiveUsername.mockReturnValueOnce(null);

      await controller.readFoundationMessageFile(fileReq({ 'x-file-name': 'a.txt' }, Buffer.from('x')), buildRes(), next);

      expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
      expect(sourceTextMocks.readFile).not.toHaveBeenCalled();
    });

    it('has no link endpoint any more — a document link goes to the agent as its URL', () => {
      expect((controller as unknown as Record<string, unknown>)['readFoundationMessageLink']).toBeUndefined();
    });
  });

  describe('foundationMessageResult (POST /api/mktg-agents/foundation-message/result)', () => {
    it('passes the run’s project scope to the service so the write is entitlement-checked and partitioned', async () => {
      foundationMessageMocks.getResult.mockResolvedValue({ status: 'pending' });
      const req = buildFoundationMessageResultReq({ sessionId: 'sess-1', ownerToken: 'token-1', project: ' proj-uid-1 ' });

      await controller.foundationMessageResult(req, buildRes(), next);

      expect(next).not.toHaveBeenCalled();
      expect(foundationMessageMocks.getResult).toHaveBeenCalledWith(req, 'sess-1', 'proj-uid-1');
    });

    it('treats a non-string / blank project as no scope rather than coercing it into a partition', async () => {
      foundationMessageMocks.getResult.mockResolvedValue({ status: 'pending' });
      const req = buildFoundationMessageResultReq({ sessionId: 'sess-1', ownerToken: 'token-1', project: { uid: 'proj-uid-1' } });

      await controller.foundationMessageResult(req, buildRes(), next);

      expect(foundationMessageMocks.getResult).toHaveBeenCalledWith(req, 'sess-1', undefined);
    });

    // The three guards below are the write path's authn/authz boundary. They
    // are pinned here, not only on the Brand Kit / ICP siblings, because the
    // owner-token mock defaults to "verifies" — a dropped or inverted guard
    // would otherwise pass the happy-path cases above silently.
    it('rejects a missing session id with a validation error', async () => {
      await controller.foundationMessageResult(buildFoundationMessageResultReq({ ownerToken: 'token-1', project: 'proj-uid-1' }), buildRes(), next);

      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
      expect(foundationMessageMocks.getResult).not.toHaveBeenCalled();
    });

    it('rejects an unidentified caller before the owner token is even checked', async () => {
      authMocks.getEffectiveSub.mockReturnValueOnce(null);

      await controller.foundationMessageResult(
        buildFoundationMessageResultReq({ sessionId: 'sess-1', ownerToken: 'token-1', project: 'proj-uid-1' }),
        buildRes(),
        next
      );

      expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
      expect(tokenMocks.verifySessionOwnerToken).not.toHaveBeenCalled();
      expect(foundationMessageMocks.getResult).not.toHaveBeenCalled();
    });

    it('never reaches the service when the owner token does not verify', async () => {
      tokenMocks.verifySessionOwnerToken.mockReturnValueOnce(false);

      await controller.foundationMessageResult(
        buildFoundationMessageResultReq({ sessionId: 'sess-1', ownerToken: 'nope', project: 'proj-uid-1' }),
        buildRes(),
        next
      );

      expect(next.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
      expect(foundationMessageMocks.getResult).not.toHaveBeenCalled();
    });
  });

  /**
   * The read boundary of the Messaging Framework's server copy — deliberately
   * the same boundary as `storedBrandKit`, because it is the same shared
   * storage layer behind both.
   */
  describe('storedFoundationMessage (GET /api/mktg-agents/foundation-message/stored)', () => {
    it('rejects a missing project query param with a validation error, resolving nothing', async () => {
      const res = buildRes();

      await controller.storedFoundationMessage(buildFoundationMessageReq(), res, next);

      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
      expect(projectMocks.getProjectById).not.toHaveBeenCalled();
      expect(foundationMessageMocks.getStoredFoundationMessage).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it.each(['../projects/other', 'proj/../../admin', 'proj-uid-1?access=all', 'proj-uid-1#frag', 'proj uid'])(
      'refuses %j before the upstream lookup — a uid is one path segment, never a URL fragment',
      async (projectUid) => {
        const res = buildRes();

        await controller.storedFoundationMessage(buildFoundationMessageReq({ project: projectUid }), res, next);

        expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
        expect(projectMocks.getProjectById).not.toHaveBeenCalled();
        expect(foundationMessageMocks.getStoredFoundationMessage).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
      }
    );

    it('serves the stored framework to a writer-entitled caller, partitioned by the SERVER-resolved project uid', async () => {
      projectMocks.getProjectById.mockResolvedValue({ uid: 'proj-uid-1', slug: 'testorbit', writer: true });
      foundationMessageMocks.getStoredFoundationMessage.mockResolvedValue(STORED_FOUNDATION_MESSAGE);
      const req = buildFoundationMessageReq({ project: 'proj-uid-1' });
      const res = buildRes();

      await controller.storedFoundationMessage(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(projectMocks.getProjectById).toHaveBeenCalledWith(req, 'proj-uid-1', true);
      expect(foundationMessageMocks.getStoredFoundationMessage).toHaveBeenCalledWith(req, 'proj-uid-1', false);
      expect(res.json).toHaveBeenCalledWith(STORED_FOUNDATION_MESSAGE);
    });

    it('serves approved current with its sidecar and date on ?sidecar=true and gives approval guidance on 404', async () => {
      projectMocks.getProjectById.mockResolvedValue({ uid: 'proj-uid-1', slug: 'testorbit', writer: true });
      const latest = { ...STORED_FOUNDATION_MESSAGE, storedAt: '2026-10-16T09:00:00.000Z', sidecar: { fields: {} } };
      foundationMessageMocks.getStoredFoundationMessage.mockResolvedValue(latest);
      const req = buildFoundationMessageReq({ project: 'proj-uid-1', sidecar: 'true' });
      const res = buildRes();

      await controller.storedFoundationMessage(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(foundationMessageMocks.getStoredFoundationMessage).toHaveBeenCalledWith(req, 'proj-uid-1', true);
      expect(res.json).toHaveBeenCalledWith(latest);

      foundationMessageMocks.getStoredFoundationMessage.mockResolvedValue(null);
      await controller.storedFoundationMessage(buildFoundationMessageReq({ project: 'proj-uid-1', sidecar: 'true' }), buildRes(), next);

      const error = next.mock.calls[0][0] as MicroserviceError;
      expect(error).toBeInstanceOf(MicroserviceError);
      expect(error.message).toBe('Approve a messaging framework first — the Brand Kit builds on the approved one.');
      expect(error.code).toBe('MKTG_FRAMEWORK_NOT_APPROVED');
    });

    it.each(['none stored', 'stored but unapproved'])('requires approval on the sidecar read when the framework is %s', async () => {
      projectMocks.getProjectById.mockResolvedValue({ uid: 'proj-uid-1', writer: true });
      foundationMessageMocks.getStoredFoundationMessage.mockResolvedValue(null);
      await controller.storedFoundationMessage(buildFoundationMessageReq({ project: 'proj-uid-1', sidecar: 'true' }), buildRes(), next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Approve a messaging framework first — the Brand Kit builds on the approved one.',
          code: 'MKTG_FRAMEWORK_NOT_APPROVED',
        })
      );
    });

    it('denies a caller without the project writer entitlement before any storage read (403)', async () => {
      projectMocks.getProjectById.mockResolvedValue({ uid: 'proj-uid-1', slug: 'testorbit', writer: false });
      const res = buildRes();

      await controller.storedFoundationMessage(buildFoundationMessageReq({ project: 'proj-uid-1' }), res, next);

      expect(next.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
      expect(foundationMessageMocks.getStoredFoundationMessage).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('returns 404 with the resolved uid when the project has no stored Messaging Framework', async () => {
      projectMocks.getProjectById.mockResolvedValue({ uid: 'proj-uid-1', slug: 'testorbit', writer: true });
      foundationMessageMocks.getStoredFoundationMessage.mockResolvedValue(null);
      const res = buildRes();

      await controller.storedFoundationMessage(buildFoundationMessageReq({ project: 'proj-uid-1' }), res, next);

      const error = next.mock.calls[0][0];
      expect(error).toBeInstanceOf(ResourceNotFoundError);
      expect((error as ResourceNotFoundError).statusCode).toBe(404);
      expect((error as ResourceNotFoundError).message).toContain('proj-uid-1');
      expect(res.json).not.toHaveBeenCalled();
    });

    it('forwards a project-resolution failure (unknown uid / upstream error) to the error handler', async () => {
      const failure = new ResourceNotFoundError('Project', 'proj-uid-1');
      projectMocks.getProjectById.mockRejectedValue(failure);

      await controller.storedFoundationMessage(buildFoundationMessageReq({ project: 'proj-uid-1' }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(failure);
      expect(foundationMessageMocks.getStoredFoundationMessage).not.toHaveBeenCalled();
    });
  });

  describe('generateBoilerplates (POST /api/mktg-agents/boilerplates/generate)', () => {
    /** The messaging framework as the run page attaches it: the latest stored revision's sidecar (the envelope, content back under `content`), serialized. */
    const FRAMEWORK = JSON.stringify({
      contract: 'messaging-framework-output/v1',
      content: {
        mf: { positioning: 'The open release toolkit.', tagline: 'Release, open.' },
        icp: [],
        mh: { umbrella: 'Open releases', line: 'Release, open.' },
        nums: [],
      },
    });
    const boilerplatesAnswers = (): Record<string, string> => ({
      project_name: ' TestOrbit ',
      website_url: 'https://testorbit.example.org',
      notes: '  ',
      messaging_framework: FRAMEWORK,
    });
    const path = '/api/mktg-agents/boilerplates/generate';

    it('refuses active boilerplates before starting a Guild session', async () => {
      await refusesActive(
        () => controller.generateBoilerplates(buildIcpReq(path, { answers: boilerplatesAnswers(), project: 'synthetic-project' }), buildRes(), next),
        boilerplatesMocks.startGeneration
      );
    });

    it('routes with the catalog handle, passes the trimmed answers and the project uid, and mints an owner token', async () => {
      boilerplatesMocks.startGeneration.mockResolvedValue('sess-bp');
      tokenMocks.createSessionOwnerToken.mockReturnValue('owner-token');
      const req = buildIcpReq(path, { answers: boilerplatesAnswers(), project: 'proj-uid-1' });
      const res = buildRes();

      await controller.generateBoilerplates(req, res, next);

      expect(next).not.toHaveBeenCalled();
      // Blank optionals are dropped so the renderer takes its "none" branch.
      expect(boilerplatesMocks.startGeneration).toHaveBeenCalledWith(
        req,
        { project_name: 'TestOrbit', website_url: 'https://testorbit.example.org', messaging_framework: FRAMEWORK },
        'proj-uid-1',
        'boilerplates'
      );
      expect(lastIntakeMocks.recordStartBestEffort).toHaveBeenCalledWith(
        req,
        expect.objectContaining({ project: 'proj-uid-1', agentId: 'boilerplates', runId: publicRunId, documentCount: 0, logoCount: 0 })
      );
      expect(res.json).toHaveBeenCalledWith(acknowledgement('sess-bp'));
      expect(runMocks.startForCatalogAgent).toHaveBeenCalledWith(expect.anything(), 'boilerplates', 'proj-uid-1', 'sess-bp', 0, 'initial');
    });

    it('refuses a form without the messaging framework, one whose framework is not one, feedback, documents and a malformed project', async () => {
      const withoutFramework: Record<string, string> = boilerplatesAnswers();
      delete withoutFramework['messaging_framework'];
      await controller.generateBoilerplates(buildIcpReq(path, { answers: withoutFramework }), buildRes(), next);
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
      expect((next.mock.calls[0][0] as ServiceValidationError).validationErrors[0].message).toContain('a messaging framework first');

      for (const body of [
        // A legacy Messaging Document sidecar carries a voice, not the framework the boilerplates are written from.
        { answers: { ...boilerplatesAnswers(), messaging_framework: '{"contract":"messaging-document-output/v1","fields":{}}' } },
        { answers: boilerplatesAnswers(), feedback: 'Shorter' },
        { answers: boilerplatesAnswers(), documents: [{ kind: 'link', title: 'Deck', url: 'https://x.example.org' }] },
        { answers: boilerplatesAnswers(), project: '../other' },
      ]) {
        next.mockClear();
        await controller.generateBoilerplates(buildIcpReq(path, body), buildRes(), next);
        expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
      }
      expect(boilerplatesMocks.startGeneration).not.toHaveBeenCalled();
    });
  });

  describe('boilerplatesAnswers (POST /api/mktg-agents/boilerplates/answers)', () => {
    const path = '/api/mktg-agents/boilerplates/answers';

    it('sends the trimmed answers on the same session, routed by the catalog handle', async () => {
      boilerplatesMocks.sendAnswers.mockResolvedValue(undefined);
      const req = buildIcpReq(path, {
        sessionId: 'sess-bp',
        ownerToken: 'token-1',
        answers: [{ key: 'domain', text: ' testorbit.example.org ', origin: 'edited' }],
      });
      const res = buildRes();

      await controller.boilerplatesAnswers(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(boilerplatesMocks.sendAnswers).toHaveBeenCalledWith(
        req,
        'sess-bp',
        [{ key: 'domain', text: 'testorbit.example.org', origin: 'edited' }],
        'boilerplates'
      );
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('refuses a skipped answer, and never posts when the owner token does not verify', async () => {
      await controller.boilerplatesAnswers(
        buildIcpReq(path, { sessionId: 'sess-bp', ownerToken: 'token-1', answers: [{ key: 'domain', text: 'skip', origin: 'requester' }] }),
        buildRes(),
        next
      );
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);

      next.mockClear();
      tokenMocks.verifySessionOwnerToken.mockReturnValueOnce(false);
      await controller.boilerplatesAnswers(
        buildIcpReq(path, { sessionId: 'sess-bp', ownerToken: 'nope', answers: [{ key: 'domain', text: 'testorbit.example.org', origin: 'requester' }] }),
        buildRes(),
        next
      );
      expect(next.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
      expect(boilerplatesMocks.sendAnswers).not.toHaveBeenCalled();
    });
  });

  describe('boilerplatesResult (POST /api/mktg-agents/boilerplates/result)', () => {
    const path = '/api/mktg-agents/boilerplates/result';

    it('passes the run’s project scope to the service so the write is entitlement-checked and partitioned', async () => {
      boilerplatesMocks.getResult.mockResolvedValue({ status: 'pending' });
      const req = buildIcpReq(path, { sessionId: 'sess-bp', ownerToken: 'token-1', project: ' proj-uid-1 ' });
      const res = buildRes();

      await controller.boilerplatesResult(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(boilerplatesMocks.getResult).toHaveBeenCalledWith(req, 'sess-bp', 'proj-uid-1');
      expect(res.json).toHaveBeenCalledWith({ status: 'pending' });
    });

    it('never reaches the service without a session or when the owner token does not verify', async () => {
      await controller.boilerplatesResult(buildIcpReq(path, { ownerToken: 'token-1' }), buildRes(), next);
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);

      next.mockClear();
      tokenMocks.verifySessionOwnerToken.mockReturnValueOnce(false);
      await controller.boilerplatesResult(buildIcpReq(path, { sessionId: 'sess-bp', ownerToken: 'nope' }), buildRes(), next);
      expect(next.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
      expect(boilerplatesMocks.getResult).not.toHaveBeenCalled();
    });
  });

  describe('the FAQ (POST /api/mktg-agents/faq/generate, /answers, /result)', () => {
    const framework = JSON.stringify({ contract: 'messaging-framework-output/v1', content: { mf: { tagline: 'Release, open.' }, mh: {} } });
    const faqAnswers = (): Record<string, string> => ({
      project_name: ' TestOrbit ',
      website_url: 'https://testorbit.example.org',
      github_url: '',
      notes: 'Members ask about cost.',
      messaging_framework: framework,
    });
    const faqReq = (path: string, body: unknown): Request => ({ path: `/api/mktg-agents/faq/${path}`, body }) as unknown as Request;

    it('refuses an active FAQ before starting a Guild session', async () => {
      await refusesActive(
        () => controller.generateFaq(faqReq('generate', { answers: faqAnswers(), project: 'synthetic-project' }), buildRes(), next),
        faqMocks.startGeneration
      );
    });

    it('starts a fresh draft with the trimmed answers, the attached framework and the tagged documents, routed by the catalog handle', async () => {
      faqMocks.startGeneration.mockResolvedValue('sess-1');
      tokenMocks.createSessionOwnerToken.mockReturnValue('owner-token');
      const documents = [{ kind: 'link', title: 'https://testorbit.example.org/faq', url: 'https://testorbit.example.org/faq', tag: 'doc' }];
      const res = buildRes();

      const req = faqReq('generate', { answers: faqAnswers(), documents, project: 'proj-uid-1' });
      await controller.generateFaq(req, res, next);

      expect(next).not.toHaveBeenCalled();
      const [, answers, sentDocuments, project, handle] = faqMocks.startGeneration.mock.calls[0];
      expect(answers).toEqual({
        project_name: 'TestOrbit',
        website_url: 'https://testorbit.example.org',
        notes: 'Members ask about cost.',
        messaging_framework: framework,
      });
      expect(sentDocuments).toEqual(documents);
      expect(project).toBe('proj-uid-1');
      expect(handle).toBe('faq');
      expect(lastIntakeMocks.recordStartBestEffort).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ project: 'proj-uid-1', agentId: 'faq', runId: publicRunId, answers: req.body.answers, documentCount: 1, logoCount: 0 })
      );
      expect(runMocks.resolveProject).toHaveBeenCalledWith(expect.anything(), 'proj-uid-1');
      expect(runMocks.resolveProject.mock.invocationCallOrder[0]).toBeLessThan(faqMocks.startGeneration.mock.invocationCallOrder[0]);
      expect(runMocks.startForCatalogAgent).toHaveBeenCalledWith(expect.anything(), 'faq', 'proj-uid-1', 'sess-1', 0, 'initial');
      expect(res.json).toHaveBeenCalledWith(acknowledgement('sess-1'));
    });

    it('refuses a run without the messaging framework, a logo-tagged document, and a feedback regeneration', async () => {
      const withoutFramework = faqAnswers();
      delete withoutFramework['messaging_framework'];
      await controller.generateFaq(faqReq('generate', { answers: withoutFramework }), buildRes(), next);
      await controller.generateFaq(
        faqReq('generate', { answers: faqAnswers(), documents: [{ kind: 'file', title: 'logo.zip', text: 'x', tag: 'logo' }] }),
        buildRes(),
        next
      );
      await controller.generateFaq(faqReq('generate', { answers: faqAnswers(), feedback: 'Shorter.', priorVersion: 1 }), buildRes(), next);

      expect(next).toHaveBeenCalledTimes(3);
      for (const [error] of next.mock.calls) {
        expect(error).toBeInstanceOf(ServiceValidationError);
      }
      expect(faqMocks.startGeneration).not.toHaveBeenCalled();
    });

    it('sends the answers on the same session for its creator only', async () => {
      faqMocks.sendAnswers.mockResolvedValue(undefined);
      const body = { sessionId: 'sess-1', ownerToken: 'owner-token', answers: [{ key: 'membership-cost', text: ' Free. ', origin: 'requester' }] };
      const res = buildRes();

      await controller.faqAnswers(faqReq('answers', body), res, next);
      expect(faqMocks.sendAnswers).toHaveBeenCalledWith(expect.anything(), 'sess-1', [{ key: 'membership-cost', text: 'Free.', origin: 'requester' }], 'faq');
      expect(res.json).toHaveBeenCalledWith({ success: true });

      tokenMocks.verifySessionOwnerToken.mockReturnValue(false);
      await controller.faqAnswers(faqReq('answers', body), buildRes(), next);
      expect(next.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
      expect(faqMocks.sendAnswers).toHaveBeenCalledTimes(1);
    });

    it('polls the result for the session’s creator with the run’s project, and refuses anyone else', async () => {
      faqMocks.getResult.mockResolvedValue({ status: 'pending', activity: [] });
      const res = buildRes();

      await controller.faqResult(faqReq('result', { sessionId: 'sess-1', ownerToken: 'owner-token', project: ' proj-uid-1 ' }), res, next);
      expect(faqMocks.getResult).toHaveBeenCalledWith(expect.anything(), 'sess-1', 'proj-uid-1');
      expect(runMocks.recordResultBestEffort).toHaveBeenCalledWith(expect.anything(), 'sess-1', { status: 'pending', activity: [] }, 'proj-uid-1');
      expect(res.json).toHaveBeenCalledWith({ status: 'pending', activity: [] });

      tokenMocks.verifySessionOwnerToken.mockReturnValue(false);
      await controller.faqResult(faqReq('result', { sessionId: 'sess-1', ownerToken: 'forged' }), buildRes(), next);
      expect(next.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
      expect(faqMocks.getResult).toHaveBeenCalledTimes(1);
    });
  });
});
