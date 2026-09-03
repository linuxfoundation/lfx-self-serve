// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';
import { writerGuard } from '@shared/guards/writer.guard';

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
    canActivate: [authGuard, writerGuard],
    data: { preload: false, writeFeature: 'votes' },
  },
  {
    path: ':id/edit',
    loadComponent: () => import('./vote-manage/vote-manage.component').then((m) => m.VoteManageComponent),
    canActivate: [authGuard, writerGuard],
    // entityScopedSlug: writerGuard resolves the authorization slug from the vote itself; a route-data
    // flag (not a path check) so a route rename can't silently revert to stale-context authorization.
    data: { preload: false, writeFeature: 'votes', entityScopedSlug: true },
  },
];
