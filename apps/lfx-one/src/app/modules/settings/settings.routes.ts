// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const SETTINGS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./settings-dashboard/settings-dashboard.component').then((m) => m.SettingsDashboardComponent),
    canActivate: [authGuard],
    data: { preload: false }, // Settings accessed less frequently, don't preload
  },
];
