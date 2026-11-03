// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const IT_OS_AGENTS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./it-os-agents/it-os-agents.component').then((m) => m.ItOsAgentsComponent),
    canActivate: [authGuard],
  },
  {
    path: ':agentId',
    title: 'Agent',
    loadComponent: () => import('./it-os-agent/it-os-agent.component').then((m) => m.ItOsAgentComponent),
    canActivate: [authGuard],
  },
];
