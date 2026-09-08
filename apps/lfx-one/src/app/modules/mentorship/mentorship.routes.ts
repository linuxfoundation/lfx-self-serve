// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

export const MENTORSHIP_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'admin',
  },
  {
    path: 'admin',
    loadComponent: () => import('./admin/admin.component').then((m) => m.AdminComponent),
  },
  {
    path: 'admin/enroll',
    loadComponent: () => import('./admin/enroll-program/enroll-program.component').then((m) => m.EnrollProgramComponent),
  },
  {
    path: 'admin/:programId',
    loadComponent: () => import('./admin/program-detail/program-detail.component').then((m) => m.ProgramDetailComponent),
  },
];
