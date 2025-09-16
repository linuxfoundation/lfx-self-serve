// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

export const COMMITTEES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./committee-dashboard/committee-dashboard.component').then((m) => m.CommitteeDashboardComponent),
  },
  {
    path: ':id',
    loadComponent: () => import('./committee-view/committee-view.component').then((m) => m.CommitteeViewComponent),
  },
];
