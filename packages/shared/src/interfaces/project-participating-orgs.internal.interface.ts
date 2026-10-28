// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Project Lens → Participating Organizations (#2091): Snowflake query-row shapes read by the BFF
// only. The client contract lives in `project-participating-orgs.interface.ts`.

/** One `PROJECT_PARTICIPATING_ORGS` row as the BFF selects it (uppercase Snowflake columns). */
export interface ProjectParticipatingOrgsRow {
  PARTICIPANT_KEY: string | null;
  ACCOUNT_ID: string | null;
  PARTICIPANT_NAME: string | null;
  PARTICIPANT_LOGO_URL: string | null;
  IS_UNIDENTIFIED: boolean | null;
  IS_MEMBER: boolean | null;
  MEMBERSHIP_TIER_CLASS: string | null;
  /** Selected for the `tier` sort; not mapped onto the API row. */
  TIER_RANK: number | null;
  COMMITS: number | null;
  COMMITS_PREV: number | null;
  COMMITS_CHANGE: number | string | null;
  CONTRIBUTORS: number | null;
  CONTRIBUTORS_PREV: number | null;
  CONTRIBUTORS_CHANGE: number | string | null;
}

/**
 * One row of the list query: the filtered total and foundation slug on every row, plus the page's
 * columns when `IS_PAGE_ROW` (a page that selected nothing still returns the single totals row).
 */
export interface ProjectParticipatingOrgsPageRow extends ProjectParticipatingOrgsRow {
  TOTAL_RECORDS: number | null;
  /** From the unfiltered scope, so it survives a search that matches nothing. */
  FOUNDATION_SLUG_TOTAL: string | null;
  /** The page row's own foundation slug; the response uses `FOUNDATION_SLUG_TOTAL`. */
  FOUNDATION_SLUG: string | null;
  IS_PAGE_ROW: boolean | null;
}

/** One `PROJECT_PARTICIPATING_ORGS_SUMMARY` row as the BFF selects it. */
export interface ProjectParticipatingOrgsSummaryRow {
  PROJECT_SLUG: string;
  FOUNDATION_SLUG: string | null;
  FOUNDATION_NAME: string | null;
  AS_OF_DATE: Date | string | null;
  ORGS_COUNT: number | null;
  MEMBERS_COUNT: number | null;
  CONTRIBUTING_MEMBERS_COUNT: number | null;
  NON_MEMBERS_COUNT: number | null;
  UNIDENTIFIED_COUNT: number | null;
  MEMBER_COMMITS: number | null;
  COMPANY_COMMITS: number | null;
  ALL_COMMITS: number | null;
  MEMBER_COMMIT_SHARE_OF_COMPANY_COMMITS: number | string | null;
}
