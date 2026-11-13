// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Foundation Lens → Participating Companies (#5697). Ranges, sorting, paging, tier badges and change colours are the
// project page's, so the two pages read as one product.

import type { FoundationParticipatingOrgsPage, FoundationParticipatingOrgsRange } from '../interfaces/foundation-participating-orgs.interface';

export const FOUNDATION_PARTICIPATING_ORGS_RANGES = ['12mo', '6mo', '90d', 'all'] as const;

export const FOUNDATION_PARTICIPATING_ORGS_DEFAULT_RANGE: FoundationParticipatingOrgsRange = '12mo';

export const FOUNDATION_PARTICIPATING_ORGS_RANGE_OPTIONS: readonly { label: string; value: FoundationParticipatingOrgsRange }[] = [
  { label: 'Past 12 Months', value: '12mo' },
  { label: 'Past 6 Months', value: '6mo' },
  { label: 'Past 90 Days', value: '90d' },
  { label: 'All Time', value: 'all' },
];

/** Label used in card sublines and chips, per range. */
export const FOUNDATION_PARTICIPATING_ORGS_RANGE_LABELS: Record<FoundationParticipatingOrgsRange, string> = {
  '12mo': 'Past 12 Months',
  '6mo': 'Past 6 Months',
  '90d': 'Past 90 Days',
  all: 'All Time',
};

/** A company active in more than this many projects shows its top N, an "Other N projects" row, a filter and Show all. */
export const FOUNDATION_PARTICIPATING_ORGS_BREAKDOWN_TOP_N = 10;

export const FOUNDATION_PARTICIPATING_ORGS_PAGE_SIZE = 10;

export const FOUNDATION_PARTICIPATING_ORGS_MAX_PAGE_SIZE = 100;

export const FOUNDATION_PARTICIPATING_ORGS_MAX_SEARCH_LENGTH = 100;

export const FOUNDATION_PARTICIPATING_ORGS_SEARCH_DEBOUNCE_MS = 300;

/** Slug shape accepted by the BFF (lowercase kebab-case, at most 64 characters). */
export const FOUNDATION_PARTICIPATING_ORGS_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export const FOUNDATION_PARTICIPATING_ORGS_EXPORT_KINDS = ['summary', 'by-project'] as const;

export const FOUNDATION_PARTICIPATING_ORGS_EXPORT_MAX_ROWS = 100_000;

export const FOUNDATION_PARTICIPATING_ORGS_EXPORT_TRUNCATED_HEADER = 'X-Export-Truncated';

export const FOUNDATION_PARTICIPATING_ORGS_EXPORT_SUMMARY_HEADER: readonly string[] = [
  'Company',
  'Foundation membership',
  'Tier',
  'Other LF membership',
  'Projects involved',
  'Commits',
  'Commits change',
  'Contributors',
  'Contributors change',
];

export const FOUNDATION_PARTICIPATING_ORGS_EXPORT_BY_PROJECT_HEADER: readonly string[] = [
  'Company',
  'Foundation membership',
  'Tier',
  'Project',
  'Maturity',
  'Commits',
  'Contributors',
  'Share of company commits',
];

export const FOUNDATION_PARTICIPATING_ORGS_EXPORT_EMPTY_MESSAGE = 'No companies match these filters, so there is nothing to export.';

export const FOUNDATION_PARTICIPATING_ORGS_EXPORT_ERROR_MESSAGE = 'Unable to export participating companies. Please try again.';

export const FOUNDATION_PARTICIPATING_ORGS_EXPORT_TRUNCATED_MESSAGE = `The export holds only the first ${FOUNDATION_PARTICIPATING_ORGS_EXPORT_MAX_ROWS.toLocaleString('en-US')} rows.`;

export const FOUNDATION_PARTICIPATING_ORGS_UNAVAILABLE_MESSAGE = 'Unable to verify access to this foundation right now. Please try again.';

/** Member Commit Share tooltip. */
export const FOUNDATION_PARTICIPATING_ORGS_COMMIT_SHARE_TOOLTIP =
  'Share of commits in the selected period made by people from member companies. Foundation totals add up every project; a contributor active in several projects is counted once.';

export const EMPTY_FOUNDATION_PARTICIPATING_ORGS_PAGE: FoundationParticipatingOrgsPage = { rows: [], totalRecords: 0 };
