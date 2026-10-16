// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Project Lens → Participating Organizations (#2091). Time-range options are shared with
// Org Lens → Code Contributions (CONTRIBUTIONS_DATE_RANGE_OPTIONS / CONTRIBUTIONS_DEFAULT_DATE_RANGE).

import type { MembershipTierClass } from '../interfaces/org-lens.interface';
import type {
  ProjectParticipatingOrgChangeTone,
  ProjectParticipatingOrgsPage,
  ProjectParticipatingOrgsSortDirection,
  ProjectParticipatingOrgsSortField,
} from '../interfaces/project-participating-orgs.interface';

export const PROJECT_PARTICIPATING_ORGS_SEGMENTS = ['all', 'members', 'non_members'] as const;

/** `*_change` sort on the % change against the previous window; rows without one (All Time, new) sort last. */
export const PROJECT_PARTICIPATING_ORGS_SORT_FIELDS = ['name', 'tier', 'commits', 'commits_change', 'contributors', 'contributors_change'] as const;

export const PROJECT_PARTICIPATING_ORGS_DEFAULT_SORT: ProjectParticipatingOrgsSortField = 'commits';

export const PROJECT_PARTICIPATING_ORGS_DEFAULT_SORT_DIR: ProjectParticipatingOrgsSortDirection = 'desc';

export const PROJECT_PARTICIPATING_ORGS_SORT_DIRECTIONS: readonly ProjectParticipatingOrgsSortDirection[] = ['asc', 'desc'];

/**
 * Shape a `:slug` must have before the gate looks the project up (lowercase kebab-case, ≤64 chars).
 * Same rule as the other features' project-slug patterns; kept per feature like they are.
 */
export const PROJECT_PARTICIPATING_ORGS_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** CSV export columns, in order. */
export const PROJECT_PARTICIPATING_ORGS_EXPORT_CSV_HEADER: readonly string[] = [
  'Organization',
  'Membership',
  'Tier',
  'Unidentified',
  'Commits',
  'Commits (previous period)',
  'Contributors',
  'Contributors (previous period)',
];

export const PROJECT_PARTICIPATING_ORGS_PAGE_SIZE = 10;

export const PROJECT_PARTICIPATING_ORGS_PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50] as const;

/** Server clamp for `pageSize`. */
export const PROJECT_PARTICIPATING_ORGS_MAX_PAGE_SIZE = 100;

/** Server clamp for `search`; longer input is rejected with 400. */
export const PROJECT_PARTICIPATING_ORGS_MAX_SEARCH_LENGTH = 100;

/**
 * CSV export row cap. The largest project lists about 34k companies over All Time, so the cap
 * covers every project today; a capped export sets `X-Export-Truncated: true`.
 */
export const PROJECT_PARTICIPATING_ORGS_EXPORT_MAX_ROWS = 50_000;

/** Tooltip on a member name the viewer cannot open in Org Lens. */
export const PROJECT_PARTICIPATING_ORGS_NO_ORG_LENS_ACCESS_TOOLTIP = "Ask the company's admins or LF staff for access.";

/** Query param carrying the comma-separated member account ids of the shown page for the Org Lens links read. */
export const PROJECT_PARTICIPATING_ORGS_LINKS_ACCOUNT_IDS_PARAM = 'accountIds';

/** 503 copy when the authorizer cannot decide the project gate. */
export const PROJECT_PARTICIPATING_ORGS_UNAVAILABLE_MESSAGE = 'Unable to verify access to this project right now. Please try again.';

/** Response header the export sets to `true` when it stopped at `PROJECT_PARTICIPATING_ORGS_EXPORT_MAX_ROWS`. */
export const PROJECT_PARTICIPATING_ORGS_EXPORT_TRUNCATED_HEADER = 'X-Export-Truncated';

/** Download name when the export response carries no `Content-Disposition` filename. */
export const PROJECT_PARTICIPATING_ORGS_EXPORT_FALLBACK_FILENAME = 'participating-orgs.csv';

export const PROJECT_PARTICIPATING_ORGS_EXPORT_EMPTY_MESSAGE = 'No organizations match these filters, so there is nothing to export.';

export const PROJECT_PARTICIPATING_ORGS_EXPORT_ERROR_MESSAGE = 'Unable to export participating organizations. Please try again.';

export const PROJECT_PARTICIPATING_ORGS_EXPORT_TRUNCATED_MESSAGE = `The export holds only the first ${PROJECT_PARTICIPATING_ORGS_EXPORT_MAX_ROWS.toLocaleString('en-US')} organizations.`;

export const PROJECT_PARTICIPATING_ORGS_SEARCH_DEBOUNCE_MS = 300;

/** Table value before the first page arrives and after a failed read. */
export const EMPTY_PROJECT_PARTICIPATING_ORGS_PAGE: ProjectParticipatingOrgsPage = { rows: [], totalRecords: 0, foundationSlug: null };

/** Member badge colours for the tiers the design calls out; every other tier uses `..._DEFAULT_CLASS`. */
export const PROJECT_PARTICIPATING_ORGS_TIER_BADGE_CLASSES: Partial<Record<MembershipTierClass, string>> = {
  Platinum: 'bg-emerald-100 text-emerald-800',
  Gold: 'bg-amber-100 text-amber-800',
  Silver: 'bg-gray-100 text-gray-700',
};

export const PROJECT_PARTICIPATING_ORGS_TIER_BADGE_DEFAULT_CLASS = 'bg-slate-100 text-slate-700';

/** Text colour of a Commits / Contributors change cell. */
export const PROJECT_PARTICIPATING_ORGS_CHANGE_TONE_CLASSES: Record<ProjectParticipatingOrgChangeTone, string> = {
  positive: 'text-emerald-700',
  negative: 'text-red-600',
  neutral: 'text-gray-500',
  new: 'text-emerald-700',
  none: 'text-gray-400',
};
