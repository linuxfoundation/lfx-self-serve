// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgDropdownOption } from './org-memberships.interface';
import type { OrgLensTimeRange } from './org-lens-time-range.interface';

/** Status badge on a per-(person, course) detail row — mirrors `STATUS` column on `PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING`. */
export type OrgTraineeStatus = 'Certified' | 'Enrolled';

/** Sortable column on the Trainees main table. */
export type OrgTraineeSortColumn = 'name' | 'status' | 'courses' | 'certs' | 'recent';

/** Sort direction — `1` ascending, `-1` descending. */
export type OrgTraineeSortDirection = 1 | -1;

/** One detail row from `PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING` — finest grain the BFF returns; client groups by `(personKey, courseId)` for the expanded row. */
export interface OrgTraineeDetailRow {
  /** Warehouse person key for a people-list member; the same opaque per-response key as its trainee row otherwise. */
  personKey: string;
  status: OrgTraineeStatus;
  courseOrCertId: string;
  courseId: string;
  courseName: string;
  foundationId: string | null;
  foundationName: string | null;
  projectId: string | null;
  projectName: string | null;
  /** Beginner, Intermediate, Advanced, Executive; null for courses without a level. */
  courseLevel: string | null;
  /** Instruction type (E-Learning, Instructor Led, …). Set on Enrolled rows only: certificates carry no format upstream. */
  courseFormat: string | null;
  /** ISO timestamp — union of `enrollment_ts` (Enrolled rows) and `issued_ts` (Certified rows); the BFF windows on it and it breaks Most Recent Course ties. */
  activityTs: string;
}

/**
 * Per-(account, person) main row source — joined client-side with `details` for filter-aware derivations. A learner
 * outside the Org Lens people list (lfx-self-serve#4287) carries a name and nothing else: no ids, title or email, and an
 * opaque per-response `personKey` (`ORG_TRAINEE_OUTSIDE_KEY_PREFIX` + n) in place of their warehouse key.
 */
export interface OrgTraineeRow {
  /** Warehouse person key for a people-list member, which the person drawer reads; opaque per response otherwise. */
  personKey: string;
  lfid: string | null;
  cdpMemberId: string | null;
  name: string;
  title: string | null;
  email: string | null;
  /** False for a learner attributed to the organization by their enrollment who is not on the people list. */
  onPeopleList: boolean;
}

/** Stats-card shape for the Trainees tab — recomputed client-side from filtered details on every filter change (not shipped on the wire). */
export interface OrgTraineeStatsBaseline {
  trainees: number;
  coursesEnrolled: number;
  certifications: number;
  /** Integer percent (0-100). Math: `certifications ÷ coursesEnrolled × 100`; 0 when `coursesEnrolled === 0`. */
  completionRate: number;
}

/**
 * Trainees dropdowns, each built from the detail rows the response ships, so every option has rows in the range. Values:
 * foundation and project ids; course name (several course ids can share a name, and one entry must cover them all);
 * level and format as stored.
 */
export interface OrgTraineeFilterOptions {
  foundations: OrgDropdownOption[];
  projects: OrgDropdownOption[];
  courses: OrgDropdownOption[];
  levels: OrgDropdownOption[];
  formats: OrgDropdownOption[];
}

/** GET response for `/api/orgs/:orgUid/lens/people/trainees?range=…` — only enrollments and certificates dated in the range. */
export interface OrgTraineesResponse {
  accountId: string;
  /** Echo of the range the BFF read — lets the client drop a late response from a previous range. */
  timeRange: OrgLensTimeRange;
  trainees: OrgTraineeRow[];
  details: OrgTraineeDetailRow[];
  filterOptions: OrgTraineeFilterOptions;
  /** ISO build time of `ORG_PEOPLE_TRAINING` (`MAX(DBT_RUN_AT)` over the account's rows, every range): the date the training data reflects. Null when the account has no rows. */
  asOf: string | null;
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
  /** False: name and training status only, and no person drawer (the drawer reads people-list data). */
  onPeopleList: boolean;
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
  PROJECT_ID: string | null;
  PROJECT_NAME: string | null;
  COURSE_LEVEL: string | null;
  COURSE_FORMAT: string | null;
}

/** `MAX(DBT_RUN_AT)` of the account's `ORG_PEOPLE_TRAINING` rows. */
export interface TraineeAsOfRow {
  AS_OF: Date | string | null;
}

/** Per-(account, person) row from `ORG_TRAINING_OUTSIDE_LEARNERS`: a learner outside the people list, name only. */
export interface OrgTrainingOutsideLearnerRow {
  PERSON_KEY: string;
  LEARNER_NAME: string | null;
}
