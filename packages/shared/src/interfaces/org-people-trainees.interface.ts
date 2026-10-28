// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensTimeRange } from './org-lens-time-range.interface';

/** Status badge on a per-(person, course) detail row — mirrors `STATUS` column on `PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING`. */
export type OrgTraineeStatus = 'Certified' | 'Enrolled';

/** Sortable column on the Trainees main table. */
export type OrgTraineeSortColumn = 'name' | 'status' | 'courses' | 'certs' | 'recent';

/** Sort direction — `1` ascending, `-1` descending. */
export type OrgTraineeSortDirection = 1 | -1;

/** One detail row from `PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING` — finest grain the BFF returns; client groups by `(personKey, courseId)` for the expanded row. */
export interface OrgTraineeDetailRow {
  personKey: string;
  status: OrgTraineeStatus;
  courseOrCertId: string;
  courseId: string;
  courseName: string;
  foundationId: string | null;
  foundationName: string | null;
  /** ISO timestamp — union of `enrollment_ts` (Enrolled rows) and `issued_ts` (Certified rows); the BFF windows on it and it breaks Most Recent Course ties. */
  activityTs: string;
}

/** Per-(account, person) main row source — joined client-side with `details` for filter-aware derivations. */
export interface OrgTraineeRow {
  personKey: string;
  lfid: string | null;
  cdpMemberId: string | null;
  name: string;
  title: string | null;
  email: string | null;
}

/** Foundation dropdown option — only foundations the org has trainee rows for in the range. */
export interface OrgTraineeFoundationOption {
  foundationId: string;
  foundationName: string;
}

/** Course dropdown option — keyed on `COURSE_ID`; label is course name. Only courses with rows in the range. */
export interface OrgTraineeCourseOption {
  courseId: string;
  courseName: string;
}

/** Stats-card shape for the Trainees tab — recomputed client-side from filtered details on every filter change (not shipped on the wire). */
export interface OrgTraineeStatsBaseline {
  trainees: number;
  coursesEnrolled: number;
  certifications: number;
  /** Integer percent (0-100). Math: `certifications ÷ coursesEnrolled × 100`; 0 when `coursesEnrolled === 0`. */
  completionRate: number;
}

/** GET response for `/api/orgs/:orgUid/lens/people/trainees?range=…` — only enrollments and certificates dated in the range. */
export interface OrgTraineesResponse {
  accountId: string;
  /** Echo of the range the BFF read — lets the client drop a late response from a previous range. */
  timeRange: OrgLensTimeRange;
  trainees: OrgTraineeRow[];
  details: OrgTraineeDetailRow[];
  foundationOptions: OrgTraineeFoundationOption[];
  courseOptions: OrgTraineeCourseOption[];
}

// Client-only view types (NOT on the wire).

/** Pre-decorated trainee main row VM — initials, avatar colour, filter-aware status/courses/certs/recent. */
export interface OrgTraineeRowVm {
  personKey: string;
  name: string;
  title: string | null;
  email: string | null;
  initials: string;
  avatarColorClass: string;
  status: OrgTraineeStatus;
  coursesCount: number;
  certsCount: number;
  recentCourseName: string | null;
  recentFoundationName: string | null;
}

/** One collapsed row in the expanded "Courses & Certifications" sub-table — one per `(personKey, courseId)`. */
export interface OrgTraineeExpandedRowVm {
  courseId: string;
  courseName: string;
  type: 'Course' | 'Certification';
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
}

/** Distinct `(FOUNDATION_ID, FOUNDATION_NAME)` row from the foundation-options query (trainees). */
export interface TraineeFoundationOptionRow {
  FOUNDATION_ID: string;
  FOUNDATION_NAME: string;
}

/** Distinct `(COURSE_ID, COURSE_NAME)` row from the course-options query. */
export interface TraineeCourseOptionRow {
  COURSE_ID: string;
  COURSE_NAME: string;
}
