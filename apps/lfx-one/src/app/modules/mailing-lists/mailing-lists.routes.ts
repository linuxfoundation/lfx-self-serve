// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const MAILING_LIST_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./mailing-list-dashboard/mailing-list-dashboard.component').then((m) => m.MailingListDashboardComponent),
    canActivate: [authGuard],
    data: { preload: true, preloadDelay: 1500 },
  },
];
