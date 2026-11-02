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
 * the one it may find missing. PROJECT_MAINTAINER_ROLES holds every role, with or without an account.
 */
export type OrgMaintainerRolesTable = 'ORG_MAINTAINER_ROLES' | 'ORG_MAINTAINER_ROLES_MONTHLY' | 'PROJECT_MAINTAINER_ROLES';

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

/** One month of the account's maintainer roles (ORG_MAINTAINER_ROLES_MONTHLY): the roles overlapping that calendar month. */
export interface OrgMaintainerRolesMonthlyRow {
  METRIC_MONTH: Date;
  ACTIVE_ROLES: number | null;
}

/** A leaderboard organization's roles on a project and every company's roles there, overlapping one range. */
export interface OrgOrganizationMaintainerRolesRow {
  ORGANIZATION_ROLES: number | null;
  PROJECT_ROLES: number | null;
}
