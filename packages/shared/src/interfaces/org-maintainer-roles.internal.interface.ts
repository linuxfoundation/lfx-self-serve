// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Server-internal shapes for reads of ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES and
// ORG_MAINTAINER_ROLES_MONTHLY (lfx-self-serve#4482). A role is one (person, Insights project) pair.
// They live in the shared package because AGENTS.md prohibits module-level interfaces inside
// apps/lfx-one/; they are NOT part of the wire contract consumed by the frontend.

/** The overlap predicate for maintainer roles and the values its placeholders bind, in order. */
export interface OrgMaintainerRoleOverlap {
  sql: string;
  binds: number[];
}

/** The two maintainer roles tables; a read names the one it may find missing. */
export type OrgMaintainerRolesTable = 'ORG_MAINTAINER_ROLES' | 'ORG_MAINTAINER_ROLES_MONTHLY';

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

/** One month of the account's LF maintainer roles: the roles overlapping that calendar month. */
export interface OrgMaintainerRolesMonthlyRow {
  METRIC_MONTH: Date;
  ACTIVE_ROLES: number | null;
}
