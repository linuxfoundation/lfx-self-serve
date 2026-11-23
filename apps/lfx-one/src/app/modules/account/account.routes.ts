// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { CanActivateFn, Route, Router, Routes } from '@angular/router';
import { ACCOUNT_SETTINGS_SECTIONS } from '@lfx-one/shared/constants';
import { accountPathForProfileTab } from '@lfx-one/shared/utils';

import { accountUnsavedChangesGuard } from '../../shared/guards/account-unsaved-changes.guard';

const loadAccountSettings = () => import('../settings/account-settings/account-settings.component').then((m) => m.AccountSettingsComponent);

/**
 * A full-page load of an old `/profile/settings#password` link reaches the server without its fragment, so the server sends
 * it here; the browser still has the fragment and moves on to the section's own page.
 */
const settingsSectionFragmentGuard: CanActivateFn = (route) => {
  const target = route.fragment ? accountPathForProfileTab('settings', route.fragment) : null;
  return target && !target.endsWith(`/${route.routeConfig?.path}`) ? inject(Router).createUrlTree([target], { queryParams: route.queryParams }) : true;
};

/** Every page asks before it is left with unsaved changes; a page with none goes straight through (#6070). */
const withUnsavedChangesGuard = (routes: Route[]): Route[] =>
  routes.map((route) => (route.loadComponent ? { ...route, canDeactivate: [...(route.canDeactivate ?? []), accountUnsavedChangesGuard] } : route));

/**
 * Account & Settings (#6067), behind the profile redesign flag. Each page reuses the Profile & Account hub tab it
 * replaces until its own redesign lands; the three settings pages share the settings page, one section each.
 */
export const ACCOUNT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('@app/layouts/account-layout/account-layout.component').then((m) => m.AccountLayoutComponent),
    children: withUnsavedChangesGuard([
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
      // Linux.com email still sits at the foot of Identities, which feeds it the verified addresses, until #6075. A function
      // redirect, so a Flow C return keeps its query.
      { path: 'linux-email', redirectTo: ({ queryParams }) => inject(Router).createUrlTree(['/account/identities'], { queryParams }) },
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
    ]),
  },
];
