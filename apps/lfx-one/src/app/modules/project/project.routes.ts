// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

export const PROJECT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./dashboard/project-dashboard/project.component').then((m) => m.ProjectComponent),
  },
  {
    path: 'meetings',
    loadChildren: () => import('./meetings/meetings.routes').then((m) => m.MEETINGS_ROUTES),
    data: { preload: true, preloadDelay: 500 }, // High-usage feature, preload quickly
  },
  {
    path: 'committees',
    loadChildren: () => import('./committees/committees.routes').then((m) => m.COMMITTEES_ROUTES),
    data: { preload: true, preloadDelay: 1500 }, // Medium usage, moderate delay
  },
];
