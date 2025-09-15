// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

export const MEETING_ROUTES: Routes = [
  {
    path: 'not-found',
    loadComponent: () => import('./meeting-not-found/meeting-not-found.component').then((m) => m.MeetingNotFoundComponent),
  },
  {
    path: ':id',
    loadComponent: () => import('./meeting-join/meeting-join.component').then((m) => m.MeetingJoinComponent),
  },
];
