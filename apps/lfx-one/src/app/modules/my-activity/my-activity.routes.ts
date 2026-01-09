// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const MY_ACTIVITY_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./my-activity-dashboard/my-activity-dashboard.component').then((m) => m.MyActivityDashboardComponent),
    canActivate: [authGuard],
    data: { preload: true, preloadDelay: 1500 },
  },
];
