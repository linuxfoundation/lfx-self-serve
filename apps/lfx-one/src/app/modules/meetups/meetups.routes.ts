// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const MEETUPS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./meetups-dashboard/meetups-dashboard.component').then((m) => m.MeetupsDashboardComponent),
    canActivate: [authGuard],
    data: { preload: true, preloadDelay: 1500 },
  },
];
