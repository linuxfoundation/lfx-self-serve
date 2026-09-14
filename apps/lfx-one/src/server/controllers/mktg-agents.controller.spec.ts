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
}));
const icpMocks = vi.hoisted(() => ({
  startGeneration: vi.fn(),
  getResult: vi.fn(),
}));
const validatorMocks = vi.hoisted(() => ({
  validateBrandKitIntakeAnswers: vi.fn(),
  validateFoundationMessageIntakeAnswers: vi.fn(),
  validateIcpIntakeAnswers: vi.fn((): { valid: boolean; errors: string[] } => ({ valid: true, errors: [] })),
}));
const tokenMocks = vi.hoisted(() => ({
  createSessionOwnerToken: vi.fn(),
  verifySessionOwnerToken: vi.fn(() => true),
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
  return { ...agents, ...brandKit };
});
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/utils', () => validatorMocks);
vi.mock('../services/guild.service', () => ({
  GuildService: class {},
}));
vi.mock('../services/brand-kit.service', () => ({
  BrandKitService: class {
    public getStoredBrandKit = brandKitMocks.getStoredBrandKit;
    public getResult = brandKitMocks.getResult;
  },
}));
vi.mock('../services/foundation-message.service', () => ({
  FoundationMessageService: class {},
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
vi.mock('../utils/auth-helper', () => ({
  getEffectiveSub: vi.fn(() => 'auth0|user-1'),
}));
vi.mock('../utils/mktg-session-token.util', () => tokenMocks);

import type { NextFunction, Request, Response } from 'express';

import { AuthorizationError, ResourceNotFoundError, ServiceValidationError } from '../errors';
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

function buildRes(): Response & { json: ReturnType<typeof vi.fn> } {
  return { json: vi.fn() } as unknown as Response & { json: ReturnType<typeof vi.fn> };
}

const STORED = {
  documentMarkdown: '# TestOrbit Brand Kit',
  receipt: { s3_key: 'brand-kit/testorbit/abc.md', content_sha256: 'a'.repeat(64), project: 'testorbit', version: 2, intake_mode: 'form' },
  storedAt: '2026-08-15T00:00:00.000Z',
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
      expect(brandKitMocks.getStoredBrandKit).toHaveBeenCalledWith(req, 'proj-uid-1');
      expect(res.json).toHaveBeenCalledWith(STORED);
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
});
