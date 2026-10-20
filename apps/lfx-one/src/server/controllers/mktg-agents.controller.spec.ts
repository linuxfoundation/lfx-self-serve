// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors brand-kit.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired
// into this app's vitest config with Angular-free resolution, so shared runtime
// collaborators are mocked — the catalog constants are re-exported from their
// real (Angular-free) source module so the routing lookups stay real.
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
  validateIcpIntakeAnswers: vi.fn((): { valid: boolean; errors: string[] } => ({ valid: true, errors: [] })),
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
  const agents = await vi.importActual('../../../../../packages/shared/src/constants/mktg-os-agents.constants');
  const brandKit = await vi.importActual('../../../../../packages/shared/src/constants/brand-kit.constants');
  const artifact = await vi.importActual('../../../../../packages/shared/src/constants/mktg-artifact.constants');
  const foundationMessage = await vi.importActual('../../../../../packages/shared/src/constants/foundation-message.constants');
  const boilerplates = await vi.importActual('../../../../../packages/shared/src/constants/boilerplates.constants');
  const faq = await vi.importActual('../../../../../packages/shared/src/constants/faq.constants');
  return { ...agents, ...brandKit, ...artifact, ...foundationMessage, ...boilerplates, ...faq };
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
  GuildService: class {},
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

import { AuthenticationError, AuthorizationError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { MktgAgentsController } from './mktg-agents.controller';

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
  let controller: MktgAgentsController;
  let next: NextFunction & ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    validatorMocks.validateIcpIntakeAnswers.mockReturnValue({ valid: true, errors: [] });
    tokenMocks.verifySessionOwnerToken.mockReturnValue(true);
    controller = new MktgAgentsController();
    next = vi.fn() as NextFunction & ReturnType<typeof vi.fn>;
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
      expect(res.json).toHaveBeenCalledWith({ sessionId: 'sess-bk', ownerToken: 'owner-token' });
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

  describe('brandKitResult (POST /api/mktg-agents/brand-kit/result)', () => {
    it('passes the run’s project scope to the service so the write is entitlement-checked and partitioned', async () => {
      brandKitMocks.getResult.mockResolvedValue({ status: 'pending' });
      const req = buildResultReq({ sessionId: 'sess-1', ownerToken: 'token-1', project: ' proj-uid-1 ' });
      const res = buildRes();

      await controller.brandKitResult(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(brandKitMocks.getResult).toHaveBeenCalledWith(req, 'sess-1', 'proj-uid-1');
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
      expect(res.json).toHaveBeenCalledWith({ sessionId: 'sess-icp', ownerToken: 'owner-token', readme: { fetched: true, source: 'repository' } });
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

    it('starts a fresh draft with the trimmed answers, the tagged documents and the project uid, routed by the catalog handle', async () => {
      foundationMessageMocks.startGeneration.mockResolvedValue('sess-1');
      tokenMocks.createSessionOwnerToken.mockReturnValue('owner-token');
      const documents = [
        { kind: 'file', title: 'deck.pdf', text: 'Deck.', tag: 'deck' },
        { kind: 'link', title: 'Press', url: 'https://press.example.org/testorbit', tag: 'press' },
      ];
      const res = buildRes();

      await controller.generateFoundationMessage(generateReq({ answers: messagingAnswers(), documents, project: ' proj-uid-1 ' }), res, next);

      expect(next).not.toHaveBeenCalled();
      const [, answers, sentDocuments, project, handle] = foundationMessageMocks.startGeneration.mock.calls[0];
      expect(answers['project_name']).toBe('TestOrbit');
      expect(answers['links']).toBe('https://blog.example.org/launch');
      expect(answers['github_url']).toBe('https://github.com/testorbit/testorbit');
      expect(sentDocuments).toEqual(documents);
      expect(project).toBe('proj-uid-1');
      expect(handle).toBe('foundation-message');
      expect(res.json).toHaveBeenCalledWith({ sessionId: 'sess-1', ownerToken: 'owner-token' });
    });

    it('starts without a project when none is given, and refuses a malformed one', async () => {
      foundationMessageMocks.startGeneration.mockResolvedValue('sess-1');
      tokenMocks.createSessionOwnerToken.mockReturnValue('owner-token');

      await controller.generateFoundationMessage(generateReq({ answers: messagingAnswers() }), buildRes(), next);
      expect(foundationMessageMocks.startGeneration.mock.calls[0][3]).toBeUndefined();

      await controller.generateFoundationMessage(generateReq({ answers: messagingAnswers(), project: 'a/b' }), buildRes(), next);
      expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
      expect(foundationMessageMocks.startGeneration).toHaveBeenCalledTimes(1);
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
      expect(res.json).toHaveBeenCalledWith({ sessionId: 'sess-bp', ownerToken: 'owner-token' });
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

    it('starts a fresh draft with the trimmed answers, the attached framework and the tagged documents, routed by the catalog handle', async () => {
      faqMocks.startGeneration.mockResolvedValue('sess-1');
      tokenMocks.createSessionOwnerToken.mockReturnValue('owner-token');
      const documents = [{ kind: 'link', title: 'https://testorbit.example.org/faq', url: 'https://testorbit.example.org/faq', tag: 'doc' }];
      const res = buildRes();

      await controller.generateFaq(faqReq('generate', { answers: faqAnswers(), documents, project: 'proj-uid-1' }), res, next);

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
      expect(res.json).toHaveBeenCalledWith({ sessionId: 'sess-1', ownerToken: 'owner-token' });
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
      expect(res.json).toHaveBeenCalledWith({ status: 'pending', activity: [] });

      tokenMocks.verifySessionOwnerToken.mockReturnValue(false);
      await controller.faqResult(faqReq('result', { sessionId: 'sess-1', ownerToken: 'forged' }), buildRes(), next);
      expect(next.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
      expect(faqMocks.getResult).toHaveBeenCalledTimes(1);
    });
  });
});
