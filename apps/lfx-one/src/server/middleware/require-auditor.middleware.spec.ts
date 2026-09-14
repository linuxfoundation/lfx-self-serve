// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const checkRootAuditor = vi.fn();
const checkRootWriter = vi.fn();

vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: {
    checkRootAuditor: () => checkRootAuditor(),
    checkRootWriter: () => checkRootWriter(),
  },
}));

const { requireAuditor } = await import('./require-auditor.middleware');

function buildReq(): Request {
  return { path: '/api/formations' } as unknown as Request;
}

/** The middleware either calls next() with nothing (allow) or next(error) (deny). */
function verdict(next: ReturnType<typeof vi.fn>): 'allow' | 'deny' {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0][0] === undefined ? 'allow' : 'deny';
}

describe('requireAuditor', () => {
  beforeEach(() => {
    checkRootAuditor.mockReset();
    checkRootWriter.mockReset();
  });

  it('allows a caller with a root auditor grant', async () => {
    checkRootAuditor.mockResolvedValue(true);
    checkRootWriter.mockResolvedValue(false);
    const next = vi.fn();

    await requireAuditor(buildReq(), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('allow');
  });

  it('allows a root writer even without an explicit auditor grant', async () => {
    checkRootAuditor.mockResolvedValue(false);
    checkRootWriter.mockResolvedValue(true);
    const next = vi.fn();

    await requireAuditor(buildReq(), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('allow');
  });

  it('denies a caller with neither grant', async () => {
    checkRootAuditor.mockResolvedValue(false);
    checkRootWriter.mockResolvedValue(false);
    const next = vi.fn();

    await requireAuditor(buildReq(), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('deny');
  });

  it('denies (fails closed) when the access-check calls throw', async () => {
    checkRootAuditor.mockRejectedValue(new Error('access-check unavailable'));
    checkRootWriter.mockResolvedValue(false);
    const next = vi.fn();

    await requireAuditor(buildReq(), {} as Response, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
