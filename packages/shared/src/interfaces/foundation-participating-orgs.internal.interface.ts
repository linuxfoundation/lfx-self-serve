// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Foundation Lens → Participating Companies (#5707): Snowflake query-row shapes read by the BFF only. The client contract
// lives in `foundation-participating-orgs.interface.ts`; the table is the project page's `PROJECT_PARTICIPATING_ORGS`.

/** A foundation-level company row: the foundation project's row of the list, with the count of its other projects with commits or contributors. */
export interface FoundationParticipatingOrgsCompanyRow {
  FOUNDATION_NAME: string | null;
  AS_OF_DATE: Date | string | null;
  PARTICIPANT_KEY: string | null;
  ACCOUNT_ID: string | null;
  PARTICIPANT_NAME: string | null;
  PARTICIPANT_LOGO_URL: string | null;
  IS_MEMBER: boolean | null;
  MEMBERSHIP_TIER_CLASS: string | null;
  PROJECTS_INVOLVED: number | null;
  COMMITS: number | null;
  COMMITS_CHANGE: number | string | null;
  CONTRIBUTORS: number | null;
  CONTRIBUTORS_CHANGE: number | string | null;
}

/** One project of a foundation with its commits in the range (the foundation's own project is not a row). */
export interface FoundationParticipatingOrgsProjectRow {
  PROJECT_SLUG: string | null;
  PROJECT_NAME: string | null;
  COMMITS: number | null;
}

/** One company's figures in one project. */
export interface FoundationParticipatingOrgsLineRow {
  PARTICIPANT_KEY: string | null;
  PROJECT_SLUG: string | null;
  COMMITS: number | null;
  COMMITS_CHANGE: number | string | null;
  CONTRIBUTORS: number | null;
  CONTRIBUTORS_CHANGE: number | string | null;
}
