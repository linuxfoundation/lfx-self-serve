// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

import { authGuard } from './shared/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layouts/main-layout/main-layout.component').then((m) => m.MainLayoutComponent),
    children: [
      {
        path: '',
        loadComponent: () => import('./modules/dashboards/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'projects',
        loadComponent: () => import('./modules/pages/home/home.component').then((m) => m.HomeComponent),
      },
    ],
  },
  {
    path: 'meetings',
    loadChildren: () => import('./modules/meeting/meeting.routes').then((m) => m.MEETING_ROUTES),
  },
  {
    path: 'project/:slug',
    loadComponent: () => import('./layouts/project-layout/project-layout.component').then((m) => m.ProjectLayoutComponent),
    loadChildren: () => import('./modules/project/project.routes').then((m) => m.PROJECT_ROUTES),
    canActivate: [authGuard],
    data: { preload: true, preloadDelay: 1000 }, // Preload after 1 second for likely navigation
  },
  {
    path: 'profile',
    loadComponent: () => import('./layouts/profile-layout/profile-layout.component').then((m) => m.ProfileLayoutComponent),
    loadChildren: () => import('./modules/profile/profile.routes').then((m) => m.PROFILE_ROUTES),
    canActivate: [authGuard],
  },
];
