// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CERTIFICATION_PRODUCT_TYPE, TRAINING_PRODUCT_TYPE } from '../constants/training.constants';

import type { OffsetPaginatedResponse } from './api.interface';

/** Active tab on the org training & certifications page */
export type OrgTrainingTabId = 'certifications' | 'trainings';

// ─── Org Certifications tab (LFXV2-1896) ─────────────────────────────────────

/** One row in the org Certifications table — a distinct course/cert the org's people have engaged with. */
export interface OrgCertification {
  /** Stable grouping key — COALESCE(COURSE_ID, COURSE_OR_CERT_ID) */
  readonly courseId: string;
  /** Course / certification name */
  readonly name: string;
  /** Issuing foundation/project name; null when unknown */
  readonly foundation: string | null;
  /** Difficulty level (e.g. Beginner/Intermediate/Advanced); null when unknown */
  readonly level: string | null;
  /** Logo/seal image URL; null when unavailable */
  readonly imageUrl: string | null;
  /** Count of org employees who hold this certification (STATUS = 'Certified') */
  readonly certifiedCount: number;
  /** Count of org employees in progress (STATUS IS DISTINCT FROM 'Certified', including NULL) */
  readonly inProgressCount: number;
}

export type OrgCertificationsResponse = OffsetPaginatedResponse<OrgCertification>;

/** Which roster a certification drill-down drawer shows. */
export type OrgCertEmployeeStatus = 'certified' | 'in-progress';

/** One employee in a certification drill-down drawer. */
export interface OrgCertEmployee {
  readonly contactId: string;
  readonly name: string;
  readonly jobTitle: string | null;
}

/** Cert employee row with presentation fields pre-baked for template rendering (avoids method calls in template). */
export interface OrgCertEmployeeVm extends OrgCertEmployee {
  readonly initials: string;
  readonly avatarColorClass: string;
}

/** Drill-down roster of org employees for a single certification + status. */
export interface OrgCertEmployeesResponse {
  readonly courseId: string;
  readonly certificationName: string;
  readonly status: OrgCertEmployeeStatus;
  readonly total: number;
  readonly data: readonly OrgCertEmployee[];
}

/** Frontend query params for the org certifications list (all optional). */
export interface GetOrgCertificationsParams {
  searchQuery?: string;
  level?: string | null;
  pageSize?: number;
  offset?: number;
  sortField?: string;
  sortOrder?: 'ASC' | 'DESC';
}

/** Backend-resolved (validated/clamped) options for the org certifications query. */
export interface GetOrgCertificationsOptions {
  searchQuery?: string;
  level: string | null;
  pageSize: number;
  offset: number;
  sortField: string;
  sortOrder: 'ASC' | 'DESC';
}

// ─── Org Trainings tab (LFXV2-1897) ────────────────────────────────────────────

/** One row in the org Trainings table — a distinct training course the org's people engaged with. */
export interface OrgTraining {
  readonly courseId: string;
  readonly name: string;
  readonly foundation: string | null;
  readonly level: string | null;
  readonly imageUrl: string | null;
  readonly inProgressCount: number;
  readonly completedCount: number;
}

export type OrgTrainingsResponse = OffsetPaginatedResponse<OrgTraining>;

/** Which roster a training drill-down drawer shows. */
export type OrgTrainingEmployeeStatus = 'in-progress' | 'completed';

/** Drill-down roster of org employees for a single training course + status. */
export interface OrgTrainingEmployeesResponse {
  readonly courseId: string;
  readonly trainingName: string;
  readonly status: OrgTrainingEmployeeStatus;
  readonly total: number;
  readonly data: readonly OrgCertEmployee[];
}

/** Frontend query params for the org trainings list (all optional). */
export interface GetOrgTrainingsParams {
  searchQuery?: string;
  level?: string | null;
  pageSize?: number;
  offset?: number;
  sortField?: string;
  sortOrder?: 'ASC' | 'DESC';
}

/** Backend-resolved options for the org trainings query. */
export interface GetOrgTrainingsOptions {
  searchQuery?: string;
  level: string | null;
  pageSize: number;
  offset: number;
  sortField: string;
  sortOrder: 'ASC' | 'DESC';
}

/** Summary statistics for the org training & certifications stat strip */
export interface OrgTrainingStats {
  /** Count of distinct employees who completed at least one certification (STATUS = 'Certified') */
  certifiedEmployees: number;
  /** Total count of certification records (STATUS = 'Certified'), regardless of how many employees earned them */
  certificationsEarned: number;
  /** Distinct employees with at least one in-progress training enrollment (ORG_PEOPLE_TRAINING_COURSES, TRAINING_STATUS = 'InProgress') */
  employeesInTraining: number;
  /** Total in-progress training enrollment rows (ORG_PEOPLE_TRAINING_COURSES, TRAINING_STATUS = 'InProgress') */
  trainingCoursesEnrolled: number;
}

/**
 * Certification status derived from expiration date
 */
export type CertificationStatus = 'active' | 'expired';

export type EnrollmentStatus = 'started' | 'completed' | 'not-started' | 'not-completed';

/**
 * Unified certification state derived from joining USER_COURSE_ENROLLMENTS and USER_CERTIFICATES on COURSE_ID.
 * Represents where a user is in the certification lifecycle for a given course.
 */
export type UnifiedCertState =
  | 'certified-active' // Has a valid certificate, not expiring soon
  | 'expiring-soon' // Has a valid certificate expiring within 90 days
  | 'in-progress' // Active enrollment, no certificate yet
  | 'enrolled-cert-expired' // Active enrollment but certificate has expired — needs renewal
  | 'cert-expired' // No active enrollment and certificate has expired
  | 'cert-only'; // Has certificate, no enrollment record

/**
 * Unified view of a certification, merging enrollment and certificate data by COURSE_ID.
 */
export interface UnifiedCertification {
  /** COURSE_ID — the join key */
  courseId: string;
  /** Course name (from whichever source has it) */
  name: string;
  /** Course description */
  description: string;
  /** Logo image URL */
  imageUrl: string;
  /** Issuing project name */
  issuedBy: string;
  /** Difficulty level */
  level: string;
  /** Derived lifecycle state */
  state: UnifiedCertState;

  // ── Enrollment fields (null if no enrollment record) ──────────────────────
  /** ENROLLMENT_ID; null if no enrollment */
  enrollmentId: string | null;
  /** Enrollment status from Snowflake */
  enrollmentStatus: 'started' | 'completed' | 'not-started' | 'not-completed' | null;
  /** Whether the enrollment is currently active */
  isActiveEnrollment: boolean | null;
  /** URL slug for the exam prep course */
  courseSlug: string | null;

  // ── Certificate fields (null if no certificate record) ────────────────────
  /** Certificate record identifier */
  certId: string | null;
  /** Certificate identifier (human-readable ID for verification) */
  certificateId: string | null;
  /** ISO date string for when the certificate was issued; null if no cert */
  issuedDate: string | null;
  /** ISO date string for certificate expiry; null means perpetual or no cert */
  expiryDate: string | null;
  /** URL to download the certificate; null if unavailable */
  downloadUrl: string | null;
}

/**
 * Snowflake row shape for the unified certification join query
 */
export interface UnifiedCertRow {
  COURSE_ID: string | null;
  COURSE_NAME: string;
  COURSE_GROUP_DESCRIPTION: string | null;
  LOGO_URL: string | null;
  PROJECT_NAME: string | null;
  LEVEL: string | null;
  // Enrollment columns
  ENROLLMENT_ID: string | null;
  ENROLLMENT_STATUS: 'started' | 'completed' | 'not-started' | 'not-completed' | null;
  IS_ACTIVE_ENROLLMENT: boolean | null;
  COURSE_SLUG: string | null;
  // Certificate columns
  CERT_KEY: string | null;
  CERT_IDENTIFIER: string | null;
  ISSUED_TS: string | null;
  EXPIRATION_DATE: string | null;
  DOWNLOAD_URL: string | null;
}

/**
 * A Linux Foundation certification earned by the user
 */
export interface Certification {
  /** Unique record identifier (_KEY) */
  id: string;
  /** Certificate identifier (from IDENTIFIER column) */
  certificateId: string;
  /** Full certification/course name */
  name: string;
  /** Description of what the certification covers */
  description: string;
  /** Certification seal/logo image URL */
  imageUrl: string;
  /** Issuing project name */
  issuedBy: string;
  /** ISO date string for when the certification was issued */
  issuedDate: string;
  /** ISO date string for expiry; null means no expiry (perpetual) */
  expiryDate: string | null;
  /** Current certification status, derived from expiryDate */
  status: CertificationStatus;
  /** URL to download the certificate; null if unavailable */
  downloadUrl: string | null;
  /** Difficulty level (e.g. Beginner, Intermediate, Advanced) */
  level: string;
}

/**
 * Snowflake row shape for ANALYTICS.PLATINUM_LFX_ONE.USER_CERTIFICATES
 */
export interface CertificateRow {
  _KEY: string;
  IDENTIFIER: string;
  COURSE_NAME: string;
  COURSE_GROUP_DESCRIPTION: string;
  LOGO_URL: string;
  PROJECT_NAME: string;
  ISSUED_TS: string;
  EXPIRATION_DATE: string | null;
  DOWNLOAD_URL: string | null;
  LEVEL: string;
  COURSE_ID: string | null;
}

/**
 * Snowflake row shape for ANALYTICS.PLATINUM_LFX_ONE.USER_COURSE_ENROLLMENTS
 */
export interface EnrollmentRow {
  ENROLLMENT_ID: string;
  LOGO_URL: string | null;
  COURSE_NAME: string;
  COURSE_GROUP_DESCRIPTION: string | null;
  PROJECT_NAME: string | null;
  LEVEL: string | null;
  COURSE_SLUG: string | null;
  COURSE_ID: string | null;
  STATUS: EnrollmentStatus | null;
  IS_ACTIVE_ENROLLMENT: boolean;
  ENROLLMENT_TS: string | null;
  TOTAL_TIME: number | null;
}

/**
 * A training course the user is currently enrolled in
 */
export interface TrainingEnrollment {
  /** ENROLLMENT_ID */
  id: string;
  /** COURSE_NAME */
  name: string;
  /** COURSE_GROUP_DESCRIPTION */
  description: string;
  /** LOGO_URL */
  imageUrl: string;
  /** PROJECT_NAME */
  issuedBy: string;
  /** Difficulty level (e.g. Beginner, Intermediate, Advanced) */
  level: string;
  /** URL slug for the specific course page; null if unavailable */
  courseSlug: string | null;
  /** Enrollment date; null if not available */
  enrolledDate: string | null;
  /** Time spent on the course in seconds; null if not available */
  totalTime: number | null;
  /** Enrollment progress status from Snowflake */
  status: EnrollmentStatus | null;
  /** Whether the enrollment is currently active */
  isActiveEnrollment: boolean;
}

export type ProductType = typeof TRAINING_PRODUCT_TYPE | typeof CERTIFICATION_PRODUCT_TYPE;
