// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

import { myClasEnabledGuard } from '@app/shared/guards/my-clas-enabled.guard';

export const PROFILE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('@app/layouts/profile-layout/profile-layout.component').then((m) => m.ProfileLayoutComponent),
    children: [
      // Default redirect to attributions
      { path: '', redirectTo: 'attributions', pathMatch: 'full' },

      // Work history & Affiliations tab (merges affiliations + work experience)
      {
        path: 'attributions',
        loadComponent: () => import('./attribution/profile-attribution.component').then((m) => m.ProfileAttributionComponent),
      },

      // Identities tab
      {
        path: 'identities',
        loadComponent: () => import('./identities/profile-identities.component').then((m) => m.ProfileIdentitiesComponent),
      },

      // Individual Enrollment tab
      {
        path: 'individual-enrollment',
        loadComponent: () => import('./individual-enrollment/profile-individual-enrollment.component').then((m) => m.ProfileIndividualEnrollmentComponent),
      },

      // CLAs tab — read-only EasyCLA agreements, dark-launched behind `my-clas-enabled` (CanMatch).
      {
        path: 'clas',
        canMatch: [myClasEnabledGuard],
        loadComponent: () => import('./clas/profile-clas.component').then((m) => m.ProfileClasComponent),
      },

      // Transactions tab — canonical home for the former /me/transactions page.
      // `embedded` suppresses the component's own page header inside the profile shell.
      {
        path: 'transactions',
        data: { embedded: true },
        loadComponent: () => import('../transactions/transactions-dashboard/transactions-dashboard.component').then((m) => m.TransactionsDashboardComponent),
      },

      // Settings tab — canonical home for the former me-context /settings page.
      // `embedded` suppresses the component's own page header inside the profile shell.
      {
        path: 'settings',
        data: { embedded: true },
        loadComponent: () => import('../settings/account-settings/account-settings.component').then((m) => m.AccountSettingsComponent),
      },

      // linux-email is now embedded in the Identities tab — redirect for backward compat
      { path: 'linux-email', redirectTo: 'identities' },

      // Email and password management now live in the Settings tab — redirect the old
      // standalone pages there, scrolled to the matching section (see account-settings.component.ts).
      { path: 'password', redirectTo: '/profile/settings#password' },
      { path: 'email', redirectTo: '/profile/settings#email-settings' },
      { path: 'emails', redirectTo: '/profile/settings#email-settings' },

      // Backward-compat redirects for old URLs
      { path: 'attribution', redirectTo: 'attributions' },
      { path: 'overview', redirectTo: 'attributions' },
      { path: 'edit', redirectTo: 'attributions' },
      { path: 'affiliations', redirectTo: 'attributions' },
      { path: 'work-experience', redirectTo: 'attributions' },
      { path: 'identity-services', redirectTo: 'identities' },
      { path: 'badges', redirectTo: 'attributions' },
      { path: 'certificates', redirectTo: 'attributions' },
      { path: 'visibility', redirectTo: 'attributions' },
      { path: 'manage', redirectTo: 'attributions' },
    ],
  },
];
