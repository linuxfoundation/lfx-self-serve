// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getOrgItems } = vi.hoisted(() => ({ getOrgItems: vi.fn() }));

// The shared utils barrel reaches Angular forms, which cannot load in this Node environment.
vi.mock('@lfx-one/shared/utils', () => ({ isFilterSafeIdentifier: (value: string) => /^[A-Za-z0-9_-]+$/.test(value) }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('../services/navigation.service', () => ({ NavigationService: class {} }));
vi.mock('../services/user-preference.service', () => ({ UserPreferenceService: class {} }));
vi.mock('../services/org-navigation.service', () => ({
  OrgNavigationService: class {
    public getOrgItems = getOrgItems;
  },
}));

import { ServiceValidationError } from '../errors/service-validation.error';

import { NavigationController } from './navigation.controller';

function buildReq(query: Record<string, string>): Request {
  return { query, path: '/api/nav/org-items' } as unknown as Request;
}

function buildRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), setHeader: vi.fn() } as any;
}

describe('NavigationController.getOrgItems — cla_only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrgItems.mockResolvedValue({ items: [], next_page_token: null, upstream_failed: false, total: 0 });
  });

  it('passes cla_only=1 through to the service', async () => {
    const next = vi.fn();
    const res = buildRes();

    await new NavigationController().getOrgItems(buildReq({ cla_only: '1' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(getOrgItems).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ claOnly: true }));
    expect(res.json).toHaveBeenCalled();
  });

  it('asks for the main list when cla_only is absent', async () => {
    await new NavigationController().getOrgItems(buildReq({}), buildRes(), vi.fn());

    expect(getOrgItems).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ claOnly: false }));
  });

  it('rejects cla_only with a page_token, without asking the service', async () => {
    const next = vi.fn();

    await new NavigationController().getOrgItems(buildReq({ cla_only: '1', page_token: 'cursor-2' }), buildRes(), next);

    expect(getOrgItems).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });
});
