// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const EVENTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./my-events-dashboard/my-events-dashboard.component').then((m) => m.MyEventsDashboardComponent),
    canActivate: [authGuard],
    data: { preload: true, preloadDelay: 1500 },
  },
];

export const FOUNDATION_EVENTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./foundation-event-dashboard/foundation-event-dashboard.component').then((m) => m.FoundationEventDashboardComponent),
    canActivate: [authGuard],
    data: { preload: true, preloadDelay: 1500 },
  },
];
