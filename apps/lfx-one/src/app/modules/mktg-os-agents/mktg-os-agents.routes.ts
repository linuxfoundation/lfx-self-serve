// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const MKTG_OS_AGENTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./mktg-os-agents/mktg-os-agents.component').then((m) => m.MktgOsAgentsComponent),
    canActivate: [authGuard],
  },
];
