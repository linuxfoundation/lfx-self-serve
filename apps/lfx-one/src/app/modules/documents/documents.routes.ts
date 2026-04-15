// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const DOCUMENT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./documents-dashboard/documents-dashboard.component').then((m) => m.DocumentsDashboardComponent),
    canActivate: [authGuard],
    data: { preload: true, preloadDelay: 1500 },
  },
];
