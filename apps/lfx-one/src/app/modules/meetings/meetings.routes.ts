// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';
import { writerGuard } from '@shared/guards/writer.guard';

export const MEETING_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./meetings-dashboard/meetings-dashboard.component').then((m) => m.MeetingsDashboardComponent),
    canActivate: [authGuard],
    data: { preload: true, preloadDelay: 500 },
  },
  // The two deep-link routes below stay pointed at the pre-v2 wizard for as long as
  // `MEETING_V2_ENABLED_FLAG` is the gate, deliberately — the flag is read in the components that
  // raise the composer, and a lazy route cannot consult it without either a guard (out of scope) or
  // a shim component that renders one of two trees after the chunk has already been fetched. Sending
  // these URLs to the wizard unconditionally keeps production byte-identical to pre-v2 and leaves no
  // window in which a non-targeted user can reach v2. The known cost: a targeted tester who types
  // `/meetings/create` gets the wizard, not the composer, so testing v2 goes through the UI entry
  // points. Flipping them back to `MeetingComposerRouteComponent` is the last step of removing the
  // flag.
  {
    path: 'create',
    title: 'Create Meeting',
    loadComponent: () => import('./meeting-manage/meeting-manage.component').then((m) => m.MeetingManageComponent),
    canActivate: [authGuard, writerGuard],
    data: { writeFeature: 'meetings' },
  },
  {
    path: ':id/edit',
    title: 'Edit Meeting',
    loadComponent: () => import('./meeting-manage/meeting-manage.component').then((m) => m.MeetingManageComponent),
    canActivate: [authGuard, writerGuard],
    // entityScopedSlug: writerGuard resolves the authorization slug from the meeting itself on
    // this route. A route-data flag, not a path check, so a route rename/restructure
    // can't silently revert the guard to stale-context authorization.
    data: { writeFeature: 'meetings', entityScopedSlug: true },
  },
  {
    path: ':id/details',
    title: 'Meeting Details',
    loadComponent: () => import('./past-meeting-details/past-meeting-details.component').then((m) => m.PastMeetingDetailsComponent),
  },
];
