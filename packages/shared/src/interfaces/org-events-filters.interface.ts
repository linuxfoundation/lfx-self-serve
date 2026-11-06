// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensTimeRange } from './org-lens-time-range.interface';

/**
 * Who an Events number is credited to ("Counted by", lfx-self-serve#4598, #5158, #5315): `verified` (Employee match, the
 * default) — people who registered or spoke with a company email address on record, or whose LF account matches someone on
 * the company roster; `self_reported` (Self-reported only) — people linked only because they named the organization on
 * their registration or talk submission; `all` — everyone linked to the organization (Employee match plus Self-reported only).
 */
export type OrgEventsAttribution = 'verified' | 'self_reported' | 'all';

/**
 * What an Events attendee count counts ("Count"): `all` — everyone who registered or attended; `registered` — everyone who
 * registered; `attended` — only those who attended (ended events only).
 */
export type OrgEventsParticipation = 'registered' | 'attended' | 'all';

/** Which events the Events page lists ("Show"): events with this company's activity, or every event in its foundations. */
export type OrgEventsScope = 'activity' | 'all';

/** Column-name suffix of an attribution in the Events warehouse tables (`REGISTERED_COUNT_<SUFFIX>`, `HAS_FOOTPRINT_<SUFFIX>`, `IS_COUNTED_REGISTERED_<SUFFIX>`, `ALL_COUNT_<SUFFIX>`, ...). */
export type OrgEventsAttributionColumnSuffix = 'VERIFIED' | 'SELF_REPORTED' | 'ALL';

/** "Counted by" dropdown option — label rendered as-is. */
export interface OrgEventsAttributionOption {
  label: string;
  value: OrgEventsAttribution;
}

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
  attribution: OrgEventsAttribution;
  participation: OrgEventsParticipation;
  /** Events page only; ignored elsewhere. */
  scope: OrgEventsScope;
  /** Foundation id, `''` for All Foundations. */
  foundation: string;
  range: OrgLensTimeRange;
}
