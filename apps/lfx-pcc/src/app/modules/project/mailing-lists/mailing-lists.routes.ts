// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

export const MAILING_LISTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./mailing-list-dashboard/mailing-list-dashboard.component').then((m) => m.MailingListDashboardComponent),
  },
];
