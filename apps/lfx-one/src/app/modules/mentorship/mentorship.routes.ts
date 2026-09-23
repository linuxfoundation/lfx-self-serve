// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

import { menteeApplyGuard } from '@shared/guards/mentee-apply.guard';
import { menteeRegisterGuard } from '@shared/guards/mentee-profile.guard';

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
    // Mentor program-detail — lives as a sibling of the `path: 'mentor'` shell, not a
    // child of it, because this page has its own H1 and back-to-programs chrome (the
    // design doesn't reuse the shell's underline tabs). Listed before the prefix-matched
    // shell so `/mentorship/mentor/programs/:programId` never falls through to the
    // shell's `programs` child.
    path: 'mentor/programs/:programId',
    title: 'Program',
    loadComponent: () => import('./mentor/mentor-program-detail/mentor-program-detail.component').then((m) => m.MentorProgramDetailComponent),
  },
  {
    // Register form — matches `/mentorship/mentee` exactly. `canActivate` checks whether
    // the user already has a mentee profile; if so it redirects to the apply page when
    // both apply ids are on the URL, otherwise to the shell's overview.
    // Today the mock always returns `false` (no profile), so this always renders.
    // `pathMatch: 'full'` keeps it from swallowing shell children.
    path: 'mentee',
    pathMatch: 'full',
    title: 'Become a Mentee',
    canActivate: [menteeRegisterGuard],
    loadComponent: () => import('./mentee/mentee-register/mentee-register.component').then((m) => m.MenteeRegisterComponent),
  },
  {
    // Apply review. Sibling of the mentee shell, listed before the prefix-matched
    // `path: 'mentee'` shell, because this page has its own H1 and back link — the
    // shell's tabs and "My Mentorship" heading do not belong here. A prefix match
    // on the shell would otherwise swallow `/mentorship/mentee/apply`.
    path: 'mentee/apply',
    title: 'Apply',
    canActivate: [menteeApplyGuard],
    loadComponent: () => import('./mentee/mentee-apply/mentee-apply.component').then((m) => m.MenteeApplyComponent),
  },
  {
    // Mentee shell — owns the underline tabs and the page H1. No guard: child routes
    // like `/mentorship/mentee/overview` are always accessible (deep-linkable, and the
    // dev shortcut on the register page navigates here directly).
    path: 'mentee',
    loadComponent: () => import('./mentee/mentee-page/mentee-page.component').then((m) => m.MenteePageComponent),
    children: [
      {
        path: 'overview',
        title: 'Overview',
        loadComponent: () => import('./mentee/mentee-overview/mentee-overview.component').then((m) => m.MenteeOverviewComponent),
      },
      {
        path: 'tasks',
        title: 'My Application Tasks',
        loadComponent: () => import('./mentee/mentee-application-tasks/mentee-application-tasks.component').then((m) => m.MenteeApplicationTasksComponent),
      },
      {
        path: 'profile',
        title: 'Mentee Profile',
        loadComponent: () => import('./mentee/mentee-profile/mentee-profile.component').then((m) => m.MenteeProfileComponent),
      },
      { path: '**', redirectTo: 'overview' },
    ],
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
