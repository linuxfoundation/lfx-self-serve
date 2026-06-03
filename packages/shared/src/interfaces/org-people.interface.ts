// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
export type OrgAllEmployeeSortColumn = 'name' | 'seats' | 'commits' | 'events' | 'courses';

/** Sort direction — `1` ascending, `-1` descending. */
export type OrgAllEmployeeSortDirection = 1 | -1;

/** Foundation dropdown option — only foundations the org actually engages with. */
export interface OrgAllEmployeeFoundationOption {
  foundationId: string;
  foundationName: string;
}

/** Dropdown option for the activity filter (typed value). */
export interface OrgAllEmployeeActivityOption {
  label: string;
  value: OrgAllEmployeeActivityFilter;
}

/** One row in the All Employees table. */
export interface OrgAllEmployeeRow {
  personKey: string;
  lfid: string | null;
  cdpMemberId: string | null;
  name: string;
  title: string | null;
  email: string | null;
  seatsCount: number;
  boardSeatsCount: number;
  committeeSeatsCount: number;
  commitsCount: number;
  eventsCount: number;
  coursesCount: number;
  engagedFoundationIds: string[];
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
}
