// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Certification status derived from expiration date
 */
export type CertificationStatus = 'active' | 'expired';

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
}

/**
 * Snowflake row shape for ANALYTICS.PLATINUM_LFX_ONE.USER_COURSE_ENROLLMENTS
 */
export interface EnrollmentRow {
  ENROLLMENT_ID: string;
  ENROLLMENT_TS: string;
  LOGO_URL: string | null;
  COURSE_NAME: string;
  COURSE_GROUP_DESCRIPTION: string | null;
  PROJECT_NAME: string | null;
  LEVEL: string | null;
  COURSE_SLUG: string | null;
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
  /** ENROLLMENT_TS (ISO string) */
  enrolledDate: string;
  /** Difficulty level (e.g. Beginner, Intermediate, Advanced) */
  level: string;
  /** URL slug for the specific course page; null if unavailable */
  courseSlug: string | null;
}
