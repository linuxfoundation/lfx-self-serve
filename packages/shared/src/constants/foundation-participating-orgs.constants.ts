// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Foundation Lens → Participating Companies (#5697). Sorting, segments and tier badges reuse the project page's constants;
// the ranges are the warehouse's `time_range` values (the same four as the project page), the paging limits and the change
// colours (darker, for contrast at 14px) are this page's own.

import type {
  FoundationParticipatingOrgChangeTone,
  FoundationParticipatingOrgsPage,
  FoundationParticipatingOrgsRange,
} from '../interfaces/foundation-participating-orgs.interface';

export const FOUNDATION_PARTICIPATING_ORGS_RANGES = ['12mo', '90d', '30d', 'all'] as const;

export const FOUNDATION_PARTICIPATING_ORGS_DEFAULT_RANGE: FoundationParticipatingOrgsRange = '12mo';

export const FOUNDATION_PARTICIPATING_ORGS_RANGE_OPTIONS: readonly { label: string; value: FoundationParticipatingOrgsRange }[] = [
  { label: 'Past 12 Months', value: '12mo' },
  { label: 'Past 90 Days', value: '90d' },
  { label: 'Past 30 Days', value: '30d' },
  { label: 'All Time', value: 'all' },
];

/** Label used in card sublines and chips, per range. */
export const FOUNDATION_PARTICIPATING_ORGS_RANGE_LABELS: Record<FoundationParticipatingOrgsRange, string> = {
  '12mo': 'Past 12 Months',
  '90d': 'Past 90 Days',
  '30d': 'Past 30 Days',
  all: 'All Time',
};

/** Group label for projects with no maturity stage in the project picker. */
export const FOUNDATION_PARTICIPATING_ORGS_NO_MATURITY_LABEL = 'Projects';

/** A company active in more than this many projects shows its top N, an "Other N projects" row, a filter and Show all. */
export const FOUNDATION_PARTICIPATING_ORGS_BREAKDOWN_TOP_N = 10;

export const FOUNDATION_PARTICIPATING_ORGS_PAGE_SIZE = 10;

export const FOUNDATION_PARTICIPATING_ORGS_MAX_PAGE_SIZE = 100;

export const FOUNDATION_PARTICIPATING_ORGS_MAX_SEARCH_LENGTH = 100;

export const FOUNDATION_PARTICIPATING_ORGS_SEARCH_DEBOUNCE_MS = 300;

/** Slug shape accepted by the BFF (lowercase kebab-case, at most 64 characters). */
/** Stat card sub-line colour: the shared card's default gray-400 is under 4.5:1 on white at 12px. */
export const FOUNDATION_PARTICIPATING_ORGS_STAT_SUBLINE_CLASS = 'text-gray-600';

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

/**
 * Text colour of a Commits / Contributors change cell. Darker than the project page's for the neutral and no-comparison tones,
 * because this page shows them at 14px and they must reach 4.5:1 on white; the sign or the dash, never colour, carries the meaning.
 */
export const FOUNDATION_PARTICIPATING_ORGS_CHANGE_TONE_CLASSES: Record<FoundationParticipatingOrgChangeTone, string> = {
  positive: 'text-emerald-700',
  negative: 'text-red-600',
  neutral: 'text-gray-600',
  new: 'text-emerald-700',
  none: 'text-gray-600',
};
