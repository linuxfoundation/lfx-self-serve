// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { clearIntercomCookies } from './clear-intercom-cookies.middleware';

function run(baseURL: string, cookie?: string): { clearCookie: ReturnType<typeof vi.fn>; next: ReturnType<typeof vi.fn> } {
  const clearCookie = vi.fn();
  const next = vi.fn();
  const req = { headers: { cookie } } as unknown as Request;
  const res = { clearCookie } as unknown as Response;

  clearIntercomCookies(baseURL)(req, res, next as unknown as NextFunction);

  return { clearCookie, next };
}

describe('clearIntercomCookies', () => {
  it('clears each intercom- cookie host-only and on every parent domain', () => {
    const { clearCookie, next } = run('https://app.lfx.dev', 'intercom-session-abc=s; appSession=x; intercom-id-abc=i');

    expect(clearCookie.mock.calls).toEqual([
      ['intercom-session-abc'],
      ['intercom-session-abc', { domain: 'app.lfx.dev' }],
      ['intercom-session-abc', { domain: 'lfx.dev' }],
      ['intercom-id-abc'],
      ['intercom-id-abc', { domain: 'app.lfx.dev' }],
      ['intercom-id-abc', { domain: 'lfx.dev' }],
    ]);
    expect(next).toHaveBeenCalledOnce();
  });

  it('clears host-only on a single-label host', () => {
    const { clearCookie } = run('http://localhost:4000', 'intercom-session-abc=s');

    expect(clearCookie.mock.calls).toEqual([['intercom-session-abc']]);
  });

  it('continues without clearing when there are no intercom- cookies', () => {
    const { clearCookie, next } = run('https://app.lfx.dev');

    expect(clearCookie).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});
