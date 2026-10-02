// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_TABS } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { routes } from './app.routes';
import { HealthMetricsTrainingComponent } from './modules/dashboards/health-metrics-training/health-metrics-training.component';

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
