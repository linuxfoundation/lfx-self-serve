// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideRouter, Route } from '@angular/router';
import { PROFILE_ROUTE_SEGMENTS } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { PROFILE_ROUTES } from './profile.routes';

/**
 * Guards issue #2177's consolidation: the legacy /profile/email(s)/password pages redirect into
 * /profile/settings with a fragment. A functional redirectTo (not a string) is required to attach
 * that #fragment — a string redirectTo has no way to carry one. Query params survive either form,
 * so each assertion below leads with the fragment and checks query-param passthrough alongside it.
 */
describe('PROFILE_ROUTES — legacy page redirects (#2177)', () => {
  function findRoute(path: string): Route {
    const shell = PROFILE_ROUTES[0].children!;
    const route = shell.find((r) => r.path === path);
    if (!route) throw new Error(`route '${path}' not found`);
    return route;
  }

  function redirect(path: string, queryParams: Record<string, string>) {
    const route = findRoute(path);
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    return TestBed.runInInjectionContext(() => (route.redirectTo as (data: { queryParams: Record<string, string> }) => unknown)({ queryParams }));
  }

  it('redirects /profile/password to /profile/settings#password, and still carries query params', () => {
    const tree = redirect('password', { error: 'invalid_state' }) as { queryParams: Record<string, string>; fragment: string | null; toString(): string };
    expect(tree.fragment).toBe('password');
    expect(tree.toString()).toContain('/profile/settings');
    expect(tree.queryParams).toEqual({ error: 'invalid_state' });
  });

  it('redirects /profile/email to /profile/settings#email-settings, and still carries query params', () => {
    const tree = redirect('email', { success: 'email_added' }) as { queryParams: Record<string, string>; fragment: string | null };
    expect(tree.fragment).toBe('email-settings');
    expect(tree.queryParams).toEqual({ success: 'email_added' });
  });

  it('redirects /profile/emails to /profile/settings#email-settings, and still carries query params', () => {
    const tree = redirect('emails', { error: 'no_code' }) as { queryParams: Record<string, string>; fragment: string | null };
    expect(tree.fragment).toBe('email-settings');
    expect(tree.queryParams).toEqual({ error: 'no_code' });
  });
});

/**
 * The openprofile redirect (ID-1147) sends `/profile/<segment>` to `/u/<segment>` unless the segment is in
 * PROFILE_ROUTE_SEGMENTS, so a new profile child route must be added there or it would be redirected away.
 */
describe('PROFILE_ROUTES — openprofile reserved segments', () => {
  it('lists every profile child path in PROFILE_ROUTE_SEGMENTS', () => {
    const childPaths = PROFILE_ROUTES[0].children!.map((r) => r.path).filter((path): path is string => !!path);
    expect(childPaths.filter((path) => !PROFILE_ROUTE_SEGMENTS.has(path))).toEqual([]);
  });
});

describe('PROFILE_ROUTES — developer-settings alias (ID-1147)', () => {
  it('redirects /profile/developer-settings to /profile/settings#developer-settings, and still carries query params', () => {
    const route = PROFILE_ROUTES[0].children!.find((r) => r.path === 'developer-settings')!;
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const tree = TestBed.runInInjectionContext(() =>
      (route.redirectTo as (data: { queryParams: Record<string, string> }) => unknown)({ queryParams: { from: 'openprofile' } })
    ) as { queryParams: Record<string, string>; fragment: string | null; toString(): string };
    expect(tree.fragment).toBe('developer-settings');
    expect(tree.toString()).toContain('/profile/settings');
    expect(tree.queryParams).toEqual({ from: 'openprofile' });
  });
});
