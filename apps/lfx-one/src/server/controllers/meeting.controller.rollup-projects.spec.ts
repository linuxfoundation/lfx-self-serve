// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Covers the GH-5566 saved roll-up project selection endpoints only; the services they call are doubles.
const { preferenceSvc, isImpersonatingMock } = vi.hoisted(() => ({
  preferenceSvc: { getPreference: vi.fn(), upsertPreference: vi.fn() },
  isImpersonatingMock: vi.fn(() => false),
}));

// The utils barrel reaches Angular-only modules; these endpoints use none of its exports.
vi.mock('@lfx-one/shared/utils', () => ({}));
vi.mock('../services/user-preference.service', () => ({
  UserPreferenceService: vi.fn(function () {
    return preferenceSvc;
  }),
}));
vi.mock('../services/meeting.service', () => ({
  MeetingService: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../services/ai.service', () => ({
  AiService: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../services/committee.service', () => ({
  CommitteeService: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../services/nats.service', () => ({
  NatsService: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../services/user.service', () => ({
  UserService: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../utils/auth-helper', () => ({
  getEffectiveEmail: vi.fn(),
  getUsernameFromAuth: vi.fn(),
  isImpersonating: isImpersonatingMock,
}));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: vi.fn() }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), debug: vi.fn(), sanitize: (v: unknown) => v },
}));

const ROOT = 'root-uid';

async function controller(): Promise<InstanceType<typeof import('./meeting.controller').MeetingController>> {
  const { MeetingController } = await import('./meeting.controller');
  return new MeetingController();
}

function response(): Response & { body?: unknown } {
  const res = { setHeader: vi.fn(), json: vi.fn((body: unknown) => Object.assign(res, { body })) } as unknown as Response & { body?: unknown };
  return res;
}

describe('MeetingController roll-up project preference', () => {
  let next: NextFunction;

  beforeEach(() => {
    preferenceSvc.getPreference.mockReset();
    preferenceSvc.upsertPreference.mockReset().mockResolvedValue(undefined);
    isImpersonatingMock.mockReset().mockReturnValue(false);
    next = vi.fn();
  });

  it('returns the saved selection for the root, or null when nothing is saved', async () => {
    preferenceSvc.getPreference.mockResolvedValue(JSON.stringify({ [ROOT]: ['child'], other: [] }));
    const res = response();

    await (await controller()).getRollupProjectsPreference({ query: { root_project_uid: ROOT } } as unknown as Request, res, next);
    expect(res.body).toEqual({ project_uids: ['child'] });

    const unsaved = response();
    await (await controller()).getRollupProjectsPreference({ query: { root_project_uid: 'unsaved' } } as unknown as Request, unsaved, next);
    expect(unsaved.body).toEqual({ project_uids: null });
  });

  it('reports nothing saved while impersonating, without reading the impersonator preference', async () => {
    isImpersonatingMock.mockReturnValue(true);
    const res = response();

    await (await controller()).getRollupProjectsPreference({ query: { root_project_uid: ROOT } } as unknown as Request, res, next);

    expect(res.body).toEqual({ project_uids: null });
    expect(preferenceSvc.getPreference).not.toHaveBeenCalled();
  });

  it('saves the selection for the root as the most recent entry, keeping the others', async () => {
    preferenceSvc.getPreference.mockResolvedValue(JSON.stringify({ [ROOT]: ['old'], other: ['x'] }));
    const res = response();

    await (
      await controller()
    ).saveRollupProjectsPreference({ body: { root_project_uid: ROOT, project_uids: ['a', 'a', 'b'] } } as unknown as Request, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(preferenceSvc.upsertPreference).toHaveBeenCalledWith(
      expect.anything(),
      'LFXOne',
      'MeetingsRollupProjects',
      JSON.stringify({ other: ['x'], [ROOT]: ['a', 'b'] })
    );
    expect(res.body).toEqual({ project_uids: ['a', 'b'] });
  });

  it.each([
    ['a missing root', { project_uids: [] }],
    ['an unsafe project UID', { root_project_uid: ROOT, project_uids: ['a:b'] }],
    ['a non-list', { root_project_uid: ROOT, project_uids: 'a' }],
  ])('rejects %s before touching the preference', async (_label, body) => {
    await (await controller()).saveRollupProjectsPreference({ body } as unknown as Request, response(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ServiceValidationError' }));
    expect(preferenceSvc.getPreference).not.toHaveBeenCalled();
  });
});
