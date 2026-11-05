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

/** One detail row from `PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING` for a people-list member — finest grain the BFF returns; client groups by `(personKey, courseId)` for the expanded row. */
export interface OrgTraineeDetailRow {
  /** Warehouse key of the people-list member on the matching trainee row. */
  personKey: string;
  status: OrgTraineeStatus;
  /** Enrollment or certificate id. */
  courseOrCertId: string;
  courseId: string;
  /** The row's `COURSE_NAME`; null when the warehouse has none. No display fallback on the wire: pair resolution takes the greatest real name, and the client falls back to the course id only after resolving. */
  courseName: string | null;
  foundationId: string | null;
  foundationName: string | null;
  projectId: string | null;
  projectName: string | null;
  /** Beginner, Intermediate, Advanced, Executive; null for courses without a level. */
  courseLevel: string | null;
  /** Product type of the course: `Certification` or `Training`; splits certified pairs into the Certifications and Trainings-completed cards. */
  productType: string | null;
  /** Instruction type (E-Learning, Instructor Led, …); certified rows carry the course's format. */
  courseFormat: string | null;
  /** ISO timestamp — union of `enrollment_ts` (Enrolled rows) and `issued_ts` (Certified rows); the BFF windows on it and it breaks Most Recent Course ties. */
  activityTs: string;
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
  /** People-list members with a training row in the range. */
  trainees: OrgTraineeRow[];
  /**
   * Training rows in the range of the people-list members in `trainees`, under their warehouse key. None for a person
   * with no current-employee row (an unlisted former employee) or for learners outside the people list; the cards come
   * from the stats call.
   */
  details: OrgTraineeDetailRow[];
  /**
   * Learners outside the people list with a training row in the range, sorted by name; filtered by the range only. A
   * learner whose warehouse key also has people-list rows in `details` is left out, so the people card counts them once.
   */
  outsideLearners: OrgTraineeOutsideLearner[];
  /**
   * Counts only, no keys: the people-list members with NO current-employee row (unlisted former employees) that have
   * in-range training, which the stat cards count but `trainees` / `details` never list. `people` = distinct persons,
   * `pairs` = distinct (person, course) pairs, under the same pair rule as the stats.
   */
  formerOnPeopleList: OrgTraineeFormerOnPeopleListCounts;
  /** ISO build time of `ORG_PEOPLE_TRAINING` (`MAX(DBT_RUN_AT)` over the account's rows, every range): the date the training data reflects. Null when the account has no rows. */
  asOf: string | null;
}

// Client-only view types (NOT on the wire).

/**
 * One person-course pair of the Trainees details in the selected range (the grain the stat cards count), with the
 * attributes resolved from ALL of the pair's in-range rows before any filter applies — the twin of the BFF's pair rule.
 */
export interface OrgTraineePair {
  personKey: string;
  courseId: string;
  /** Certified when any of the pair's rows in the range is a certificate. */
  status: OrgTraineeStatus;
  /** Greatest product type across the pair's rows; `Certification` or `Training`. */
  productType: string | null;
  /** Greatest real course name across the pair's rows; null when no row has one. Display falls back to `courseId` after resolving. */
  courseName: string | null;
  /** Greatest course level across the pair's rows; null when no row has one. */
  courseLevel: string | null;
  /** Format of the pair's latest row that has one (by activity timestamp); null when no row has one. */
  courseFormat: string | null;
  /** Greatest foundation id across the pair's rows, and the name carried by that same row. */
  foundationId: string | null;
  foundationName: string | null;
  /** Greatest project id across the pair's rows, and the name carried by that same row. */
  projectId: string | null;
  projectName: string | null;
}

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

/** One collapsed row in the expanded "Courses & Certifications" sub-table — one per `(personKey, courseId)`. */
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
  /** ISO timestamp used as primary sort key inside the sub-table — `MAX(enrolledTs, completedTs)`. */
  sortTs: string;
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

/** Per-(account, person, course_or_cert) row from `ORG_PEOPLE_TRAINING`. */
export interface OrgPeopleTrainingRow {
  PERSON_KEY: string;
  STATUS: string | null;
  COURSE_OR_CERT_ID: string;
  COURSE_ID: string | null;
  COURSE_NAME: string | null;
  ACTIVITY_TS: Date | string | null;
  FOUNDATION_ID: string | null;
  FOUNDATION_NAME: string | null;
  PROJECT_ID: string | null;
  PROJECT_NAME: string | null;
  COURSE_LEVEL: string | null;
  COURSE_FORMAT: string | null;
  /** 'Certification' | 'Training' (every row). */
  PRODUCT_TYPE: string | null;
}

/** `MAX(DBT_RUN_AT)` of the account's `ORG_PEOPLE_TRAINING` rows. */
export interface TraineeAsOfRow {
  AS_OF: Date | string | null;
}

/**
 * Per-(account, person) row from `ORG_TRAINING_OUTSIDE_LEARNERS` joined to the person's training rows in the range: a
 * learner outside the people list, name and overall status only.
 */
export interface OrgTrainingOutsideLearnerRow {
  LEARNER_NAME: string | null;
  /** Whether any of the learner's training rows in the range is a certificate (`BOOLOR_AGG`). */
  IS_CERTIFIED: boolean | null;
}
