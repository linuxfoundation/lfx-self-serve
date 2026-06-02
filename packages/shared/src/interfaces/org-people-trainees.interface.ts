// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Status badge on a per-(person, course) detail row — mirrors `STATUS` column on `PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING`. */
export type OrgTraineeStatus = 'Certified' | 'Enrolled';

/** Sortable column on the Trainees main table. */
export type OrgTraineeSortColumn = 'name' | 'status' | 'courses' | 'certs' | 'recent';

/** Sort direction — `1` ascending, `-1` descending. */
export type OrgTraineeSortDirection = 1 | -1;

/** Time-window filter buckets — anchored on `ACTIVITY_TS` server-side; client just toggles strings. */
export type OrgTraineeTimeWindow = '3m' | '6m' | '12m' | '2y' | 'all';

/** One detail row from `PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING` — finest grain the BFF returns; client groups by `(personKey, courseId)` for the expanded row. */
export interface OrgTraineeDetailRow {
  personKey: string;
  status: OrgTraineeStatus;
  courseOrCertId: string;
  courseId: string;
  courseName: string;
  foundationId: string | null;
  foundationName: string | null;
  /** ISO timestamp — union of `enrollment_ts` (Enrolled rows) and `issued_ts` (Certified rows); drives time-window filter + Most Recent Course tiebreaker. */
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

/** Foundation dropdown option — only foundations the org has trainee rows for. */
export interface OrgTraineeFoundationOption {
  foundationId: string;
  foundationName: string;
}

/** Course dropdown option — keyed on `COURSE_ID`; label is course name. */
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

/** Bundled GET response for `/api/orgs/:orgUid/lens/people/trainees`. */
export interface OrgTraineesResponse {
  accountId: string;
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

/** Trainees time-window dropdown option — label rendered as-is in `<lfx-select>`. */
export interface OrgTraineeTimeWindowOption {
  label: string;
  value: OrgTraineeTimeWindow;
}
