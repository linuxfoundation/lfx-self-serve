// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

import { authGuard } from '../../shared/guards/auth.guard';

/**
 * Route tree for the embedded Gatewaze admin pilot (`/foundation/gw`).
 *
 * A single wildcard entry is deliberate, not a placeholder: once `GwModuleOutletComponent` mounts
 * `@gatewaze/admin-embed`, the embed's own router owns every sub-path under this mount (the
 * spec's dual-router contract) — Angular only ever needs to match once for the whole subtree.
 */
export const GW_ROUTES: Routes = [
  {
    path: '**',
    loadComponent: () => import('./gw-module-outlet/gw-module-outlet.component').then((m) => m.GwModuleOutletComponent),
    canActivate: [authGuard],
  },
];
