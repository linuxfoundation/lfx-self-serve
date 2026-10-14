// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, NavigationStart, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { ORG_CLA_ONLY_GRANTS_WAIT_MS } from '@lfx-one/shared/constants';
import { AccountContextService } from '@shared/services/account-context.service';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { OrgClaOnlyAccessService } from '@shared/services/org-cla-only-access.service';
import { OrgRoleGrantsService } from '@shared/services/org-role-grants.service';
import { firstValueFrom, isObservable, Observable, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { orgClaOnlyPageGuard } from './org-cla-only-page.guard';

describe('orgClaOnlyPageGuard', () => {
  const CLA_ONLY_UID = '0014100000ClaOnlyA';
  const enabled = signal(true);
  const loaded = signal(true);
  const selectedUid = signal<string | null>(CLA_ONLY_UID);
  const providerReady = signal(true);
  const claOnly = new Set([CLA_ONLY_UID]);
  let createUrlTree: ReturnType<typeof vi.fn>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let waitForReady: ReturnType<typeof vi.fn>;
  let flagOverride: boolean | undefined;
  let platform: string;
  let routerUrl: string;
  let routerEvents: Subject<unknown>;

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
    providerReady.set(true);
    platform = 'browser';
    routerUrl = '/';
    routerEvents = new Subject();
    claOnly.clear();
    claOnly.add(CLA_ONLY_UID);
    createUrlTree = vi.fn((commands: string[]) => ({ redirected: commands.join('/') }));
    navigateByUrl = vi.fn(async () => true);
    waitForReady = vi.fn(async () => true);
    flagOverride = undefined;
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useFactory: () => platform },
        {
          provide: Router,
          useValue: {
            createUrlTree,
            navigateByUrl,
            get events() {
              return routerEvents;
            },
            get url() {
              return routerUrl;
            },
          },
        },
        { provide: FeatureFlagService, useValue: { providerReady, waitForReady, getFlagOverride: () => flagOverride } },
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

  it('waits for LaunchDarkly on a cold deep link instead of reading the flag default', async () => {
    providerReady.set(false);
    enabled.set(false);
    waitForReady.mockImplementation(async () => {
      enabled.set(true);
      return true;
    });

    expect(await run(routeFor(CLA_ONLY_UID, 'overview'))).toEqual({ redirected: `/org/${CLA_ONLY_UID}/easycla` });
  });

  it('admits the page when LaunchDarkly never becomes ready, since no CLA-only org exists without the flag', async () => {
    providerReady.set(false);
    waitForReady.mockResolvedValue(false);

    expect(await run(routeFor(CLA_ONLY_UID, 'overview'))).toBe(true);
  });

  it('honours a locally pinned flag without waiting for LaunchDarkly', async () => {
    providerReady.set(false);
    waitForReady.mockResolvedValue(false);
    flagOverride = true;

    expect(await run(routeFor(CLA_ONLY_UID, 'overview'))).toEqual({ redirected: `/org/${CLA_ONLY_UID}/easycla` });
    expect(waitForReady).not.toHaveBeenCalled();
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

  /** Runs the guard with role grants unanswered past the wait. */
  const runPastWait = async (route: ActivatedRouteSnapshot): Promise<boolean | UrlTree> => {
    vi.useFakeTimers();
    try {
      loaded.set(false);
      const pending = run(route);
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(ORG_CLA_ONLY_GRANTS_WAIT_MS);
      return await pending;
    } finally {
      vi.useRealTimers();
    }
  };

  it('admits the page when role grants do not answer within the wait, since the server still refuses the data', async () => {
    selectedUid.set('0014100000OtherOrg');

    expect(await runPastWait(routeFor('other-org', 'overview'))).toBe(true);
  });

  it('redirects past the wait when the resolver already recorded the organization as CLA-only', async () => {
    expect(await runPastWait(routeFor(CLA_ONLY_UID, 'overview'))).toEqual({ redirected: `/org/${CLA_ONLY_UID}/easycla` });
  });

  describe('when role grants answer after the wait', () => {
    const LATE_UID = '0014100000LateClaOn';

    beforeEach(() => {
      selectedUid.set(LATE_UID);
    });

    it('redirects a caller still on the admitted page once the late answer confirms CLA-only', async () => {
      routerUrl = `/org/${LATE_UID}/people`;
      expect(await runPastWait(routeFor(LATE_UID, 'people'))).toBe(true);

      claOnly.add(LATE_UID);
      loaded.set(true);
      TestBed.tick();

      expect(navigateByUrl).toHaveBeenCalledWith({ redirected: `/org/${LATE_UID}/easycla` }, { replaceUrl: true });
    });

    it('redirects even before this navigation has updated the router URL', async () => {
      routerUrl = '/org/previous-org/overview';
      expect(await runPastWait(routeFor(LATE_UID, 'people'))).toBe(true);

      claOnly.add(LATE_UID);
      loaded.set(true);
      TestBed.tick();

      expect(navigateByUrl).toHaveBeenCalledWith({ redirected: `/org/${LATE_UID}/easycla` }, { replaceUrl: true });
    });

    it('judges the organization this navigation addressed, not one the caller has since switched to', async () => {
      const OTHER_UID = '0014100000OtherClaO';
      routerUrl = `/org/${LATE_UID}/people`;
      expect(await runPastWait(routeFor(LATE_UID, 'people'))).toBe(true);

      selectedUid.set(OTHER_UID);
      claOnly.add(OTHER_UID);
      loaded.set(true);
      TestBed.tick();

      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('stops waiting once another navigation starts', async () => {
      routerUrl = `/org/${LATE_UID}/people`;
      expect(await runPastWait(routeFor(LATE_UID, 'people'))).toBe(true);

      routerEvents.next(new NavigationStart(2, `/org/${LATE_UID}/projects`));
      claOnly.add(LATE_UID);
      loaded.set(true);
      TestBed.tick();

      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('never redirects after the caller navigated away during the wait', async () => {
      vi.useFakeTimers();
      try {
        loaded.set(false);
        const pending = run(routeFor(LATE_UID, 'people'));
        TestBed.tick();
        routerEvents.next(new NavigationStart(2, `/org/${LATE_UID}/projects`));
        await vi.advanceTimersByTimeAsync(ORG_CLA_ONLY_GRANTS_WAIT_MS);
        expect(await pending).toBe(true);
      } finally {
        vi.useRealTimers();
      }

      claOnly.add(LATE_UID);
      loaded.set(true);
      TestBed.tick();

      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('redirects once LaunchDarkly turns the flag on after its wait ran out', async () => {
      providerReady.set(false);
      enabled.set(false);
      waitForReady.mockResolvedValue(false);
      routerUrl = `/org/${LATE_UID}/people`;
      claOnly.add(LATE_UID);
      expect(await run(routeFor(LATE_UID, 'people'))).toBe(true);

      enabled.set(true);
      providerReady.set(true);
      TestBed.tick();

      expect(navigateByUrl).toHaveBeenCalledWith({ redirected: `/org/${LATE_UID}/easycla` }, { replaceUrl: true });
    });

    it('leaves the page when the late answer is not CLA-only', async () => {
      routerUrl = `/org/${LATE_UID}/people`;
      expect(await runPastWait(routeFor(LATE_UID, 'people'))).toBe(true);

      loaded.set(true);
      TestBed.tick();

      expect(navigateByUrl).not.toHaveBeenCalled();
    });
  });
});
