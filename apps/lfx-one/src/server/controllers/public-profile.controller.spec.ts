// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PublicProfile } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Per-test-controllable service mock. The controller constructs `new PublicProfileService()`
// as a field, so the mocked constructor must hand back this same object every time.
const { getPublicProfileMock } = vi.hoisted(() => ({ getPublicProfileMock: vi.fn() }));

vi.mock('../services/public-profile.service', () => ({
  PublicProfileService: vi.fn(function () {
    return { getPublicProfile: getPublicProfileMock };
  }),
}));

vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ResourceNotFoundError } from '../errors';
import { PublicProfileController } from './public-profile.controller';

const USERNAME = 'jane';

function buildReqRes() {
  const req = { params: { username: USERNAME }, path: `/public/api/profile/${USERNAME}`, log: {} } as any;
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;
  const next = vi.fn();
  return { req, res, next };
}

describe('PublicProfileController.getPublicProfile', () => {
  let controller: PublicProfileController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicProfileController();
  });

  it('responds with exactly { isPublic: false } for a private profile and leaks no withheld data', async () => {
    // The service resolved a real artifact but flagged it private — the controller is the
    // exposure boundary and must never forward the underlying PII to an anonymous caller.
    getPublicProfileMock.mockResolvedValue({
      isPublic: false,
      basic: { Name: 'Jane Private', About: 'secret bio' },
      technical_contribution: { projects: [] },
    } as PublicProfile);
    const { req, res, next } = buildReqRes();

    await controller.getPublicProfile(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ isPublic: false });
    // Defense in depth: no field of the withheld payload appears anywhere in the response.
    const serialized = JSON.stringify(res.json.mock.calls[0][0]);
    expect(serialized).not.toContain('Jane Private');
    expect(serialized).not.toContain('secret bio');
  });

  it('responds with the full profile for a public profile', async () => {
    const profile = { isPublic: true, basic: { Name: 'Jane Public' } } as PublicProfile;
    getPublicProfileMock.mockResolvedValue(profile);
    const { req, res, next } = buildReqRes();

    await controller.getPublicProfile(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(profile);
  });

  it('forwards a 404 ResourceNotFoundError when the profile is missing (service returns null)', async () => {
    getPublicProfileMock.mockResolvedValue(null);
    const { req, res, next } = buildReqRes();

    await controller.getPublicProfile(req, res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(ResourceNotFoundError);
    expect(err.statusCode).toBe(404);
  });

  it('forwards service errors to next (e.g. upstream/config failures)', async () => {
    const failure = new Error('bucket not configured');
    getPublicProfileMock.mockRejectedValue(failure);
    const { req, res, next } = buildReqRes();

    await controller.getPublicProfile(req, res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(failure);
  });
});
