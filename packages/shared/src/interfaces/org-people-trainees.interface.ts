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

/** One enrollment or certificate row of a listed pair, dated in the range; the expanded row reads its dates. */
export interface OrgTraineeDetailRow {
  /** Warehouse key of the people-list member on the matching trainee row. */
  personKey: string;
  /** Course key of the pair the row belongs to. */
  courseId: string;
  status: OrgTraineeStatus;
  /** ISO timestamp: the enrollment time on Enrolled rows, the issue time on Certified rows. */
  activityTs: string;
  /** @deprecated Legacy: sent only for clients loaded before pairs were served; the current client does not read it. */
  productType?: string | null;
  /** @deprecated Legacy: sent only for clients loaded before pairs were served; the current client does not read it. */
  courseName?: string | null;
  /** @deprecated Legacy: sent only for clients loaded before pairs were served; the current client does not read it. */
  courseLevel?: string | null;
  /** @deprecated Legacy: sent only for clients loaded before pairs were served; the current client does not read it. */
  courseFormat?: string | null;
  /** @deprecated Legacy: sent only for clients loaded before pairs were served; the current client does not read it. */
  foundationId?: string | null;
  /** @deprecated Legacy: sent only for clients loaded before pairs were served; the current client does not read it. */
  foundationName?: string | null;
  /** @deprecated Legacy: sent only for clients loaded before pairs were served; the current client does not read it. */
  projectId?: string | null;
  /** @deprecated Legacy: sent only for clients loaded before pairs were served; the current client does not read it. */
  projectName?: string | null;
}

/** One person-course pair of a listed person in the range, as the warehouse resolved it: the grain the stat cards count. */
export interface OrgTraineePair {
  personKey: string;
  /** Course key: the course id, or the certificate id for a certificate with no course. */
  courseId: string;
  /** Certified when any of the pair's rows in the range is a certificate. */
  status: OrgTraineeStatus;
  /** Product type of the course: `Certification` or `Training`; splits certified pairs into the Certifications and Trainings-completed cards. */
  productType: string | null;
  /** The course's name; null when the warehouse has none. Display falls back to `courseId`. */
  courseName: string | null;
  /** Beginner, Intermediate, Advanced, Executive; null for courses without a level. */
  courseLevel: string | null;
  /** Instruction type (E-Learning, Instructor Led, …). */
  courseFormat: string | null;
  foundationId: string | null;
  foundationName: string | null;
  projectId: string | null;
  projectName: string | null;
  /** ISO timestamp of the pair's latest enrollment or certificate in the range; orders Most Recent Course. */
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
  /** People-list members with a training pair in the range. */
  trainees: OrgTraineeRow[];
  /** The warehouse-resolved person-course pairs of the people in `trainees`: the same pairs the stat cards count. */
  pairs: OrgTraineePair[];
  /**
   * Enrolled and completed dates for the expanded sub-table, never a source of counts. Each row also carries the
   * deprecated legacy attribute fields, for clients loaded before pairs were served.
   */
  details: OrgTraineeDetailRow[];
  /**
   * Learners outside the people list with a training pair in the range, sorted by name; filtered by the range only. A
   * learner whose warehouse key also has people-list pairs is left out, so the people card counts them once.
   */
  outsideLearners: OrgTraineeOutsideLearner[];
  /**
   * Counts only, no keys: the people-list members with NO current-employee row (unlisted former employees) that have
   * in-range pairs, which the stat cards count but `trainees` / `pairs` never list. `people` = distinct persons,
   * `pairs` = distinct (person, course) pairs.
   */
  formerOnPeopleList: OrgTraineeFormerOnPeopleListCounts;
  /** ISO build time of the training pairs (`MAX(DBT_RUN_AT)` over the account's rows, every range): the date the training data reflects. Null when the account has no rows. */
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

export interface TraineeAsOfRow {
  AS_OF: Date | string | null;
}

export interface OrgTrainingOutsideLearnerRow {
  LEARNER_NAME: string | null;
  IS_CERTIFIED: boolean | null;
}
