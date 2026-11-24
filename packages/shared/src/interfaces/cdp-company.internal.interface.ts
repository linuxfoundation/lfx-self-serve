// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Company Lens — CDP companies (lfx-self-serve#2092): warehouse row shapes the BFF selects from
// `PLATINUM_LFX_ONE.CDP_COMPANY_*` (contracts/warehouse-tables.md) and the server-side audience answer.
// Read by the BFF only; the client contract lives in `cdp-company.interface.ts`.

import type { CdpCompanyErrorCode, CdpCompanyItem } from './cdp-company.interface';

/**
 * The strict CDP audience answer for one request (FR-010, FR-011): `in` admits the caller to every CDP
 * read, `out` is answered as an unknown address, `unverifiable` as "could not verify". `lfStaff` is the
 * `team:lf-staff#member` answer of the same batch, read by Meetings and Groups (DR-044); false unless `in`.
 */
export interface CdpAudienceAnswer {
  status: 'in' | 'out' | 'unverifiable';
  lfStaff: boolean;
}

/** The `outcome` of one `cdp_company_view` log event (FR-015). */
export type CdpViewOutcome = 'ok' | 'redirect' | 'low_activity' | 'not_found' | 'off_by_design' | 'no_access' | 'could_not_verify' | 'could_not_load' | 'error';

/** What a CDP company service read answers: the value, or the refusal the controller sends as `{ code }`. */
export type CdpCompanyServiceResult<T> =
  | { ok: true; value: T; outcome: CdpViewOutcome }
  | { ok: false; status: 403 | 404 | 503; code: CdpCompanyErrorCode; outcome: CdpViewOutcome };

/** One row of the CDP search read: the list's build metadata on every row, the matched company's columns when any (FR-022: no counts, domains, people or project columns). */
export interface CdpCompanySearchRow {
  CDP_ID: string | null;
  NAME: string | null;
  LOGO_URL: string | null;
  BUILT_AT: string | Date | null;
}

/** The cached answer of one search term: the rows with the list's build time, re-checked against the 48-hour limit on every hit. */
export interface CdpCompanySearchCacheEntry {
  items: CdpCompanyItem[];
  /** ISO timestamp of the list build the rows came from; null only when the list is empty (no build to serve). */
  builtAt: string | null;
}

/** One `CDP_COMPANY_PROFILE` row. */
export interface CdpCompanyProfileRow {
  NAME: string | null;
  LOGO_URL: string | null;
  TOP_PROJECT_SLUG: string | null;
  TOP_PROJECT_NAME: string | null;
  LAST_ACTIVE_MONTH: string | Date | null;
  IS_SEARCHABLE: boolean | null;
  IS_ADDRESSABLE: boolean | null;
  /** Any counted activity in the last 730 days; tells the two low-activity states apart (FR-034). */
  HAS_ACTIVITY_730D: boolean | null;
  CONTRIBUTORS_730D: number | null;
  ACTIVITIES_730D: number | null;
}

/** One `CDP_COMPANY_REDIRECTS` row. */
export interface CdpCompanyRedirectRow {
  TARGET_KIND: string | null;
  TARGET_ID: string | null;
}

/** One `CDP_COMPANY_PROJECTS` row. The slug keys the per-row `project#viewer` check and never reaches the wire. */
export interface CdpCompanyProjectsRow {
  PROJECT_SLUG: string | null;
  PROJECT_NAME: string | null;
  CONTRIBUTORS: number | null;
  ACTIVITIES: number | null;
}

/** One `CDP_COMPANY_EVENTS` row. */
export interface CdpCompanyEventsRow {
  EVENT_NAME: string | null;
  EVENT_DATE: string | Date | null;
  ATTENDEES: number | null;
}

/** One `CDP_COMPANY_TRAINING` row. */
export interface CdpCompanyTrainingRow {
  ENROLLMENTS: number | null;
  CERTIFICATIONS: number | null;
}

/** One `CDP_COMPANY_MEETINGS` row. */
export interface CdpCompanyMeetingsRow {
  PROJECT_NAME: string | null;
  MEETING_TYPE: string | null;
  ATTENDANCE: number | null;
}

/** One `CDP_COMPANY_GROUPS` row. */
export interface CdpCompanyGroupsRow {
  COMMITTEE_NAME: string | null;
  PROJECT_NAME: string | null;
  ACTIVE_SEATS: number | null;
}

/** One `CDP_COMPANY_PROFILE` row read by the Participating Companies links (FR-040). */
export interface CdpCompanyAddressableRow {
  CDP_ID: string | null;
}

/** The cached, caller-independent profile of one CDP id: the profile row, or why there is none. */
export type CdpCompanyProfileCacheEntry =
  | { kind: 'profile'; profile: CdpCompanyCachedProfile }
  | { kind: 'redirect'; targetKind: 'cdp' | 'b2b'; targetId: string }
  | { kind: 'unknown' };

/** The profile columns a page needs, unfiltered; the top project is filtered per caller after the cache (FR-030). */
export interface CdpCompanyCachedProfile {
  name: string;
  logoUrl: string | null;
  topProjectSlug: string | null;
  topProjectName: string | null;
  lastActiveMonth: string | null;
  isSearchable: boolean;
  hasActivity730d: boolean;
  contributors730d: number | null;
  activities730d: number | null;
}

/** Cached Projects rows, slugs kept for the per-caller `project#viewer` filter applied after the cache. */
export interface CdpCompanyCachedProjectRow {
  projectSlug: string;
  projectName: string;
  contributors: number;
  activities: number;
}
