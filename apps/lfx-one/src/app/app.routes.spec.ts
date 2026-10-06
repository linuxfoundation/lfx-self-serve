// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_TABS } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { routes } from './app.routes';
import { HealthMetricsTrainingComponent } from './modules/dashboards/health-metrics-training/health-metrics-training.component';
import { MyNewslettersComponent } from './modules/newsletters/my-newsletters/my-newsletters.component';
import { NEWSLETTER_ROUTES } from './modules/newsletters/newsletters.routes';
import { authGuard } from './shared/guards/auth.guard';
import { lensRedirectGuard } from './shared/guards/lens-redirect.guard';
import { newsletterAccessGuard } from './shared/guards/newsletter-access.guard';
import { projectQueryParamGuard } from './shared/guards/project-query-param.guard';

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
    expect(personal).toMatchObject({ pathMatch: 'full', title: 'My Newsletters', data: { lens: 'me', preload: false }, canActivate: [authGuard] });
    expect(await personal.loadComponent!()).toBe(MyNewslettersComponent);
    for (const path of ['newsletters/:projectSlug/:id', 'newsletters']) {
      expect(children.indexOf(personal)).toBeLessThan(children.indexOf(findRoute(routes, path)!));
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
