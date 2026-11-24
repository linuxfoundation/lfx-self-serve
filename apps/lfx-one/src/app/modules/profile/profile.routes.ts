// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { ACCOUNT_SETTINGS_SECTIONS, PROFILE_SETTINGS_PATH } from '@lfx-one/shared/constants';

import { profileRedesignRedirectGuard } from '../../shared/guards/profile-redesign.guard';

// Tabs that move to Account & Settings carry profileRedesignRedirectGuard, which sends them there once the profile
// redesign flag is on (#6067); the old Settings aliases reach it through the Settings tab.

/** The old Linux.com email tab now opens Identities, which holds it, keeping the query a Flow C return carries. */
const linuxEmailToIdentities: CanActivateFn = (route) => inject(Router).createUrlTree(['/profile/identities'], { queryParams: route.queryParams });

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
        title: 'Profile',
        loadComponent: () => import('./attribution/profile-attribution.component').then((m) => m.ProfileAttributionComponent),
      },

      // Identities tab
      {
        path: 'identities',
        title: 'Identities',
        canActivate: [profileRedesignRedirectGuard],
        loadComponent: () => import('./identities/profile-identities.component').then((m) => m.ProfileIdentitiesComponent),
      },

      // Individual Enrollment tab
      {
        path: 'individual-enrollment',
        title: 'Individual Enrollment',
        canActivate: [profileRedesignRedirectGuard],
        loadComponent: () => import('./individual-enrollment/profile-individual-enrollment.component').then((m) => m.ProfileIndividualEnrollmentComponent),
      },

      // CLAs tab — EasyCLA agreements.
      {
        path: 'clas',
        title: 'CLAs',
        canActivate: [profileRedesignRedirectGuard],
        loadComponent: () => import('./clas/profile-clas.component').then((m) => m.ProfileClasComponent),
      },

      // Transactions tab — canonical home for the former /me/transactions page.
      // `embedded` suppresses the component's own page header inside the profile shell.
      {
        path: 'transactions',
        title: 'Transactions',
        canActivate: [profileRedesignRedirectGuard],
        data: { embedded: true },
        loadComponent: () => import('../transactions/transactions-dashboard/transactions-dashboard.component').then((m) => m.TransactionsDashboardComponent),
      },

      // Settings tab — canonical home for the former me-context /settings page.
      // `embedded` suppresses the component's own page header inside the profile shell.
      {
        path: 'settings',
        title: 'Settings',
        canActivate: [profileRedesignRedirectGuard],
        data: { embedded: true },
        loadComponent: () => import('../settings/account-settings/account-settings.component').then((m) => m.AccountSettingsComponent),
      },

      // linux-email is embedded in the Identities tab. A redirect route can't carry a guard, so this is an empty
      // route whose guards run in order: the redesign one first, then the redirect to Identities.
      {
        path: 'linux-email',
        canActivate: [profileRedesignRedirectGuard, linuxEmailToIdentities],
        children: [],
      },

      // Redirect the old standalone email/password pages into the Settings tab section.
      // Functional redirectTo (not a string) is required to attach the #fragment — a string
      // redirectTo has no way to carry one.
      {
        path: 'password',
        redirectTo: ({ queryParams }) => inject(Router).createUrlTree([PROFILE_SETTINGS_PATH], { queryParams, fragment: ACCOUNT_SETTINGS_SECTIONS.PASSWORD }),
      },
      {
        path: 'email',
        redirectTo: ({ queryParams }) =>
          inject(Router).createUrlTree([PROFILE_SETTINGS_PATH], { queryParams, fragment: ACCOUNT_SETTINGS_SECTIONS.EMAIL_SETTINGS }),
      },
      // Section alias for old openprofile.dev links (ID-1147), which also land on password/email above: a path
      // survives the server-side login returnTo, where a #fragment would not.
      {
        path: 'developer-settings',
        redirectTo: ({ queryParams }) =>
          inject(Router).createUrlTree([PROFILE_SETTINGS_PATH], { queryParams, fragment: ACCOUNT_SETTINGS_SECTIONS.DEVELOPER_SETTINGS }),
      },
      // Unlike password/email above, this isn't a legacy redirect — profile.controller.ts's
      // Flow C flows emit returnTo=/profile/emails as their live landing path, so this route
      // must keep resolving even if the other two are ever retired.
      {
        path: 'emails',
        redirectTo: ({ queryParams }) =>
          inject(Router).createUrlTree([PROFILE_SETTINGS_PATH], { queryParams, fragment: ACCOUNT_SETTINGS_SECTIONS.EMAIL_SETTINGS }),
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
