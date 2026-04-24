// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Certification status derived from expiration date
 */
export type CertificationStatus = 'active' | 'expired';

export type EnrollmentStatus = 'started' | 'completed' | 'not-started' | 'not-completed';

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
