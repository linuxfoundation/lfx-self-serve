// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Warehouse row shapes for the Org Lens Code Contributions backend service. They live in the shared package
// because AGENTS.md prohibits module-level interfaces inside apps/lfx-one/; they are NOT part of the wire contract.

import type { ContributionSource } from './org-contributions.interface';

/** KPI strip aggregate; under metric `code`, `COMMITS` carries the code-contribution activity total. */
export interface ContributionsKpiRow {
  PROJECTS_WITH_ACTIVITY: number;
  REPOSITORIES: number;
  COMMITS: number;
}

/** One Repositories table row, with the window's total row count. */
export interface ContributionsRepoRow {
  REPOSITORY_URL: string;
  REPOSITORY_PATH: string;
  PROJECT_ID: string | null;
  PROJECT_NAME: string | null;
  PROJECT_SLUG: string | null;
  PROJECT_LOGO: string | null;
  SOURCE: ContributionSource;
  COMMITS: number;
  FIRST_COMMIT_TS: Date | string | null;
  LAST_COMMIT_TS: Date | string | null;
  TOTAL_RECORDS: number;
}

/** One Commits feed row, with the window's total row count. */
export interface ContributionsCommitRow {
  COMMIT_ID: string;
  MEMBER_ID: string | null;
  PERSON_KEY: string | null;
  PROJECT_NAME: string | null;
  MEMBER_DISPLAY_NAME: string | null;
  MEMBER_LOGO: string | null;
  GITHUB_USERNAME: string | null;
  SOURCE: ContributionSource;
  ACTIVITY_TS: Date | string | null;
  COMMIT_MESSAGE: string | null;
  COMMIT_URL: string | null;
  TOTAL_RECORDS: number;
}

/** Project filter option with its count in the window. */
export interface ContributionsProjectOptionRow {
  PROJECT_ID: string;
  PROJECT_SLUG: string | null;
  PROJECT_NAME: string | null;
  FOUNDATION_ID: string | null;
  COMMITS: number;
}

/** Foundation filter option in the window and project type. */
export interface ContributionsFoundationOptionRow {
  FOUNDATION_ID: string;
  FOUNDATION_NAME: string;
}

/** Employee filter option with its count in the window. */
export interface ContributionsEmployeeOptionRow {
  MEMBER_ID: string;
  MEMBER_DISPLAY_NAME: string | null;
  COMMITS: number;
}

/** The raw warehouse reads for one Code Contributions request, as cached; mapped after every read. */
export interface ContributionsRaw {
  kpiRows: ContributionsKpiRow[];
  repoRows: ContributionsRepoRow[];
  commitRows: ContributionsCommitRow[];
  foundationOptionRows: ContributionsFoundationOptionRow[];
  projectOptionRows: ContributionsProjectOptionRow[];
  employeeOptionRows: ContributionsEmployeeOptionRow[];
  /** Exclude team members was asked but the flag column is missing: the rows include team members, and the payload is never cached. */
  teamMembersUnavailable?: true;
  /**
   * Exclude team members was asked but lf-dbt's non-team First Commit column is missing: First Commit includes team
   * members while every count still excludes them, so no counts note is shown, and the payload is never cached.
   */
  firstCommitUnavailable?: true;
}
