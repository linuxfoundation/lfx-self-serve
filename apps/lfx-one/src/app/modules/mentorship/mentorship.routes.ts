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
  {
    // Serves the Become a Mentor form until the profiles API can tell us the signed-in
    // user already has a mentor profile, at which point this path serves that instead.
    path: 'mentor',
    loadComponent: () => import('./mentor/mentor-register/mentor-register.component').then((m) => m.MentorRegisterComponent),
  },
];
