// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensTimeRange } from './org-lens-time-range.interface';

/**
 * Who an Events number is credited to ("Counted by", lfx-self-serve#4598, #5158): `verified` (the default) — people who
 * registered or spoke with one of the company's own addresses, or current employees on the roster; `company_email` —
 * people who registered with one of the company's own addresses; `account` — registrations Salesforce credits to the
 * account; `all` — everyone related to the company by any of those, including people who only named the company on
 * their registration (the widest view).
 */
export type OrgEventsAttribution = 'verified' | 'company_email' | 'account' | 'all';

/**
 * What an Events attendee count counts ("Count"): `all` — everyone who registered or attended; `registered` — everyone who
 * registered; `attended` — only those who attended (ended events only).
 */
export type OrgEventsParticipation = 'registered' | 'attended' | 'all';

/** Which events the Events page lists ("Show"): events with this company's activity, or every event in its foundations. */
export type OrgEventsScope = 'activity' | 'all';

/** Column-name suffix of an attribution in the Events warehouse tables (`REGISTERED_COUNT_<SUFFIX>`, `HAS_FOOTPRINT_<SUFFIX>`, `IS_COUNTED_REGISTERED_<SUFFIX>`, `ALL_COUNT_<SUFFIX>`, ...). */
export type OrgEventsAttributionColumnSuffix = 'VERIFIED' | 'COMPANY_EMAIL' | 'ACCOUNT' | 'ALL';

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
