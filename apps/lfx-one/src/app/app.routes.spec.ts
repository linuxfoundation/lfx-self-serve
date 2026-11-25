// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, PLATFORM_ID, REQUEST_CONTEXT, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  ActivatedRouteSnapshot,
  CanActivateFn,
  provideRouter,
  RedirectFunction,
  Router,
  RouterStateSnapshot,
  UrlSegment,
  UrlTree,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { HEALTH_METRICS_TABS, ORG_LENS_URL_ROOT, ORG_SEGMENT_PARAM } from '@lfx-one/shared/constants';
import { Lens } from '@lfx-one/shared/interfaces';
import { describe, expect, it, vi } from 'vitest';

import { routes } from './app.routes';
import { OrgRollUpUnavailableComponent } from './modules/dashboards/org/org-rollup-unavailable/org-rollup-unavailable.component';
import { HealthMetricsTrainingComponent } from './modules/dashboards/health-metrics-training/health-metrics-training.component';
import { MyNewsletterFoundationsComponent } from './modules/newsletters/my-newsletter-foundations/my-newsletter-foundations.component';
import { MyNewslettersComponent } from './modules/newsletters/my-newsletters/my-newsletters.component';
import { NewsletterSharePreviewComponent } from './modules/newsletters/newsletter-share-preview/newsletter-share-preview.component';
import { NEWSLETTER_ROUTES } from './modules/newsletters/newsletters.routes';
import { VoteDetailComponent } from './modules/votes/vote-detail/vote-detail.component';
import { authGuard } from './shared/guards/auth.guard';
import { lensRedirectGuard } from './shared/guards/lens-redirect.guard';
import { meetupsLensGuard } from './shared/guards/meetups-lens.guard';
import { newsletterAccessGuard } from './shared/guards/newsletter-access.guard';
import { orgLensLfStaffOnlyGuard } from './shared/guards/org-lens-lf-staff-only.guard';
import { orgRollUpSingleOrgPageGuard } from './shared/guards/org-rollup-single-org-page.guard';
import { orgRollUpUnavailablePageGuard } from './shared/guards/org-rollup-unavailable-page.guard';
import { newsletterAnonymousSsrMatchGuard } from './shared/guards/newsletter-anonymous-ssr-match.guard';
import { projectQueryParamGuard } from './shared/guards/project-query-param.guard';
import { votePermalinkMatchGuard } from './shared/guards/vote-permalink-match.guard';
import { voteAnonymousSsrMatchGuard } from './shared/guards/vote-anonymous-ssr-match.guard';
import { voteTokenMatchGuard } from './shared/guards/vote-token-match.guard';
import { AccountContextService } from './shared/services/account-context.service';
import { LensService } from './shared/services/lens.service';
import { OrgLensViewModeService } from './shared/services/org-lens-view-mode.service';
import { OrgRoleGrantsService } from './shared/services/org-role-grants.service';

import type { Route } from '@angular/router';

function findRoute(tree: Route[], path: string): Route | undefined {
  for (const route of tree) {
    if (route.path === path) return route;
    const nested = route.children ? findRoute(route.children, path) : undefined;
    if (nested) return nested;
  }
  return undefined;
}

// The authenticated shell: the pathless route that hosts every logged-in page. Top-level chrome-less routes (such as
// the login-free vote link) are mounted before it, so it is not `routes[0]`.
const shellRoute = routes.find((route) => route.path === '' && !!route.children)!;

// The flag decides legacy page vs outlet inside the gate (its own spec); this pins the child routes.
describe('Health Metrics routes', () => {
  const healthMetrics = findRoute(routes, 'foundation/health-metrics');

  it('gives every tab in the bar a child route under the gate', () => {
    const childPaths = (healthMetrics?.children ?? []).map((child) => child.path);

    expect(childPaths).toEqual(HEALTH_METRICS_TABS.map((tab) => tab.route));
  });

  it('lazy-loads the Training page on its route', async () => {
    const training = healthMetrics?.children?.find((child) => child.path === 'training');

    expect(training?.title).toBe('Health Metrics — Training');
    expect(await training?.loadComponent?.()).toBe(HealthMetricsTrainingComponent);
  });
});

describe('Personal newsletter route isolation', () => {
  it('mounts the auth-only Me reader ahead of permalink and publisher matches', async () => {
    const children = shellRoute.children!;
    const personal = findRoute(routes, 'newsletters/my')!;
    expect(personal).toMatchObject({ pathMatch: 'full', title: 'Newsletters', data: { lens: 'me', preload: false }, canActivate: [authGuard] });
    expect(await personal.loadComponent!()).toBe(MyNewsletterFoundationsComponent);
    const foundation = findRoute(routes, 'newsletters/my/:foundationSlug')!;
    expect(foundation).toMatchObject({ title: 'Newsletters', data: { lens: 'me', preload: false }, canActivate: [authGuard] });
    expect(await foundation.loadComponent!()).toBe(MyNewslettersComponent);
    // Look these up in the shell: the signed-out share preview mounts its own top-level `newsletters/:projectSlug/:id`.
    for (const path of ['newsletters/:projectSlug/:id', 'newsletters']) {
      const later = children.find((route) => route.path === path)!;
      expect(children.indexOf(personal)).toBeLessThan(children.indexOf(later));
      expect(children.indexOf(foundation)).toBeLessThan(children.indexOf(later));
    }
    expect(NEWSLETTER_ROUTES.map((route) => route.path)).toEqual([
      '',
      'list',
      'create',
      ':projectUid/publications/create',
      ':projectUid/publications/:publicationUid/edit',
      ':projectUid/:id/edit',
      ':projectUid/:id/analytics',
    ]);
  });
  it('preserves reader and publisher guards', () => {
    expect(shellRoute.children!.find((route) => route.path === 'newsletters/:projectSlug/:id')?.canActivate).toEqual([authGuard]);
    expect(findRoute(routes, 'newsletters')?.canActivate).toEqual([lensRedirectGuard, projectQueryParamGuard]);
    for (const lens of ['foundation', 'project']) {
      expect(findRoute(routes, `${lens}/newsletters`)?.canActivate).toEqual([newsletterAccessGuard, projectQueryParamGuard]);
    }
    for (const route of NEWSLETTER_ROUTES.filter((route) => route.loadComponent)) {
      expect(route.canActivate).toEqual([authGuard, newsletterAccessGuard]);
    }
  });
});

describe('Newsletter share preview route (#4940)', () => {
  const preview = routes.find((route) => route.path === 'newsletters/:projectSlug/:id' && route.canMatch?.includes(newsletterAnonymousSsrMatchGuard))!;

  it('mounts the signed-out share preview ahead of the authenticated shell', async () => {
    expect(preview).toMatchObject({ pathMatch: 'full', canMatch: [newsletterAnonymousSsrMatchGuard] });
    expect(preview.canActivate).toBeUndefined();
    expect(routes.indexOf(preview)).toBeLessThan(routes.indexOf(shellRoute));
    expect(await preview.loadComponent!()).toBe(NewsletterSharePreviewComponent);
  });

  it('leaves the signed-in reader in the shell behind authGuard', () => {
    const reader = shellRoute.children!.find((route) => route.path === 'newsletters/:projectSlug/:id')!;
    expect(reader.canActivate).toEqual([authGuard]);
    expect(reader.canMatch).toBeUndefined();
  });
});

describe('Vote permalink route isolation', () => {
  const children = shellRoute.children!;
  const voteIdEntries = children.filter((route) => route.path === 'votes/:id');
  const flat = children.find((route) => route.path === 'votes')!;

  it('mounts the vote detail page as the only auth-only /votes/:id entry, ahead of the lens-redirected votes mount', async () => {
    expect(voteIdEntries).toHaveLength(1);
    const [page] = voteIdEntries;

    expect(await page.loadComponent!()).toBe(VoteDetailComponent);
    expect(children.indexOf(page)).toBeLessThan(children.indexOf(flat));
    expect(page).toMatchObject({ pathMatch: 'full', canMatch: [votePermalinkMatchGuard], canActivate: [authGuard] });
    expect(flat.canActivate).toEqual([lensRedirectGuard, projectQueryParamGuard]);
  });

  it('keeps the lens the user came from on the detail page — no lens data, no lens redirect', () => {
    const [page] = voteIdEntries;

    expect(page.data).toEqual({ preload: false });
    expect(page.canActivate).not.toContain(lensRedirectGuard);
  });

  it('leaves /votes/create to the votes module and matches a vote uid', () => {
    const segments = (id: string) => [new UrlSegment('votes', {}), new UrlSegment(id, {})];
    const [page] = voteIdEntries;
    expect(votePermalinkMatchGuard(page, segments('create'))).toBe(false);
    expect(votePermalinkMatchGuard(page, segments('3f2b6c1e-0000-4000-8000-000000000001'))).toBe(true);
  });
});

describe('Login-free vote link route (#4363)', () => {
  const tokenRoute = routes.find((route) => route.path === 'votes/:id')!;
  const segments = (...parts: string[]) => parts.map((part) => new UrlSegment(part, {}));
  const matchWith = (platformId: string, hash: string, parts: string[] = ['votes', 'abc123']) => {
    window.location.hash = hash;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platformId }] });
    return TestBed.runInInjectionContext(() => voteTokenMatchGuard(tokenRoute, segments(...parts)) as boolean);
  };

  it('mounts a chrome-less top-level route before the authenticated shell', () => {
    expect(routes.indexOf(tokenRoute)).toBeGreaterThanOrEqual(0);
    expect(routes.indexOf(tokenRoute)).toBeLessThan(routes.indexOf(shellRoute));
    expect(tokenRoute).toMatchObject({ pathMatch: 'full', canMatch: [voteTokenMatchGuard] });
    expect(tokenRoute.canActivate).toBeUndefined();
    expect(tokenRoute.children).toBeUndefined();
  });

  it('matches only in the browser and only when the fragment carries vote_token', () => {
    expect(matchWith('browser', '#vote_token=synthetic')).toBe(true);
    expect(matchWith('browser', '#other=1&vote_token=synthetic')).toBe(true);
    expect(matchWith('browser', '')).toBe(false);
    expect(matchWith('browser', '#section')).toBe(false);
    expect(matchWith('server', '#vote_token=synthetic')).toBe(false);
    window.location.hash = '';
  });

  it('does not match the create segment', () => {
    expect(matchWith('browser', '#vote_token=synthetic', ['votes', 'create'])).toBe(false);
    window.location.hash = '';
  });

  it('renders the neutral page, not the authenticated shell, for an anonymous server render of /votes/:id', () => {
    const anonymousRoute = routes.find((route) => route.path === 'votes/:id' && route.canMatch?.includes(voteAnonymousSsrMatchGuard))!;
    expect(routes.indexOf(anonymousRoute)).toBeLessThan(routes.indexOf(shellRoute));

    const matches = (platformId: string, auth: unknown, parts = ['votes', 'abc123']) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: PLATFORM_ID, useValue: platformId },
          { provide: REQUEST_CONTEXT, useValue: auth === undefined ? null : { auth } },
        ],
      });
      return TestBed.runInInjectionContext(() => voteAnonymousSsrMatchGuard(anonymousRoute, segments(...parts)) as boolean);
    };

    expect(matches('server', { authenticated: false })).toBe(true);
    expect(matches('server', { authenticated: true })).toBe(false);
    expect(matches('server', undefined)).toBe(false);
    expect(matches('browser', { authenticated: false })).toBe(false);
    expect(matches('server', { authenticated: false }, ['votes', 'create'])).toBe(false);
  });

  it('leaves the authenticated permalink and presenter routes untouched', () => {
    const permalink = shellRoute.children!.find((route) => route.path === 'votes/:id')!;
    expect(permalink).toMatchObject({ canMatch: [votePermalinkMatchGuard], canActivate: [authGuard] });
    expect(findRoute(routes, 'votes/:id/present')?.canActivate).toContain(authGuard);
  });
});

@Component({ selector: 'lfx-route-sentinel', template: '{{ page }}' })
class RouteSentinelComponent {
  public readonly page = inject(ActivatedRoute).snapshot.data['page'];
}

describe('My Meetups routes', () => {
  const meetups = findRoute(routes, 'meetups');
  const legacyMeetups = findRoute(routes, 'me/meetups');

  it('guards the production meetup mount and keeps the full-match legacy redirect', () => {
    expect(meetups?.canActivate).toEqual([meetupsLensGuard]);
    expect(meetups?.loadChildren).toBeTypeOf('function');
    expect(legacyMeetups).toMatchObject({ redirectTo: 'meetups', pathMatch: 'full' });
  });

  for (const path of ['/meetups', '/me/meetups']) {
    it.each(['me', 'foundation', 'project', 'org'] as Lens[])(
      `retains query and fragment on ${path} from %s without a lens-prefixed rewrite or 404`,
      async (initialLens) => {
        expect(meetups).toBeDefined();
        expect(legacyMeetups).toBeDefined();
        const activeLens = signal<Lens>(initialLens);
        const setLens = vi.fn((lens: Lens) => activeLens.set(lens));
        // Keep production route policy; replace only the lazy page with a lightweight sentinel.
        const meetupMount = { ...meetups, loadChildren: undefined };
        TestBed.configureTestingModule({
          providers: [
            { provide: LensService, useValue: { activeLens, setLens } },
            provideRouter([
              { ...meetupMount, children: [{ path: '', component: RouteSentinelComponent, data: { page: 'My Meetups' } }] },
              { ...legacyMeetups! },
              { path: '**', component: RouteSentinelComponent, data: { page: 'Page Not Found' } },
            ]),
          ],
        });
        const harness = await RouterTestingHarness.create();

        await harness.navigateByUrl(`${path}?tab=past&community=synthetic#anchor`, RouteSentinelComponent);

        expect(TestBed.inject(Router).url).toBe('/meetups?tab=past&community=synthetic#anchor');
        expect(harness.routeNativeElement?.textContent).toBe('My Meetups');
        expect(activeLens()).toBe(initialLens === 'org' ? 'org' : 'me');
        if (initialLens === 'org') {
          expect(setLens).not.toHaveBeenCalled();
        } else {
          expect(setLens).toHaveBeenCalledExactlyOnceWith('me');
        }
      }
    );
  }
});

describe('Org Lens roll-up routes', () => {
  const org = shellRoute.children!.find((route) => route.path === ORG_LENS_URL_ROOT)!;
  const addressed = org.children!.find((route) => route.path === `:${ORG_SEGMENT_PARAM}`)!;
  const gates = (children: Route[]): Route[] => children.filter((route) => route.canMatch?.includes(orgRollUpUnavailablePageGuard));

  it.each([
    ['legacy', org.children!],
    ['addressed', addressed.children!],
  ])('declares the unavailable page ahead of every page a roll-up cannot render yet (%s mount)', (_mount, children) => {
    expect(gates(children).map((gate) => gate.path)).toEqual([
      'overview',
      'memberships/:foundationSlug',
      'projects',
      'projects/:projectSlug',
      'roi',
      'people',
      'contributions',
      'meetings',
      'groups',
    ]);
    for (const gate of gates(children)) {
      expect(children[children.indexOf(gate) + 1].path).toBe(gate.path);
    }
  });

  // A page's own match guards run on its stand-in first, so a page the caller may not match is never disclosed.
  it.each([
    ['legacy', org.children!],
    ['addressed', addressed.children!],
  ])("runs each page's own match guards ahead of the roll-up guard (%s mount)", (_mount, children) => {
    for (const gate of gates(children)) {
      const page = children[children.indexOf(gate) + 1];
      expect(gate.canMatch).toEqual([...(page.canMatch ?? []), orgRollUpUnavailablePageGuard]);
    }
    expect(gates(children).find((gate) => gate.path === 'roi')?.canMatch).toEqual([orgLensLfStaffOnlyGuard, orgRollUpUnavailablePageGuard]);
  });

  it('lazy-loads the unavailable page for every address under a gated page', async () => {
    const people = gates(addressed.children!).find((gate) => gate.path === 'people')!;

    expect(people.children?.map((child) => child.path)).toEqual(['**']);
    expect(await people.children?.[0].loadComponent?.()).toBe(OrgRollUpUnavailableComponent);
  });

  it("sends a bare roll-up address to its Memberships page and an organization's to its overview", () => {
    const redirect = addressed.children!.find((route) => route.path === '')!.redirectTo as RedirectFunction;

    expect(redirect({ params: { [ORG_SEGMENT_PARAM]: 'family-0014100000RootAAAA' } } as never)).toBe('memberships');
    expect(redirect({ params: { [ORG_SEGMENT_PARAM]: 'acme-inc' } } as never)).toBe('overview');
  });

  // The segment is normalized first, as the guards do, so a differently cased or padded roll-up key still lands home.
  it.each([['FAMILY-0014100000RootAAAA'], ['Family-0014100000RootAAAA'], [' family-0014100000RootAAAA ']])(
    'sends a non-canonical roll-up address (%j) to its Memberships page',
    (segment) => {
      const redirect = addressed.children!.find((route) => route.path === '')!.redirectTo as RedirectFunction;

      expect(redirect({ params: { [ORG_SEGMENT_PARAM]: segment } } as never)).toBe('memberships');
    }
  );

  describe('bare /company', () => {
    const legacyHome = org.children!.find((route) => route.path === '')!;
    const overviewGate = gates(org.children!).find((gate) => gate.path === 'overview')!;
    const sentinel = (page: string): Route[] => [{ path: '**', component: RouteSentinelComponent, data: { page } }];

    // Keeps the production redirect and the production overview gate; only the lazy pages are sentinels.
    async function visitBareOrg(isRollUp: boolean, home: Route = legacyHome): Promise<string | undefined> {
      TestBed.configureTestingModule({
        providers: [
          { provide: AccountContextService, useValue: { isRollUp: signal(isRollUp) } },
          provideRouter([
            {
              path: ORG_LENS_URL_ROOT,
              children: [
                home,
                { ...overviewGate, children: sentinel('Roll-up unavailable') },
                { path: 'overview', children: sentinel('Overview') },
                { path: 'memberships', children: sentinel('Memberships') },
              ],
            },
          ]),
        ],
      });
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/company');
      return harness.routeNativeElement?.textContent?.trim();
    }

    it("sends a cookie-restored roll-up to the roll-up's Memberships page", async () => {
      expect(await visitBareOrg(true)).toBe('Memberships');
      expect(TestBed.inject(Router).url).toBe('/company/memberships');
    });

    it('sends an organization to its overview', async () => {
      expect(await visitBareOrg(false)).toBe('Overview');
      expect(TestBed.inject(Router).url).toBe('/company/overview');
    });

    // Belt and braces: were bare `/company` ever redirected to the overview on a roll-up, the gate still catches it,
    // although the URL being recognized is `/company`.
    it('still gates the overview when a bare-address redirect lands there on a roll-up', async () => {
      expect(await visitBareOrg(true, { path: '', pathMatch: 'full', redirectTo: 'overview' })).toBe('Roll-up unavailable');
      expect(TestBed.inject(Router).url).toBe('/company/overview');
    });
  });
});

// #5855 — the Memberships page and its detail page are closed to the all employee view (epic #5845). The guard's own
// behaviour is covered by its spec; this runs each route's real guard to pin that both routes carry it.
describe('Company Lens Memberships routes (#5855)', () => {
  const verdictFor = async (path: string, url: string, employeeView: boolean): Promise<string | true> => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: OrgLensViewModeService, useValue: { isEmployeeView: signal(employeeView) } },
        { provide: OrgRoleGrantsService, useValue: { loaded: signal(true) } },
      ],
    });
    // A page that cannot render a family roll-up is preceded by its roll-up stand-in (same path, no guard); the page itself is the one that has `canActivate`.
    const pages = (tree: Route[]): Route[] =>
      tree.flatMap((route) => [...(route.path === path ? [route] : []), ...(route.children ? pages(route.children) : [])]);
    const guard = pages(routes).find((route) => route.canActivate)!.canActivate![0] as CanActivateFn;
    const result = await TestBed.runInInjectionContext(() => guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot));
    return result === true ? true : TestBed.inject(Router).serializeUrl(result as UrlTree);
  };

  it.each([
    ['memberships', '/company/acme-inc/memberships'],
    ['memberships/:foundationSlug', '/company/acme-inc/memberships/linux-foundation'],
  ])('redirects %s to Overview in the employee view and opens it in the full view', async (path, url) => {
    expect(await verdictFor(path, url, true)).toBe('/company/acme-inc/overview');

    TestBed.resetTestingModule();
    expect(await verdictFor(path, url, false)).toBe(true);
  });
});

// #5856 — the People page is hidden in the all employee view (epic #5845): its route redirects to Overview there.
describe('Company Lens People route (all employee view)', () => {
  it('is guarded so the employee view redirects to Overview, and the full view opens it', async () => {
    // The page route itself, not its roll-up stand-in (same path, match guards only), on the legacy mount.
    const org = shellRoute.children!.find((route) => route.path === ORG_LENS_URL_ROOT)!;
    const peopleRoute = org.children!.find((route) => route.path === 'people' && !!route.loadComponent);
    expect(peopleRoute?.canActivate).toHaveLength(1);

    const isEmployeeView = signal(true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: OrgLensViewModeService, useValue: { isEmployeeView } },
        { provide: OrgRoleGrantsService, useValue: { loaded: signal(true) } },
      ],
    });
    const router = TestBed.inject(Router);
    const verdict = async (): Promise<unknown> =>
      TestBed.runInInjectionContext(() =>
        (peopleRoute?.canActivate?.[0] as CanActivateFn)({} as ActivatedRouteSnapshot, { url: '/company/acme-inc/people' } as RouterStateSnapshot)
      );

    expect(router.serializeUrl((await verdict()) as UrlTree)).toBe('/company/acme-inc/overview');

    isEmployeeView.set(false);
    expect(await verdict()).toBe(true);
  });
});

// Epic #5845 (#5858): the company Profile page redirects to Overview in the all employee view. The redirect itself is
// `orgLensFullViewOnlyGuard`'s own spec; this pins that both mounts of the page carry it beside the roll-up redirect.
describe('Org Lens Profile route in the all employee view', () => {
  const org = shellRoute.children!.find((route) => route.path === ORG_LENS_URL_ROOT)!;
  const addressed = org.children!.find((route) => route.path === `:${ORG_SEGMENT_PARAM}`)!;

  it.each([
    ['legacy', org.children!],
    ['addressed', addressed.children!],
  ])('keeps the roll-up redirect and adds the full-view-only guard (%s mount)', (_mount, children) => {
    const profile = children.find((route) => route.path === 'profile')!;

    expect(profile.canActivate).toHaveLength(2);
    expect(profile.canActivate![0]).toBe(orgRollUpSingleOrgPageGuard);
    expect(typeof profile.canActivate![1]).toBe('function');
  });
});
