// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const TRAINING_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./trainings-dashboard/trainings-dashboard.component').then((m) => m.TrainingsDashboardComponent),
    canActivate: [authGuard],
    data: { preload: true, preloadDelay: 1500 },
  },
];
