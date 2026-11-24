// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Company Lens — CDP companies (lfx-self-serve#2092): companies seen in crowd.dev activity that have no
 * company account. Their pages are read only by the CDP audience (LF staff, plus global org admins behind a server
 * switch); the audience itself is decided server-side and never reaches the browser.
 */

import { ORG_LENS_URL_ROOT } from './org-lens-url.constants';

/**
 * First URL segment of a CDP company page (`/company/{CDP id}/{page}`). It is the Company Lens root since the
 * `/org` → `/company` rename (#5064): a CDP id and a company segment are told apart by format, so `isOrgSlugSegment`
 * rejects the CDP id format and the CDP route only matches it.
 */
export const CDP_COMPANY_ROUTE_PREFIX = ORG_LENS_URL_ROOT;

/** A CDP id: the crowd.dev organization id as stored, a lowercase UUID. */
export const CDP_COMPANY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The CDP id shape in any letter case — what an organization slug may never be, since slugs are matched after lowercasing. */
export const CDP_COMPANY_ID_RESERVED_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valkey namespace of every CDP cache entry (`cdp-company:v1:<cdp id>:<section>`, `cdp-company:v1:search:<term>`). */
export const CDP_COMPANY_CACHE_NAMESPACE = 'cdp-company:v1';

/** Server deadline of one CDP search read, tuned from measurement. */
export const CDP_COMPANY_SEARCH_DEADLINE_MS = 1000;

/** How long one search term's rows stay cached. */
export const CDP_COMPANY_SEARCH_CACHE_TTL_SECONDS = 15 * 60;

/** Debounce of the org selector's CDP search request (at least 300 ms). */
export const CDP_COMPANY_SEARCH_DEBOUNCE_MS = 300;

/** Oldest CDP search list build that may be served, checked on every answer, cache hits included. */
export const CDP_COMPANY_SEARCH_MAX_LIST_AGE_MS = 48 * 60 * 60 * 1000;

/** Most CDP rows one search returns. */
export const CDP_COMPANY_SEARCH_MAX_ROWS = 20;

/** Longest search term the CDP search accepts; longer terms are refused with 400 (no company name needs more). */
export const CDP_COMPANY_SEARCH_MAX_CHARS = 100;

/** Sections a CDP company page can offer, in navigation order. */
export const CDP_COMPANY_SECTION_KEYS = ['dashboard', 'projects', 'profile', 'events', 'training', 'meetings', 'groups'] as const;

/** Sections behind the `OrgLensCdpMeetingsGroups` server flag and the `lf-staff` answer of the audience batch. */
export const CDP_COMPANY_STAFF_SECTION_KEYS = ['meetings', 'groups'] as const;

/** Refusal codes of the CDP company BFF. */
export const CDP_COMPANY_ERROR_CODES = {
  NOT_FOUND: 'NOT_FOUND',
  ROLE_GRANTS_UNAVAILABLE: 'ROLE_GRANTS_UNAVAILABLE',
  SECTION_OFF_BY_DESIGN: 'SECTION_OFF_BY_DESIGN',
  SECTION_NO_ACCESS: 'SECTION_NO_ACCESS',
  SECTION_COULD_NOT_VERIFY: 'SECTION_COULD_NOT_VERIFY',
  SECTION_COULD_NOT_LOAD: 'SECTION_COULD_NOT_LOAD',
} as const;

/** The reason every Company Lens section a CDP company cannot offer shows, greyed, in the navigation. */
export const CDP_COMPANY_OFF_BY_DESIGN_REASON = 'Not available for CDP companies';

/** Tag on a CDP row in the org selector. */
export const CDP_COMPANY_SEARCH_TAG = 'CDP';

/** Note in place of the org selector's CDP group when the CDP search missed its deadline, failed, or its list is too old. */
export const CDP_COMPANY_SEARCH_UNAVAILABLE_MESSAGE = 'CDP search unavailable';

/** The org selector's empty B2B list while a CDP group shows below it, scoped so it never contradicts CDP rows. */
export const CDP_COMPANY_SEARCH_NO_ACCOUNT_MATCH_MESSAGE = 'No companies with a company account found';

/** `res.locals` key under which `requireCdpAudience` stores the request's `CdpAudienceAnswer` (Meetings and Groups read `lfStaff` from it). */
export const CDP_AUDIENCE_LOCALS_KEY = 'cdpAudience';

/** `res.locals` key under which a CDP page or section handler records its `cdp_company_view` outcome before responding. */
export const CDP_VIEW_OUTCOME_LOCALS_KEY = 'cdpViewOutcome';

/**
 * HKDF info label of the key behind the `cdp_company_view` event's `viewer` pseudonym: derived from
 * `PCC_AUTH0_SECRET` under its own label, never the raw secret and never another feature's key.
 */
export const CDP_COMPANY_VIEW_VIEWER_HKDF_INFO = 'lfx-one:cdp-company-view:v1';
