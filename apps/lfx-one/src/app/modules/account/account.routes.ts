// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { ACCOUNT_SETTINGS_SECTIONS } from '@lfx-one/shared/constants';
import { accountPathForProfileTab } from '@lfx-one/shared/utils';

const loadAccountSettings = () => import('../settings/account-settings/account-settings.component').then((m) => m.AccountSettingsComponent);

/**
 * A full-page load of an old `/profile/settings#password` link reaches the server without its fragment, so the server sends
 * it here; the browser still has the fragment and moves on to the section's own page.
 */
const settingsSectionFragmentGuard: CanActivateFn = (route) => {
  const target = route.fragment ? accountPathForProfileTab('settings', route.fragment) : null;
  return target && !target.endsWith(`/${route.routeConfig?.path}`) ? inject(Router).createUrlTree([target], { queryParams: route.queryParams }) : true;
};

/**
 * Account & Settings (#6067), behind the profile redesign flag. Each page reuses the Profile & Account hub tab it
 * replaces until its own redesign lands; the three settings pages share the settings page, one section each.
 */
export const ACCOUNT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('@app/layouts/account-layout/account-layout.component').then((m) => m.AccountLayoutComponent),
    children: [
      // The landing page arrives with #6069.
      { path: '', redirectTo: 'work-history', pathMatch: 'full' },
      // Personal information is still the hub's Edit profile drawer until #6072.
      { path: 'personal-information', redirectTo: '/profile' },
      {
        path: 'work-history',
        title: 'Work history & Affiliations',
        loadComponent: () => import('../profile/attribution/profile-attribution.component').then((m) => m.ProfileAttributionComponent),
      },
      {
        path: 'identities',
        title: 'Identities',
        loadComponent: () => import('../profile/identities/profile-identities.component').then((m) => m.ProfileIdentitiesComponent),
      },
      // Linux.com email still sits at the foot of Identities, which feeds it the verified addresses, until #6075.
      { path: 'linux-email', redirectTo: 'identities' },
      {
        path: 'individual-enrollment',
        title: 'Individual Enrollment',
        loadComponent: () =>
          import('../profile/individual-enrollment/profile-individual-enrollment.component').then((m) => m.ProfileIndividualEnrollmentComponent),
      },
      {
        path: 'clas',
        title: 'CLAs',
        loadComponent: () => import('../profile/clas/profile-clas.component').then((m) => m.ProfileClasComponent),
      },
      {
        path: 'transactions',
        title: 'Transactions',
        data: { embedded: true },
        loadComponent: () => import('../transactions/transactions-dashboard/transactions-dashboard.component').then((m) => m.TransactionsDashboardComponent),
      },
      {
        path: 'email-settings',
        title: 'Email settings',
        canActivate: [settingsSectionFragmentGuard],
        data: { embedded: true, section: ACCOUNT_SETTINGS_SECTIONS.EMAIL_SETTINGS },
        loadComponent: loadAccountSettings,
      },
      {
        path: 'password',
        title: 'Password',
        data: { embedded: true, section: ACCOUNT_SETTINGS_SECTIONS.PASSWORD },
        loadComponent: loadAccountSettings,
      },
      {
        path: 'developer-settings',
        title: 'Developer settings',
        data: { embedded: true, section: ACCOUNT_SETTINGS_SECTIONS.DEVELOPER_SETTINGS },
        loadComponent: loadAccountSettings,
      },
    ],
  },
];
