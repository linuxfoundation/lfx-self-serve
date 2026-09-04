// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgAccessBadgeState } from './org-lens-access.interface';

/** Tab identifier for the Org People page tab strip. */
export type PeopleTabId = 'all' | 'board' | 'committee' | 'contacts' | 'contributors' | 'events' | 'training' | 'access';

/** Tab definition for the Org People page. */
export interface PeopleTabConfig {
  readonly id: PeopleTabId;
  readonly label: string;
  readonly icon: string;
  /** Empty-state noun used to complete "...to view {noun}." */
  readonly noun: string;
}

// All Employees tab ----------------------------------------------------------

/** Filter the All Employees table by activity dimension. */
export type OrgAllEmployeeActivityFilter = 'all' | 'governance' | 'code' | 'events' | 'training';

/** Voting status badge — upstream free-text values are narrowed at the BFF boundary. */
export type OrgAllEmployeeVotingStatus = 'Voting' | 'Non-voting' | 'Observer';

/** Training row status. */
export type OrgAllEmployeeTrainingStatus = 'Certified' | 'Enrolled';

/** Sortable column on the All Employees table. */
export type OrgAllEmployeeSortColumn = 'name' | 'seats' | 'commits' | 'events' | 'courses' | 'access';

/** Sort direction — `1` ascending, `-1` descending. */
export type OrgAllEmployeeSortDirection = 1 | -1;

/** Foundation dropdown option — only foundations the org actually engages with. */
export interface OrgAllEmployeeFoundationOption {
  foundationId: string;
  foundationName: string;
}

/** Provenance for a unified people row: which upstream source(s) contributed it. `snowflake` is the stored roster; the rest are live reads merged in by the `?live` endpoint. */
export type OrgPersonSource = 'snowflake' | 'board' | 'committee' | 'keyContact' | 'access';

/** Dropdown option for the activity filter (typed value). */
export interface OrgAllEmployeeActivityOption {
  label: string;
  value: OrgAllEmployeeActivityFilter;
}

/** One row in the All Employees table. */
export interface OrgAllEmployeeRow {
  personKey: string;
  lfid: string | null;
  /**
   * Lowercased LF username — the identity a row is merged on when present. A person legitimately
   * holds several email addresses, so the address is not an identifier; this is. `null` for sources
   * that carry no verified identity (key contacts, pending invites), which then fall back to email.
   */
  lfUsername: string | null;
  cdpMemberId: string | null;
  name: string;
  /** Given name. Populated directly by live sources; for Snowflake-only rows it is a best-effort split of `name`. */
  firstName: string | null;
  /** Family name. Populated directly by live sources; for Snowflake-only rows it is a best-effort split of `name`. */
  lastName: string | null;
  title: string | null;
  /** Preferred display address: the stored roster's when the row has one, else the first live address contributing. */
  email: string | null;
  /** Every lowercased address that contributed to this row. Length > 1 is the normal result of a merge. */
  emails: string[];
  /** Diagnostic: the merge keys that collapsed into this row (e.g. `identity:mcderk`). Lets a reviewer explain a merge without re-deriving it. */
  mergedFrom?: string[];
  /**
   * Org Lens access badge for the principal the merge actually attributed to this person, or `null`
   * when none was. Authoritative: the client's own address-based join cannot tell two people who
   * share an address apart, so it would attribute one person's role to the other. Absent on payloads
   * cached before this field existed, which fall back to that join.
   */
  accessBadge?: OrgAccessBadgeState | null;
  /** Avatar/photo URL (CDP user photo or org-logo fallback); `null` when absent. The UI falls back to initials. */
  avatarUrl: string | null;
  /** Which upstream(s) contributed this person. Stored-only rows are `['snowflake']`; `?live` rows may carry several. */
  sources: OrgPersonSource[];
  seatsCount: number;
  boardSeatsCount: number;
  committeeSeatsCount: number;
  commitsCount: number;
  eventsCount: number;
  coursesCount: number;
  engagedFoundationIds: string[];
}

/** Pre-decorated All Employees row — wire shape plus per-row derivatives baked once so the template stays method-free. */
export interface OrgAllEmployeeRowVm extends OrgAllEmployeeRow {
  initials: string;
  avatarColorClass: string;
  /** Composite `personKey::avatarUrl` token used to track a broken avatar by URL, so a later refetch with a new URL can render again. Empty string when the row has no `avatarUrl`. */
  avatarKey: string;
  /** Org Lens access for the current org, or `null` when the employee has no access record. Drives the access cell badge. */
  access: OrgAccessBadgeState | null;
  /** `true` when this row was synthesised from the access roster (no detected activity, no detail to fetch). */
  isSynthetic: boolean;
  /** Precomputed `<tr>` class list — keeps the template free of conditional class bindings on every cell. */
  rowClass: string;
}

/** Account-level engagement totals for the 5 stat cards above the table. */
export interface OrgAllEmployeeStats {
  activeInOss: number;
  inGovernance: number;
  codeContributors: number;
  eventAttendees: number;
  trainees: number;
}

/** Bundled list payload — single UI subscription on tab load. */
export interface OrgAllEmployeesResponse {
  accountId: string;
  rows: OrgAllEmployeeRow[];
  stats: OrgAllEmployeeStats;
  foundations: OrgAllEmployeeFoundationOption[];
}

// Detail (chevron expand) ----------------------------------------------------

/** One board or committee seat held by the employee. */
export interface OrgAllEmployeeCommitteeMembership {
  committeeId: string;
  committeeName: string;
  foundationId: string;
  foundationName: string;
  committeeRole: string;
  votingStatus: OrgAllEmployeeVotingStatus;
  isBoard: boolean;
}

/** One project the employee contributed code to. */
export interface OrgAllEmployeeCodeContribution {
  projectId: string;
  projectName: string;
  foundationId: string;
  foundationName: string;
  totalCommits: number;
  lastActivityDate: string | null;
  isMaintainer: boolean;
}

/** One event the employee attended (or spoke at). */
export interface OrgAllEmployeeEvent {
  eventId: string;
  eventName: string;
  foundationId: string;
  foundationName: string;
  isSpeaker: boolean;
  eventsCount: number;
  lastEventEndDate: string | null;
}

/** One course / certification the employee enrolled in. */
export interface OrgAllEmployeeTraining {
  courseId: string;
  courseName: string;
  status: OrgAllEmployeeTrainingStatus;
  certificationsCount: number;
  coursesCount: number;
}

/** Lazy detail payload returned when a row is expanded. Empty arrays are legitimate (HTTP 200). */
export interface OrgAllEmployeeDetail {
  personKey: string;
  boardSeats: OrgAllEmployeeCommitteeMembership[];
  committeeSeats: OrgAllEmployeeCommitteeMembership[];
  code: OrgAllEmployeeCodeContribution[];
  events: OrgAllEmployeeEvent[];
  training: OrgAllEmployeeTraining[];
  /**
   * Every address this person holds on a domain belonging to the organization in context, ordered
   * primary-first then alphabetically. Sourced from
   * `ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_COMPANY_EMAILS`.
   *
   * Uncapped — ten addresses for one person is a real observed value, so consumers must not assume a
   * bound. An empty array is an authoritative "no company address on record", not an error: personal
   * and other-employer addresses are not omitted from this list, they are never retrieved, so no
   * client-side filtering is required or permitted.
   */
  companyEmails: string[];
  /**
   * Why `companyEmails` looks the way it does. Without this the client cannot tell an authoritative
   * empty result from a lookup that never ran, and would render "no company address on record" —
   * a factual claim about a named individual — on the strength of a failure.
   *
   * - `resolved`: the lookup ran. An empty array here genuinely means none on record.
   * - `unavailable`: no identity was available to look up with, so nothing was attempted.
   * - `failed`: the lookup ran and errored. Deliberately does not fail the whole detail response —
   *   the activity tabs must keep rendering.
   */
  companyEmailsStatus: OrgCompanyEmailsStatus;
}

export type OrgCompanyEmailsStatus = 'resolved' | 'unavailable' | 'failed';

/**
 * Response for the username-keyed company-emails lookup, used by the governance surfaces (Board,
 * Committee, Key Contacts, Org Lens Access) whose rows carry an LF username rather than a
 * `personKey`.
 *
 * Keyed on an identity, never on an address. An address-keyed variant of this lookup was withdrawn:
 * once it returns real data it becomes an interface that, given any email address, returns the other
 * addresses the same human holds — an enumeration primitive over personal data, on a read path that
 * does not yet enforce the organization relation.
 */
export interface OrgPersonCompanyEmailsResponse {
  companyEmails: string[];
  /**
   * Same three-way status as `OrgAllEmployeeDetail.companyEmailsStatus`. `unavailable` is the
   * answer when the username is not on the address model's spine at this account (an Org Lens Access
   * principal who is not a committee member, key contact or roster person), or when the server-side
   * feature flag is off — never "none on record". A client that sees no status must treat the
   * response as unavailable, not as an empty set.
   */
  companyEmailsStatus: OrgCompanyEmailsStatus;
}

/**
 * Internal fetch-result shape for `PersonDetailDrawerService`. `detail` stays `null` for openers that
 * carry only an identity and no `personKey`, so the drawer's "Detailed activity isn't available" state
 * stays truthful instead of implying verified-empty activity.
 */
export interface OrgDrawerFetchResult {
  detail: OrgAllEmployeeDetail | null;
  companyEmails: string[];
}
