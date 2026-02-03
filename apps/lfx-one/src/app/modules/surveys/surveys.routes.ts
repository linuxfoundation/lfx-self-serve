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
  {
    path: 'create',
    loadComponent: () => import('./survey-manage/survey-manage.component').then((m) => m.SurveyManageComponent),
    canActivate: [authGuard],
  },
  {
    path: ':id/edit',
    loadComponent: () => import('./survey-manage/survey-manage.component').then((m) => m.SurveyManageComponent),
    canActivate: [authGuard],
  },
];
