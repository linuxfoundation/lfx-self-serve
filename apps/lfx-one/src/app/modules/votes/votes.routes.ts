// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const VOTE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./votes-dashboard/votes-dashboard.component').then((m) => m.VotesDashboardComponent),
    canActivate: [authGuard],
    data: { preload: true, preloadDelay: 1500 },
  },
  {
    path: 'create',
    loadComponent: () => import('./vote-manage/vote-manage.component').then((m) => m.VoteManageComponent),
    canActivate: [authGuard],
    data: { preload: false },
  },
  {
    path: ':id/edit',
    loadComponent: () => import('./vote-manage/vote-manage.component').then((m) => m.VoteManageComponent),
    canActivate: [authGuard],
    data: { preload: false },
  },
];
