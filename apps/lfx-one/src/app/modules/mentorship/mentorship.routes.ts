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
    title: 'Mentorship',
    loadComponent: () => import('./admin/admin.component').then((m) => m.AdminComponent),
  },
  {
    path: 'admin/enroll',
    title: 'Enroll Program',
    loadComponent: () => import('./admin/enroll-program/enroll-program.component').then((m) => m.EnrollProgramComponent),
  },
  {
    path: 'admin/:programId',
    title: 'Program',
    loadComponent: () => import('./admin/program-detail/program-detail.component').then((m) => m.ProgramDetailComponent),
  },
  {
    // Register form. `pathMatch: 'full'` keeps this route from swallowing the shell's
    // children below — `path: 'mentor'` with the default `prefix` match would otherwise
    // capture `/mentorship/mentor/programs` and `/mentorship/mentor/profile` too.
    //
    // Serves the Become a Mentor form until the profiles API can tell us the signed-in
    // user already has a mentor profile, at which point this path serves the shell
    // instead, falling back to this form when they have none.
    path: 'mentor',
    pathMatch: 'full',
    title: 'Become a Mentor',
    loadComponent: () => import('./mentor/mentor-register/mentor-register.component').then((m) => m.MentorRegisterComponent),
  },
  {
    // Mentor shell — owns the underline tabs and the page H1. Each child renders only
    // its own tab content, so this is the one place tab semantics live for the mentor
    // surface.
    path: 'mentor',
    loadComponent: () => import('./mentor/mentor-page/mentor-page.component').then((m) => m.MentorPageComponent),
    children: [
      // `/mentorship/mentor/` (trailing slash) lands here rather than 404, matching the
      // shell's default view. Wildcard below covers unknown children the same way.
      { path: '', pathMatch: 'full', redirectTo: 'programs' },
      {
        path: 'programs',
        title: 'My Programs',
        loadComponent: () => import('./mentor/mentor-programs/mentor-programs.component').then((m) => m.MentorProgramsComponent),
      },
      {
        path: 'profile',
        title: 'Mentor Profile',
        loadComponent: () => import('./mentor/mentor-profile/mentor-profile.component').then((m) => m.MentorProfileComponent),
      },
      { path: '**', redirectTo: 'programs' },
    ],
  },
];
