// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const OSSPREY_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./ossprey-dashboard/ossprey-dashboard.component').then((m) => m.OsspreyDashboardComponent),
    canActivate: [authGuard],
  },
];
