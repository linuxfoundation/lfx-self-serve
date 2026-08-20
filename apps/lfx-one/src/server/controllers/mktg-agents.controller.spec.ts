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
  const constants = await vi.importActual('../../../../../packages/shared/src/constants/mktg-os-agents.constants');
  return constants;
});
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/utils', () => ({
  validateBrandKitIntakeAnswers: vi.fn(),
  validateFoundationMessageIntakeAnswers: vi.fn(),
}));
vi.mock('../services/guild.service', () => ({
  GuildService: class {},
}));
vi.mock('../services/brand-kit.service', () => ({
  BrandKitService: class {
    public getStoredBrandKit = brandKitMocks.getStoredBrandKit;
  },
}));
vi.mock('../services/foundation-message.service', () => ({
  FoundationMessageService: class {},
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
vi.mock('../utils/mktg-session-token.util', () => ({
  createSessionOwnerToken: vi.fn(),
  verifySessionOwnerToken: vi.fn(),
}));

import type { NextFunction, Request, Response } from 'express';

import { AuthorizationError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { MktgAgentsController } from './mktg-agents.controller';

function buildReq(query: Record<string, unknown> = {}): Request {
  return { path: '/api/mktg-agents/brand-kit/stored', query } as unknown as Request;
}

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

    it('serves the stored document to a writer-entitled caller, partitioned by the SERVER-resolved slug', async () => {
      projectMocks.getProjectById.mockResolvedValue({ uid: 'proj-uid-1', slug: 'testorbit', writer: true });
      brandKitMocks.getStoredBrandKit.mockResolvedValue(STORED);
      const req = buildReq({ project: 'proj-uid-1' });
      const res = buildRes();

      await controller.storedBrandKit(req, res, next);

      expect(next).not.toHaveBeenCalled();
      // The entitlement lookup runs with the access annotation requested.
      expect(projectMocks.getProjectById).toHaveBeenCalledWith(req, 'proj-uid-1', true);
      // The partition comes from the resolved project's slug — never the raw
      // client input — so a caller can never address another partition.
      expect(brandKitMocks.getStoredBrandKit).toHaveBeenCalledWith(req, 'testorbit');
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

    it('forwards a project-resolution failure (unknown uid / upstream error) to the error handler', async () => {
      const failure = new ResourceNotFoundError('Project', 'proj-uid-1');
      projectMocks.getProjectById.mockRejectedValue(failure);
      const res = buildRes();

      await controller.storedBrandKit(buildReq({ project: 'proj-uid-1' }), res, next);

      expect(next).toHaveBeenCalledWith(failure);
      expect(brandKitMocks.getStoredBrandKit).not.toHaveBeenCalled();
    });
  });
});
