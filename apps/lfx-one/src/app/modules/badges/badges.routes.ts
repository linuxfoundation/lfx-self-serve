// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const BADGE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./badges-dashboard/badges-dashboard.component').then((m) => m.BadgesDashboardComponent),
    canActivate: [authGuard],
    data: { preload: true, preloadDelay: 1500 },
  },
];
