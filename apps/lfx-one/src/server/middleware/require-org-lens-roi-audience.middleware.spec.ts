// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The middleware's import graph reaches Angular's partially-compiled @angular/common through the shared logging
// chain, so the JIT compiler must be loaded before the module under test (as the executive-director spec does).
import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { requireOrgLensRoiAudience } from './require-org-lens-roi-audience.middleware';

const checkLFStaff = vi.fn();
let impersonating = false;

vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: { checkLFStaff: (...args: unknown[]) => checkLFStaff(...args) },
}));
vi.mock('../utils/auth-helper', () => ({ isImpersonating: () => impersonating }));
vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn() } }));

const buildReq = (): Request => ({ path: '/api/orgs/0014100000MgaAAAAA/lens/roi/summary' }) as unknown as Request;

/** The middleware either calls next() with nothing (allow) or next(error) (deny). */
function verdictOf(next: Mock): 'allow' | 'deny' {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0][0] === undefined ? 'allow' : 'deny';
}

describe('requireOrgLensRoiAudience', () => {
  beforeEach(() => {
    checkLFStaff.mockReset();
    impersonating = false;
  });

  it('admits LF staff', async () => {
    checkLFStaff.mockResolvedValue(true);
    const next = vi.fn();

    await requireOrgLensRoiAudience(buildReq(), {} as Response, next as unknown as NextFunction);

    expect(verdictOf(next)).toBe('allow');
  });

  it('refuses a non-staff caller with a 403 FORBIDDEN', async () => {
    checkLFStaff.mockResolvedValue(false);
    const next = vi.fn();

    await requireOrgLensRoiAudience(buildReq(), {} as Response, next as unknown as NextFunction);

    expect(verdictOf(next)).toBe('deny');
    const error = next.mock.calls[0][0] as { statusCode: number; code: string };
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
  });

  it('refuses a session acting as another user, even when that user is LF staff', async () => {
    checkLFStaff.mockResolvedValue(true);
    impersonating = true;
    const next = vi.fn();

    await requireOrgLensRoiAudience(buildReq(), {} as Response, next as unknown as NextFunction);

    expect(verdictOf(next)).toBe('deny');
    expect(checkLFStaff).not.toHaveBeenCalled();
  });

  it('fails closed, passing the error on, when the staff check throws', async () => {
    const failure = new Error('access check unavailable');
    checkLFStaff.mockRejectedValue(failure);
    const next = vi.fn();

    await requireOrgLensRoiAudience(buildReq(), {} as Response, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledWith(failure);
  });
});
