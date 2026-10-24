// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router, UrlSegment } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { HEALTH_METRICS_TABS } from '@lfx-one/shared/constants';
import { Lens } from '@lfx-one/shared/interfaces';
import { describe, expect, it, vi } from 'vitest';

import { routes } from './app.routes';
import { HealthMetricsTrainingComponent } from './modules/dashboards/health-metrics-training/health-metrics-training.component';
import { MyNewsletterFoundationsComponent } from './modules/newsletters/my-newsletter-foundations/my-newsletter-foundations.component';
import { MyNewslettersComponent } from './modules/newsletters/my-newsletters/my-newsletters.component';
import { NEWSLETTER_ROUTES } from './modules/newsletters/newsletters.routes';
import { VoteDetailComponent } from './modules/votes/vote-detail/vote-detail.component';
import { VotePermalinkComponent } from './modules/votes/vote-permalink/vote-permalink.component';
import { authGuard } from './shared/guards/auth.guard';
import { lensRedirectGuard } from './shared/guards/lens-redirect.guard';
import { meetupsLensGuard } from './shared/guards/meetups-lens.guard';
import { newsletterAccessGuard } from './shared/guards/newsletter-access.guard';
import { projectQueryParamGuard } from './shared/guards/project-query-param.guard';
import { voteDetailPageGuard } from './shared/guards/vote-detail-page.guard';
import { votePermalinkMatchGuard } from './shared/guards/vote-permalink-match.guard';
import { LensService } from './shared/services/lens.service';

import type { Route } from '@angular/router';

function findRoute(tree: Route[], path: string): Route | undefined {
  for (const route of tree) {
    if (route.path === path) return route;
    const nested = route.children ? findRoute(route.children, path) : undefined;
    if (nested) return nested;
  }
  return undefined;
}

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
    const children = routes[0].children!;
    const personal = findRoute(routes, 'newsletters/my')!;
    expect(personal).toMatchObject({ pathMatch: 'full', title: 'Newsletters', data: { lens: 'me', preload: false }, canActivate: [authGuard] });
    expect(await personal.loadComponent!()).toBe(MyNewsletterFoundationsComponent);
    const foundation = findRoute(routes, 'newsletters/my/:foundationSlug')!;
    expect(foundation).toMatchObject({ title: 'Newsletters', data: { lens: 'me', preload: false }, canActivate: [authGuard] });
    expect(await foundation.loadComponent!()).toBe(MyNewslettersComponent);
    for (const path of ['newsletters/:projectSlug/:id', 'newsletters']) {
      expect(children.indexOf(personal)).toBeLessThan(children.indexOf(findRoute(routes, path)!));
      expect(children.indexOf(foundation)).toBeLessThan(children.indexOf(findRoute(routes, path)!));
    }
    expect(NEWSLETTER_ROUTES.map((route) => route.path)).toEqual(['', 'list', 'create', ':projectUid/:id/edit', ':projectUid/:id/analytics']);
  });
  it('preserves reader and publisher guards', () => {
    expect(findRoute(routes, 'newsletters/:projectSlug/:id')?.canActivate).toEqual([authGuard]);
    expect(findRoute(routes, 'newsletters')?.canActivate).toEqual([lensRedirectGuard, projectQueryParamGuard]);
    for (const lens of ['foundation', 'project']) {
      expect(findRoute(routes, `${lens}/newsletters`)?.canActivate).toEqual([newsletterAccessGuard, projectQueryParamGuard]);
    }
    for (const route of NEWSLETTER_ROUTES.filter((route) => route.loadComponent)) {
      expect(route.canActivate).toEqual([authGuard, newsletterAccessGuard]);
    }
  });
});

describe('Vote permalink route isolation', () => {
  const children = routes[0].children!;
  const voteIdEntries = children.filter((route) => route.path === 'votes/:id');
  const flat = children.find((route) => route.path === 'votes')!;
  const resolveEntry = async (component: unknown): Promise<Route> => {
    for (const route of voteIdEntries) {
      if ((await route.loadComponent!()) === component) return route;
    }
    throw new Error('votes/:id entry not found');
  };

  it('pairs the flagged detail page ahead of the auth-only Me permalink, both ahead of the lens-redirected votes mount', async () => {
    const page = await resolveEntry(VoteDetailComponent);
    const permalink = await resolveEntry(VotePermalinkComponent);

    expect(voteIdEntries).toHaveLength(2);
    expect(children.indexOf(page)).toBeLessThan(children.indexOf(permalink));
    expect(children.indexOf(permalink)).toBeLessThan(children.indexOf(flat));
    expect(page).toMatchObject({ pathMatch: 'full', canMatch: [votePermalinkMatchGuard, voteDetailPageGuard], canActivate: [authGuard] });
    expect(permalink).toMatchObject({
      pathMatch: 'full',
      data: { lens: 'me', preload: false },
      canMatch: [votePermalinkMatchGuard],
      canActivate: [authGuard],
    });
    expect(page.title).toBe(permalink.title);
    expect(flat.canActivate).toEqual([lensRedirectGuard, projectQueryParamGuard]);
  });

  it('keeps the lens the user came from on the detail page — no lens data, no lens redirect', async () => {
    const page = await resolveEntry(VoteDetailComponent);

    expect(page.data).toEqual({ preload: false });
    expect(page.canActivate).not.toContain(lensRedirectGuard);
  });

  it('leaves /votes/create to the votes module and matches a vote uid', () => {
    const segments = (id: string) => [new UrlSegment('votes', {}), new UrlSegment(id, {})];
    for (const route of voteIdEntries) {
      expect(votePermalinkMatchGuard(route, segments('create'))).toBe(false);
      expect(votePermalinkMatchGuard(route, segments('3f2b6c1e-0000-4000-8000-000000000001'))).toBe(true);
    }
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
