// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const FORMATION_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./propose/propose.component').then((m) => m.ProposeComponent),
    canActivate: [authGuard],
  },
  {
    path: 'confirmation/:formationUid',
    loadComponent: () => import('./propose-confirmation/propose-confirmation.component').then((m) => m.ProposeConfirmationComponent),
    canActivate: [authGuard],
  },
];
