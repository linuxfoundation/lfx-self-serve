// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_TABS } from '@lfx-one/shared/constants';
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Lens } from '@lfx-one/shared/interfaces';
import { describe, expect, it, vi } from 'vitest';

import { routes } from './app.routes';
import { HealthMetricsTrainingComponent } from './modules/dashboards/health-metrics-training/health-metrics-training.component';
import { meetupsLensGuard } from './shared/guards/meetups-lens.guard';
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
