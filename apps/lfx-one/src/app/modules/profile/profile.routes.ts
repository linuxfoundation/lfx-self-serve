// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

export const PROFILE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('@app/layouts/profile-layout/profile-layout.component').then((m) => m.ProfileLayoutComponent),
    children: [
      // Default redirect to attribution
      { path: '', redirectTo: 'attribution', pathMatch: 'full' },

      // Attribution tab (merges affiliations + work experience)
      {
        path: 'attribution',
        loadComponent: () => import('./attribution/profile-attribution.component').then((m) => m.ProfileAttributionComponent),
      },

      // Identities tab
      {
        path: 'identities',
        loadComponent: () => import('./identities/profile-identities.component').then((m) => m.ProfileIdentitiesComponent),
      },

      // Direct-URL-only routes (no tab, but still accessible)
      {
        path: 'password',
        loadComponent: () => import('./password/profile-password.component').then((m) => m.ProfilePasswordComponent),
      },
      {
        path: 'email',
        loadComponent: () => import('./email/profile-email.component').then((m) => m.ProfileEmailComponent),
      },
      {
        path: 'developer',
        loadComponent: () => import('./developer/profile-developer.component').then((m) => m.ProfileDeveloperComponent),
      },

      // Backward-compat redirects for old URLs
      { path: 'overview', redirectTo: 'attribution' },
      { path: 'edit', redirectTo: 'attribution' },
      { path: 'affiliations', redirectTo: 'attribution' },
      { path: 'work-experience', redirectTo: 'attribution' },
      { path: 'identity-services', redirectTo: 'identities' },
      { path: 'badges', redirectTo: 'attribution' },
      { path: 'certificates', redirectTo: 'attribution' },
      { path: 'visibility', redirectTo: 'attribution' },
      { path: 'manage', redirectTo: 'attribution' },
    ],
  },
];
