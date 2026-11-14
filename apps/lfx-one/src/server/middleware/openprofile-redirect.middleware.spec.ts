// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { openprofileRedirect, resolveOpenprofileRedirect } from './openprofile-redirect.middleware';

const resolve = (path: string, query: Request['query'] = {}): string | null => resolveOpenprofileRedirect(path, query);

describe('resolveOpenprofileRedirect', () => {
  it.each([
    ['/edit', '/profile/attributions?from=openprofile'],
    ['/edit/profile', '/profile/attributions?from=openprofile'],
    ['/edit/visibility', '/profile/attributions?from=openprofile'],
    ['/edit/visbility', '/profile/attributions?from=openprofile'],
    ['/edit/password', '/profile/password?from=openprofile'],
    ['/edit/email-management', '/profile/email?from=openprofile'],
    ['/edit/registered-emails', '/profile/email?from=openprofile'],
    ['/edit/linux-email', '/profile/identities?from=openprofile'],
    ['/edit/connected-accounts', '/profile/identities?from=openprofile'],
    ['/myevents', '/events?from=openprofile'],
    ['/myevents/kubecon-na-2026', '/events?from=openprofile'],
    ['/event', '/events?from=openprofile'],
    ['/myevents/travel-funding', '/events?tab=travel-funding&from=openprofile'],
    ['/travel-fund/application', '/events?tab=travel-funding&from=openprofile'],
    ['/my-meetings', '/meetings?from=openprofile'],
    ['/community-calendar', '/meetings?from=openprofile'],
    ['/my-calendar', '/meetings?from=openprofile'],
    ['/myrewards', '/me/training?tab=rewards&from=openprofile'],
    ['/myrewards/coupons', '/me/training?tab=rewards&from=openprofile'],
    ['/myrewards/transactions', '/profile/transactions?from=openprofile'],
    ['/myenrollments', '/profile/individual-enrollment?from=openprofile'],
    ['/developer-settings', '/profile/developer-settings?from=openprofile'],
    ['/code', '/profile/attributions?from=openprofile'],
    ['/code/affiliations', '/profile/attributions?from=openprofile'],
    ['/data-visibility', '/profile/attributions?from=openprofile'],
    ['/employer-attribution', '/profile/attributions?from=openprofile'],
    ['/newsletter', '/newsletters/my?from=openprofile'],
    ['/newsletter/abc123', '/newsletters/my?from=openprofile'],
    ['/skills', '/?from=openprofile'],
    ['/admin-view', '/?from=openprofile'],
    ['/playground', '/?from=openprofile'],
    ['/user-profile', '/?from=openprofile'],
  ])('redirects %s to %s', (path, target) => {
    expect(resolve(path)).toBe(target);
  });

  it('matches case-insensitively and ignores a trailing slash', () => {
    expect(resolve('/My-Meetings/')).toBe('/meetings?from=openprofile');
  });

  it.each([
    ['visa-letter', 'visa-letters'],
    ['travel-funding', 'travel-funding'],
  ])('turns /myevents?applyfor=%s&event=<id> into the %s request deep link', (applyfor, tab) => {
    expect(resolve('/myevents', { applyfor, event: 'lfEvt123' })).toBe(`/events?tab=${tab}&event=lfEvt123&from=openprofile`);
  });

  it('drops the event when applyfor is missing or unknown', () => {
    expect(resolve('/myevents', { event: 'lfEvt123' })).toBe('/events?from=openprofile');
    expect(resolve('/myevents', { applyfor: 'speaking', event: 'lfEvt123' })).toBe('/events?from=openprofile');
  });

  it.each(['constructor', '__proto__', 'toString'])('ignores the built-in object key applyfor=%s', (applyfor) => {
    expect(resolve('/myevents', { applyfor, event: 'lfEvt123' })).toBe('/events?from=openprofile');
  });

  it('keeps targets on this site for traversal and encoded-slash attempts', () => {
    expect(resolve('/profile/%2F%2Fevil.example')).toBeNull();
    expect(resolve('/profile/..')).toBe('/?from=openprofile');
    expect(resolve('/my-meetings', { utm_x: 'a\r\nSet-Cookie: x=1' })).toBe('/meetings?utm_x=a%0D%0ASet-Cookie%3A+x%3D1&from=openprofile');
  });

  it('skips over-long paths and trims long slash runs without backtracking', () => {
    expect(resolve(`/${'a'.repeat(600)}`)).toBeNull();
    expect(resolve(`/my-meetings${'/'.repeat(400)}`)).toBe('/meetings?from=openprofile');
    expect(resolve(`${'/'.repeat(500)}x`)).toBeNull();
  });

  it('drops an event id with unsafe characters but keeps the tab', () => {
    expect(resolve('/myevents', { applyfor: 'visa-letter', event: '<x>' })).toBe('/events?tab=visa-letters&from=openprofile');
  });

  it('carries the travel funding path id as the event', () => {
    expect(resolve('/myevents/travel-funding/lfEvt123')).toBe('/events?tab=travel-funding&event=lfEvt123&from=openprofile');
  });

  it('passes utm_* params through and drops other old-app params', () => {
    expect(resolve('/my-meetings', { utm_source: 'newsletter', code: 'abc', state: 'xyz', returnTo: '/x', useAsUsername: 'someone' })).toBe(
      '/meetings?utm_source=newsletter&from=openprofile'
    );
  });

  it('redirects an old public profile to /u/<username>', () => {
    expect(resolve('/profile/jdoe')).toBe('/u/jdoe?from=openprofile');
  });

  it.each(['/profile/settings', '/profile/identities', '/profile/Settings', '/profile/visibility', '/profile/password', '/profile/developer-settings'])(
    'leaves Self Serve profile path %s alone',
    (path) => {
      expect(resolve(path)).toBeNull();
    }
  );

  it.each(['/profile/a%2Fb', '/profile/jdoe/extra', '/profile/j%20doe'])('does not redirect profile path %s', (path) => {
    expect(resolve(path)).toBeNull();
  });

  it.each(['/', '/profile', '/settings', '/events', '/meetings', '/me/training', '/u/jdoe', '/nope'])('leaves %s alone', (path) => {
    expect(resolve(path)).toBeNull();
  });
});

describe('openprofileRedirect', () => {
  function run(method: string, path: string): { redirect: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; next: ReturnType<typeof vi.fn> } {
    const redirect = vi.fn();
    const set = vi.fn();
    const next = vi.fn();
    const req = { method, path, query: {} } as unknown as Request;
    const res = { redirect, set } as unknown as Response;
    openprofileRedirect(req, res, next as unknown as NextFunction);
    return { redirect, set, next };
  }

  it('answers an old path with an uncached 302', () => {
    const { redirect, set, next } = run('GET', '/my-meetings');
    expect(set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(redirect).toHaveBeenCalledWith(302, '/meetings?from=openprofile');
    expect(next).not.toHaveBeenCalled();
  });

  it('redirects HEAD requests too', () => {
    expect(run('HEAD', '/my-meetings').redirect).toHaveBeenCalledOnce();
  });

  it('passes other methods and non-old paths through', () => {
    expect(run('POST', '/my-meetings').next).toHaveBeenCalledOnce();
    expect(run('GET', '/meetings').next).toHaveBeenCalledOnce();
  });
});
