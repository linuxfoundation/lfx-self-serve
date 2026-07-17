// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

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

      // Direct-URL-only routes (no tab, but still accessible)
      {
        path: 'password',
        loadComponent: () => import('./password/profile-password.component').then((m) => m.ProfilePasswordComponent),
      },
      {
        path: 'email',
        loadComponent: () => import('./email/profile-email.component').then((m) => m.ProfileEmailComponent),
      },

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
