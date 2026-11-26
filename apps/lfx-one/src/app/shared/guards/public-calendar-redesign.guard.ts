// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, makeStateKey } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { MeetingPageRedesignDecision } from '@lfx-one/shared/interfaces';

import { authenticatedMatchGuard } from './authenticated-match.guard';
import { matchMeetingsRedesign } from './meeting-page-redesign.guard';

/** The page the server rendered for a `/projects/:projectSlug/calendar` URL; read once by the browser's first match. */
export const PUBLIC_CALENDAR_REDESIGN_KEY = makeStateKey<MeetingPageRedesignDecision>('publicCalendarRedesign');

/**
 * CanMatch guard choosing the redesigned public project calendar over the legacy one, which follows it unguarded.
 * @description Decides like `meetingPageRedesignGuard`, keyed by the project slug, so both public pages follow one rollout.
 * Either page's own filter and view changes keep the page that is showing.
 */
export const publicCalendarRedesignGuard: CanMatchFn = (route, segments) => {
  const slug = segments[1]?.path ?? '';
  let shown = inject(Router).routerState.snapshot.root;
  while (shown.firstChild) shown = shown.firstChild;
  if (shown.routeConfig?.path === route.path && shown.paramMap.get('projectSlug') === slug) return shown.routeConfig === route;
  return matchMeetingsRedesign(PUBLIC_CALENDAR_REDESIGN_KEY, slug, true, authenticatedMatchGuard(route, segments) as boolean);
};
