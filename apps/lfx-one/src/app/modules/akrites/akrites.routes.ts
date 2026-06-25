// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const AKRITES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./akrites-dashboard/akrites-dashboard.component').then((m) => m.AkritesDashboardComponent),
    canActivate: [authGuard],
  },
];
