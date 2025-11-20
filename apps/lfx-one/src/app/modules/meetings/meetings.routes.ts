// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const MEETING_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./meetings-dashboard/meetings-dashboard.component').then((m) => m.MeetingsDashboardComponent),
    canActivate: [authGuard],
    data: { preload: true, preloadDelay: 500 },
  },
  {
    path: 'create',
    loadComponent: () => import('./meeting-manage/meeting-manage.component').then((m) => m.MeetingManageComponent),
  },
  {
    path: ':id/edit',
    loadComponent: () => import('./meeting-manage/meeting-manage.component').then((m) => m.MeetingManageComponent),
  },
];
