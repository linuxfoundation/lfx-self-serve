// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

export const PROFILE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./manage-profile/profile-manage.component').then((m) => m.ProfileManageComponent),
  },
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
];
