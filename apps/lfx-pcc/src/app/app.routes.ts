// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./modules/pages/home/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'meetings/:id',
    loadComponent: () => import('./modules/meeting/meeting.component').then((m) => m.MeetingComponent),
  },
  {
    path: 'project/:slug',
    loadComponent: () => import('./layouts/project-layout/project-layout.component').then((m) => m.ProjectLayoutComponent),
    loadChildren: () => import('./modules/project/project.routes').then((m) => m.PROJECT_ROUTES),
    data: { preload: true, preloadDelay: 1000 }, // Preload after 1 second for likely navigation
  },
];
