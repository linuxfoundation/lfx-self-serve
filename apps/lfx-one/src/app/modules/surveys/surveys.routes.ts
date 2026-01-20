// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const SURVEY_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./surveys-dashboard/surveys-dashboard.component').then((m) => m.SurveysDashboardComponent),
    canActivate: [authGuard],
    data: { preload: true, preloadDelay: 1500 },
  },
];
