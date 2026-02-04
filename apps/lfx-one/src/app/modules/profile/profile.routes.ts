// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

export const PROFILE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('@app/layouts/profile-layout/profile-layout.component').then((m) => m.ProfileLayoutComponent),
    children: [
      // Default redirect to overview
      { path: '', redirectTo: 'overview', pathMatch: 'full' },

      // Overview tab (new)
      {
        path: 'overview',
        loadComponent: () => import('./profile-overview/profile-overview.component').then((m) => m.ProfileOverviewComponent),
      },

      // Edit profile (previously the default route)
      {
        path: 'edit',
        loadComponent: () => import('./manage-profile/profile-manage.component').then((m) => m.ProfileManageComponent),
      },

      // Security tabs
      {
        path: 'password',
        loadComponent: () => import('./password/profile-password.component').then((m) => m.ProfilePasswordComponent),
      },
      {
        path: 'email',
        loadComponent: () => import('./email/profile-email.component').then((m) => m.ProfileEmailComponent),
      },

      // Developer settings
      {
        path: 'developer',
        loadComponent: () => import('./developer/profile-developer.component').then((m) => m.ProfileDeveloperComponent),
      },

      // Affiliations tab
      {
        path: 'affiliations',
        loadComponent: () => import('./affiliations/profile-affiliations.component').then((m) => m.ProfileAffiliationsComponent),
      },

      // Future placeholders - redirect to overview for now
      { path: 'badges', redirectTo: 'overview' },
      { path: 'certificates', redirectTo: 'overview' },
      { path: 'visibility', redirectTo: 'overview' },
      { path: 'identity-services', redirectTo: 'overview' },
    ],
  },
];
