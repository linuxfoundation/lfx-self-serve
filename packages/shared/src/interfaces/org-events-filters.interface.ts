// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensTimeRange } from './org-lens-time-range.interface';

/**
 * What an Events attendee count counts ("Count"): `all` — everyone who registered or attended; `registered` — everyone who
 * registered; `attended` — only those who attended (ended events only).
 */
export type OrgEventsParticipation = 'registered' | 'attended' | 'all';

/** Which events the Events page lists ("Show"): events with this company's activity, or every event in its foundations. */
export type OrgEventsScope = 'activity' | 'all';

/** "Count" dropdown option — label rendered as-is. */
export interface OrgEventsParticipationOption {
  label: string;
  value: OrgEventsParticipation;
}

/** "Show" dropdown option — label rendered as-is. */
export interface OrgEventsScopeOption {
  label: string;
  value: OrgEventsScope;
}

/** The filters every Org Lens Events surface reads: Overview (pinned to the defaults), People → Event Attendees and the Events page. */
export interface OrgEventsFilters {
  participation: OrgEventsParticipation;
  /** Events page only; ignored elsewhere. */
  scope: OrgEventsScope;
  /** Foundation id, `''` for All Foundations. */
  foundation: string;
  range: OrgLensTimeRange;
}
