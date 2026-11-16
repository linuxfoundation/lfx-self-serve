// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';
import { meetingsV2Guard } from '@shared/guards/meetings-v2.guard';
import { writerGuard } from '@shared/guards/writer.guard';

export const MEETING_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./meetings-entry/meetings-entry.component').then((m) => m.MeetingsEntryComponent),
    canActivate: [authGuard],
    data: { preload: true, preloadDelay: 500 },
  },
  // The two deep-link routes below are paired by path: the first entry of each pair opens the meetings
  // v2 composer and only matches while `MEETING_V2_ENABLED_FLAG` is on (`meetingsV2Guard`, a CanMatch);
  // when it doesn't match, the router falls through to the second entry, the pre-v2 wizard. So the
  // flag alone decides which one a bookmark or emailed link opens, in both directions, with no deploy.
  // On the server the composer entry always matches (LaunchDarkly is browser-only) and renders
  // nothing, so the browser run makes the real choice — see `meetingsV2Guard`.
  // Both entries carry the same title, guards and data, so authorization never depends on the flag.
  // Retiring the wizard means dropping each pair's second entry and the guard.
  {
    path: 'create',
    title: 'Create Meeting',
    canMatch: [meetingsV2Guard],
    loadComponent: () => import('./meeting-composer/meeting-composer-route.component').then((m) => m.MeetingComposerRouteComponent),
    canActivate: [authGuard, writerGuard],
    data: { writeFeature: 'meetings' },
  },
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
    canMatch: [meetingsV2Guard],
    loadComponent: () => import('./meeting-composer/meeting-composer-route.component').then((m) => m.MeetingComposerRouteComponent),
    canActivate: [authGuard, writerGuard],
    // entityScopedSlug: writerGuard resolves the authorization slug from the meeting itself on
    // this route. A route-data flag, not a path check, so a route rename/restructure
    // can't silently revert the guard to stale-context authorization.
    data: { writeFeature: 'meetings', entityScopedSlug: true },
  },
  {
    path: ':id/edit',
    title: 'Edit Meeting',
    loadComponent: () => import('./meeting-manage/meeting-manage.component').then((m) => m.MeetingManageComponent),
    canActivate: [authGuard, writerGuard],
    data: { writeFeature: 'meetings', entityScopedSlug: true },
  },
  {
    path: ':id/details',
    title: 'Meeting Details',
    loadComponent: () => import('./past-meeting-details/past-meeting-details.component').then((m) => m.PastMeetingDetailsComponent),
  },
];
