// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

export const MEETINGS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./meeting-dashboard/meeting-dashboard.component').then((m) => m.MeetingDashboardComponent),
  },
  {
    path: 'create',
    loadComponent: () => import('./components/meeting-manage/meeting-manage.component').then((m) => m.MeetingManageComponent),
  },
  {
    path: ':id/edit',
    loadComponent: () => import('./components/meeting-manage/meeting-manage.component').then((m) => m.MeetingManageComponent),
  },
];
