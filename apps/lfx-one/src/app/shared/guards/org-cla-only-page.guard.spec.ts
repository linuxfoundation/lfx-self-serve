// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AccountContextService } from '@shared/services/account-context.service';
import { OrgClaOnlyAccessService } from '@shared/services/org-cla-only-access.service';
import { OrgRoleGrantsService } from '@shared/services/org-role-grants.service';
import { firstValueFrom, isObservable, Observable } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { orgClaOnlyPageGuard } from './org-cla-only-page.guard';

describe('orgClaOnlyPageGuard', () => {
  const CLA_ONLY_UID = '0014100000ClaOnlyA';
  const enabled = signal(true);
  const loaded = signal(true);
  const selectedUid = signal<string | null>(CLA_ONLY_UID);
  const claOnly = new Set([CLA_ONLY_UID]);
  let createUrlTree: ReturnType<typeof vi.fn>;
  let platform: string;

  /** `/org/{segment}/{page}[/{child}]` as the router hands it to a CanActivateChild on `:orgSegment`. */
  const routeFor = (segment: string, page: string, child?: string): ActivatedRouteSnapshot => {
    const orgSegment = { routeConfig: { path: ':orgSegment' }, paramMap: convertToParamMap({ orgSegment: segment }), parent: { routeConfig: { path: 'org' } } };
    const pageRoute = { routeConfig: { path: page }, parent: orgSegment };
    return (child === undefined ? pageRoute : { routeConfig: { path: child }, parent: pageRoute }) as unknown as ActivatedRouteSnapshot;
  };

  const run = async (route: ActivatedRouteSnapshot): Promise<boolean | UrlTree> => {
    const result = TestBed.runInInjectionContext(() => orgClaOnlyPageGuard(route, {} as RouterStateSnapshot));
    return isObservable(result) ? firstValueFrom(result as Observable<boolean | UrlTree>) : (result as boolean | UrlTree);
  };

  beforeEach(() => {
    enabled.set(true);
    loaded.set(true);
    selectedUid.set(CLA_ONLY_UID);
    platform = 'browser';
    createUrlTree = vi.fn((commands: string[]) => ({ redirected: commands.join('/') }));
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useFactory: () => platform },
        { provide: Router, useValue: { createUrlTree } },
        { provide: OrgClaOnlyAccessService, useValue: { enabled, isClaOnly: (uid: string | null) => !!uid && enabled() && claOnly.has(uid) } },
        { provide: AccountContextService, useValue: { selectedAccount: () => ({ accountId: '', accountName: '', membershipTier: '', uid: selectedUid() }) } },
        { provide: OrgRoleGrantsService, useValue: { loaded } },
      ],
    });
  });

  it('redirects any non-CLA page of a CLA-only organization to its EasyCLA page', async () => {
    for (const page of ['overview', 'memberships', 'people', 'profile']) {
      expect(await run(routeFor(CLA_ONLY_UID, page))).toEqual({ redirected: `/org/${CLA_ONLY_UID}/easycla` });
    }
  });

  it('admits the EasyCLA page and its children', async () => {
    expect(await run(routeFor(CLA_ONLY_UID, 'easycla'))).toBe(true);
    expect(await run(routeFor(CLA_ONLY_UID, 'easycla', ''))).toBe(true);
    expect(await run(routeFor(CLA_ONLY_UID, 'easycla', ':claGroupId'))).toBe(true);
  });

  it('leaves every page of an organization the caller holds through a grant alone', async () => {
    selectedUid.set('0014100000OtherOrg');

    expect(await run(routeFor('other-org', 'overview'))).toBe(true);
  });

  it('applies nothing while org-lens-cla-m3-enabled is off', async () => {
    enabled.set(false);

    expect(await run(routeFor(CLA_ONLY_UID, 'overview'))).toBe(true);
  });

  it('leaves the decision to the browser during SSR', async () => {
    platform = 'server';

    expect(await run(routeFor(CLA_ONLY_UID, 'overview'))).toBe(true);
  });

  it('waits for role grants before deciding, so a deep link is not admitted early', async () => {
    loaded.set(false);
    const pending = run(routeFor(CLA_ONLY_UID, 'overview'));
    loaded.set(true);
    TestBed.tick();

    expect(await pending).toEqual({ redirected: `/org/${CLA_ONLY_UID}/easycla` });
  });
});
