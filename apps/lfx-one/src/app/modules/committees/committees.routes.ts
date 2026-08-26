// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';
import { writerGuard } from '@shared/guards/writer.guard';

export const COMMITTEE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./committee-dashboard/committee-dashboard.component').then((m) => m.CommitteeDashboardComponent),
    canActivate: [authGuard],
    data: { preload: true, preloadDelay: 1500 },
  },
  {
    path: 'create',
    loadComponent: () => import('./committee-manage/committee-manage.component').then((m) => m.CommitteeManageComponent),
    canActivate: [authGuard, writerGuard],
    data: { writeFeature: 'committees' },
  },
  {
    path: ':id',
    loadComponent: () => import('./committee-view/committee-view.component').then((m) => m.CommitteeViewComponent),
    canActivate: [authGuard],
  },
  {
    path: ':id/edit',
    loadComponent: () => import('./committee-manage/committee-manage.component').then((m) => m.CommitteeManageComponent),
    canActivate: [authGuard, writerGuard],
    // entityScopedSlug: writerGuard resolves the authorization slug from the committee itself on
    // this route. A route-data flag, not a path check, so a route rename/restructure
    // can't silently revert the guard to stale-context authorization.
    data: { writeFeature: 'committees', entityScopedSlug: true },
  },
];
