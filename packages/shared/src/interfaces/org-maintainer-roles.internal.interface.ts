// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Server-internal shapes for reads of the ANALYTICS.PLATINUM_LFX_ONE maintainer roles tables (lfx-self-serve#4482,
// lfx-self-serve#4605). A role is one (person, Insights project) pair.
// They live in the shared package because AGENTS.md prohibits module-level interfaces inside
// apps/lfx-one/; they are NOT part of the wire contract consumed by the frontend.

/** The overlap predicate for maintainer roles and the values its placeholders bind, in order. */
export interface OrgMaintainerRoleOverlap {
  sql: string;
  binds: number[];
}

/**
 * The maintainer roles tables and the Overview trend view over ORG_MAINTAINER_ROLES (lfx-self-serve#4694); a read names
 * the one it may find missing. PROJECT_MAINTAINER_ROLES holds every role, with or without an account; the
 * ORG_LENS_PROJECT_* series are Project Detail's sparkline per account and project.
 */
export type OrgMaintainerRolesTable =
  | 'ORG_MAINTAINER_ROLES'
  | 'ORG_OVERVIEW_MAINTAINER_ROLES_TREND'
  | 'PROJECT_MAINTAINER_ROLES'
  | 'ORG_LENS_PROJECT_MAINTAINER_ROLES_MONTHLY'
  | 'ORG_LENS_PROJECT_MAINTAINER_ROLES_LIFETIME';

/** A count of distinct maintainer roles. */
export interface OrgMaintainerRolesCountRow {
  MAINTAINER_ROLES: number | null;
}

/** A count of distinct maintainer roles on one project. */
export interface OrgProjectMaintainerRolesCountRow extends OrgMaintainerRolesCountRow {
  PROJECT_ID: string;
}

/** One role of the account overlapping the Contributors range — the tile counts these, the badges map them. */
export interface OrgContributorMaintainerRoleRow {
  PERSON_KEY: string;
  MEMBER_ID: string;
  SEGMENT_ID: string;
  PROJECT_ID: string;
}

/** A project in which one person holds a role overlapping the range (All Employees row and person drawer). */
export interface OrgPersonMaintainerRoleProjectRow {
  PROJECT_ID: string;
}

/** One maintainer of the account on a Projects-page project, keyed by the catalog's lowercased Insights slug. */
export interface OrgProjectMaintainerRoleRow {
  INSIGHTS_PROJECT_SLUG: string;
  MEMBER_ID: string;
  MAINTAINER_NAME: string | null;
  /** From the person's contributor or participant row on the project, when they have one. */
  MAINTAINER_AVATAR_URL: string | null;
}

/** One month of the account's maintainer roles (ORG_OVERVIEW_MAINTAINER_ROLES_TREND): the roles overlapping that calendar month. */
export interface OrgMaintainerRolesMonthlyRow {
  MONTH_START_DATE: Date;
  ACTIVE_ROLES: number | null;
}

/** One sparkline point of Project Detail's Maintainer roles card: the account's and every company's roles in that period. */
export interface OrgProjectMaintainerRolesSeriesRow {
  ACCOUNT_ROLES: number | null;
  PROJECT_ROLES: number | null;
}

/** A calendar month of the 1y/2y sparkline (ORG_LENS_PROJECT_MAINTAINER_ROLES_MONTHLY). */
export interface OrgProjectMaintainerRolesMonthlyRow extends OrgProjectMaintainerRolesSeriesRow {
  SPAN_MONTH: Date | string | null;
}

/** A lifetime bucket of the all-time sparkline (ORG_LENS_PROJECT_MAINTAINER_ROLES_LIFETIME). */
export interface OrgProjectMaintainerRolesLifetimeRow extends OrgProjectMaintainerRolesSeriesRow {
  BUCKET_INDEX: number | null;
}

/** A leaderboard organization's roles on a project and every company's roles there, overlapping one range. */
export interface OrgOrganizationMaintainerRolesRow {
  ORGANIZATION_ROLES: number | null;
  PROJECT_ROLES: number | null;
}
