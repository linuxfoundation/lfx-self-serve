// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@app/shared/guards/auth.guard';

export const CROWDFUNDING_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'initiatives',
  },
  {
    path: 'initiatives',
    loadComponent: () => import('./my-initiatives/my-initiatives.component').then((m) => m.MyInitiativesComponent),
  },
  {
    path: 'initiatives/:slug',
    loadComponent: () => import('./initiative-detail/initiative-detail.component').then((m) => m.InitiativeDetailComponent),
  },
  {
    path: 'donations',
    loadComponent: () => import('./my-donations/my-donations.component').then((m) => m.MyDonationsComponent),
  },
  {
    path: 'donations/recurring/:id',
    loadComponent: () => import('./recurring-donation-detail/recurring-donation-detail.component').then((m) => m.RecurringDonationDetailComponent),
    canActivate: [authGuard],
  },
];
