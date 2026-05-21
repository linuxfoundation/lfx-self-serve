// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const CROWDFUNDING_ROUTES: Routes = [
  {
    path: 'initiatives',
    loadComponent: () => import('./my-initiatives/my-initiatives.component').then((m) => m.MyInitiativesComponent),
    canActivate: [authGuard],
  },
];
