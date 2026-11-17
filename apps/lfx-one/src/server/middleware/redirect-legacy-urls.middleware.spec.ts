// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { redirectLegacyUrls } from './redirect-legacy-urls.middleware';

function run(originalUrl: string, method = 'GET'): { redirect: ReturnType<typeof vi.fn>; setHeader: ReturnType<typeof vi.fn>; next: ReturnType<typeof vi.fn> } {
  const redirect = vi.fn();
  const setHeader = vi.fn();
  const next = vi.fn();
  redirectLegacyUrls({ originalUrl, method } as unknown as Request, { redirect, setHeader } as unknown as Response, next as unknown as NextFunction);
  return { redirect, setHeader, next };
}

describe('redirectLegacyUrls', () => {
  it.each([
    ['/org', '/company'],
    ['/org/not-found', '/company/not-found'],
    ['/org/acme-inc/projects?employees=1', '/company/acme-inc/projects?employees=1'],
    ['/org/0014100000MgaAAAAA/easycla/g1?org=0014100000MgaAAAAA&signed=1', '/company/0014100000MgaAAAAA/easycla/g1?company=0014100000MgaAAAAA&signed=1'],
    ['/org/overview', '/company/overview'],
    ['/docs/organization/choose-an-organization', '/docs/company/choose-a-company'],
    ['/docs/organization/projects', '/docs/company/projects'],
    ['/docs/dashboards/organization-involvement', '/docs/dashboards/company-involvement'],
  ])('answers %s with a 301 to %s', (from, to) => {
    const { redirect, next } = run(from);
    expect(redirect).toHaveBeenCalledWith(301, to);
    expect(next).not.toHaveBeenCalled();
  });

  it('marks the redirect uncacheable so a rollback is never pinned to /company', () => {
    expect(run('/org/overview').setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('redirects HEAD too', () => {
    expect(run('/org/overview', 'HEAD').redirect).toHaveBeenCalledWith(301, '/company/overview');
  });

  it.each([
    ['/org/overview', 'POST'],
    ['/company/overview', 'GET'],
    ['/api/orgs/x/lens/groups', 'GET'],
    ['/organization', 'GET'],
    ['/docs/company/faq', 'GET'],
  ])('passes %s (%s) through', (url, method) => {
    const { redirect, next } = run(url, method);
    expect(redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});
