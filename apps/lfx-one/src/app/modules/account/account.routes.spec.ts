// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, provideRouter, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { ACCOUNT_ROUTE_PROFILE_TARGETS, ACCOUNT_SETTINGS_NAV, ACCOUNT_SETTINGS_SECTIONS } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { ACCOUNT_ROUTES } from './account.routes';

describe('ACCOUNT_ROUTES', () => {
  const children = ACCOUNT_ROUTES[0].children!;
  const navRoutes = ACCOUNT_SETTINGS_NAV.flatMap((group) => group.items.map((item) => item.route));

  it('has a page for every nav item, and a hub fallback for each', () => {
    expect(navRoutes.filter((route) => !children.some((child) => child.path === route))).toEqual([]);
    expect(Object.keys(ACCOUNT_ROUTE_PROFILE_TARGETS).sort()).toEqual([...navRoutes].sort());
  });

  it('gives each settings page its own section of the settings page', () => {
    const sectionOf = (path: string) => children.find((child) => child.path === path)?.data?.['section'];

    expect(sectionOf('email-settings')).toBe(ACCOUNT_SETTINGS_SECTIONS.EMAIL_SETTINGS);
    expect(sectionOf('password')).toBe(ACCOUNT_SETTINGS_SECTIONS.PASSWORD);
    expect(sectionOf('developer-settings')).toBe(ACCOUNT_SETTINGS_SECTIONS.DEVELOPER_SETTINGS);
  });

  it("moves an old settings section fragment from Email settings to the section's own page", () => {
    const [guard] = children.find((child) => child.path === 'email-settings')!.canActivate as CanActivateFn[];
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const run = (fragment: string | null) =>
      TestBed.runInInjectionContext(() =>
        guard({ fragment, queryParams: {}, routeConfig: { path: 'email-settings' } } as unknown as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
      );

    expect(TestBed.inject(Router).serializeUrl(run('password') as UrlTree)).toBe('/account/password');
    expect(run('email-settings')).toBe(true);
    expect(run(null)).toBe(true);
  });
});
