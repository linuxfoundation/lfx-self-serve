// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensTimeRange } from './org-lens-time-range.interface';

/** Status badge on a per-(person, course) detail row — mirrors `STATUS` column on `PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING`. */
export type OrgTraineeStatus = 'Certified' | 'Enrolled';

/** Sortable column on the Trainees main table. */
export type OrgTraineeSortColumn = 'name' | 'status' | 'courses' | 'certs' | 'trainings' | 'inProgress' | 'recent';

/** Sort direction — `1` ascending, `-1` descending. */
export type OrgTraineeSortDirection = 1 | -1;

/**
 * Which empty-table copy the Trainees tab shows: a search or dropdown pick (`filters`); a search that matches only
 * learners outside the people list; a range where only learners outside the people list have activity; any other
 * non-default range; or nothing at all.
 */
export type OrgTraineesEmptyState = 'filters' | 'people-list-search' | 'people-list-range' | 'range' | 'none';

export interface OrgTraineeDetailRow {
  /** Warehouse key of the people-list member on the matching trainee row. */
  personKey: string;
  courseId: string;
  status: OrgTraineeStatus;
  activityTs: string;
}

export interface OrgTraineePair {
  personKey: string;
  courseId: string;
  /** Certified when any of the pair's rows in the range is a certificate. */
  status: OrgTraineeStatus;
  productType: string | null;
  courseName: string | null;
  courseLevel: string | null;
  courseFormat: string | null;
  foundationId: string | null;
  foundationName: string | null;
  projectId: string | null;
  projectName: string | null;
  lastActivityTs: string | null;
}

/** Per-(account, person) main row source for a people-list member — joined client-side with `details` for filter-aware derivations. */
export interface OrgTraineeRow {
  /** Warehouse person key, which the person drawer reads. */
  personKey: string;
  lfid: string | null;
  cdpMemberId: string | null;
  name: string;
  title: string | null;
  email: string | null;
}

/**
 * A learner attributed to the organization by their enrollment who is not on its people list (lfx-self-serve#4287):
 * name and one overall status for the range only. No course, project, foundation, level, format, date or id leaves the
 * BFF for them.
 */
export interface OrgTraineeOutsideLearner {
  /** Opaque per-response key (`ORG_TRAINEE_OUTSIDE_KEY_PREFIX` + n) in place of their warehouse key; person endpoints reject it. */
  personKey: string;
  name: string | null;
  /** Certified when any of their training rows in the range is a certificate, Enrolled otherwise. */
  status: OrgTraineeStatus;
}

/** Counts of the unlisted former employees whose training the stat cards include but the Trainees table does not list. */
export interface OrgTraineeFormerOnPeopleListCounts {
  people: number;
  pairs: number;
}

/** GET response for `/api/orgs/:orgUid/lens/people/trainees?range=…` — only enrollments and certificates dated in the range. */
export interface OrgTraineesResponse {
  accountId: string;
  /** Echo of the range the BFF read — lets the client drop a late response from a previous range. */
  timeRange: OrgLensTimeRange;
  trainees: OrgTraineeRow[];
  pairs: OrgTraineePair[];
  details: OrgTraineeDetailRow[];
  outsideLearners: OrgTraineeOutsideLearner[];
  formerOnPeopleList: OrgTraineeFormerOnPeopleListCounts;
  asOf: string | null;
}

// Client-only view types (NOT on the wire).

/** Counts over a set of pairs; courses taken = certifications + trainings completed + in progress. */
export interface OrgTraineePairCounts {
  coursesTaken: number;
  certifications: number;
  trainingsCompleted: number;
  inProgress: number;
}

/** Pre-decorated trainee main row VM — initials, avatar colour, filter-aware status/courses/certs/recent. */
export interface OrgTraineeRowVm {
  personKey: string;
  name: string;
  title: string | null;
  email: string | null;
  initials: string;
  avatarColorClass: string;
  status: OrgTraineeStatus;
  /** Person-course pairs in the range. */
  coursesCount: number;
  /** Certified pairs of `Certification` products. */
  certsCount: number;
  /** Certified pairs of `Training` products. */
  trainingsCompletedCount: number;
  /** Enrolled pairs with no certificate in the range. */
  inProgressCount: number;
  recentCourseName: string | null;
  recentFoundationName: string | null;
}

export interface OrgTraineeExpandedRowVm {
  courseId: string;
  courseName: string;
  /** Product type of the course. */
  type: 'Training' | 'Certification';
  enrolledTs: string | null;
  completedTs: string | null;
  /** Pre-formatted `MMM YYYY` (e.g. `Apr 2026`) or em-dash. */
  enrolledLabel: string;
  completedLabel: string;
  sortTs: string | null;
}

// Server-internal Snowflake row shapes (not on the wire) — kept here so the rule against local interfaces in `apps/lfx-one/` holds.

/** Per-(account, person) row from `ORG_PEOPLE_ALL` filtered to trainees (`COURSES_COUNT > 0`). */
export interface OrgPeopleAllTraineeRow {
  PERSON_KEY: string;
  LFID: string | null;
  CDP_MEMBER_ID: string | null;
  NAME: string | null;
  TITLE: string | null;
  EMAIL: string | null;
}

export interface OrgPeopleTrainingPairRow {
  PERSON_KEY: string;
  COURSE_KEY: string;
  IS_CERTIFIED: boolean | null;
  PRODUCT_TYPE: string | null;
  COURSE_NAME: string | null;
  COURSE_LEVEL: string | null;
  COURSE_FORMAT: string | null;
  FOUNDATION_ID: string | null;
  FOUNDATION_NAME: string | null;
  PROJECT_ID: string | null;
  PROJECT_NAME: string | null;
  LAST_ACTIVITY_TS: Date | string | null;
}

export interface OrgPeopleTrainingDateRow {
  PERSON_KEY: string;
  COURSE_ID: string | null;
  COURSE_OR_CERT_ID: string;
  STATUS: string | null;
  ACTIVITY_TS: Date | string | null;
}

export interface OrgTraineeDateRow {
  PERSON_KEY: string;
  COURSE_KEY: string;
  STATUS: string | null;
  ACTIVITY_TS: Date | string | null;
}

export interface OrgTraineesRaw {
  traineeRows: OrgPeopleAllTraineeRow[];
  outsideLearnerRows: OrgTrainingOutsideLearnerRow[];
  pairRows: OrgPeopleTrainingPairRow[];
  dateRows: OrgTraineeDateRow[];
  formerOnPeopleList: OrgTraineeFormerOnPeopleListCounts;
  asOf: string | null;
}

export interface TraineeAsOfRow {
  AS_OF: Date | string | null;
}

export interface OrgTrainingOutsideLearnerRow {
  LEARNER_NAME: string | null;
  IS_CERTIFIED: boolean | null;
}
