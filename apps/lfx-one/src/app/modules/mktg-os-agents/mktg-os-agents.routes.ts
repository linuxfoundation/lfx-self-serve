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
  {
    // Standalone one-page Brand Kit intake form (dec-brand-kit-intake-form)
    // with the BFF persistence-receipt retry flow (dec-brand-kit-storage-v2).
    // Kept routable alongside the generic form-first run shell below; whether
    // the two surfaces converge is a product decision, not resolved here.
    // Static path — must precede the `:agentId` matcher.
    path: 'brand-kit-form',
    loadComponent: () => import('./brand-kit-form/brand-kit-form.component').then((m) => m.BrandKitFormComponent),
    canActivate: [authGuard],
  },
  {
    path: ':agentId',
    loadComponent: () => import('./mktg-agent-run/mktg-agent-run.component').then((m) => m.MktgAgentRunComponent),
    canActivate: [authGuard],
  },
];
