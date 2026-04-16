// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const EVENTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./events-dashboard/events-dashboard.component').then((m) => m.EventsDashboardComponent),
    canActivate: [authGuard],
    data: { preload: true, preloadDelay: 1500 },
  },
];
