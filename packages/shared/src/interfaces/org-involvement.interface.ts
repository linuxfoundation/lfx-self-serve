// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Foundation entry in the org foundation coverage response
 */
export interface OrgFoundationCoverageFoundation {
  foundationId: string;
  foundationSlug: string;
  foundationName: string;
}

/**
 * GET /api/analytics/org-foundation-coverage
 * How many LF foundations this organization is involved in
 */
export interface OrgFoundationCoverageResponse {
  accountId: string;
  foundationCount: number;
  foundations: OrgFoundationCoverageFoundation[];
}

/**
 * GET /api/analytics/org-contributors-monthly
 * Cross-foundation active contributors aggregated monthly (12-month window)
 */
export interface OrgInvolvementContributorsMonthlyResponse {
  accountId: string;
  totalActiveContributors: number;
  monthlyData: number[];
  monthlyLabels: string[];
}

/**
 * GET /api/analytics/org-maintainers-monthly
 * Cross-foundation maintainers aggregated monthly (12-month window)
 */
export interface OrgInvolvementMaintainersMonthlyResponse {
  accountId: string;
  accountName: string;
  totalMaintainersYearly: number;
  totalProjectsYearly: number;
  monthlyData: number[];
  monthlyLabels: string[];
}

/**
 * GET /api/analytics/org-event-attendance-monthly
 * Cross-foundation event attendance aggregated monthly (12-month window)
 */
export interface OrgInvolvementEventAttendanceMonthlyResponse {
  accountId: string;
  accountName: string;
  totalAttended: number;
  totalSpeakers: number;
  attendeesMonthlyData: number[];
  speakersMonthlyData: number[];
  monthlyLabels: string[];
}

/**
 * GET /api/analytics/org-certified-employees-monthly
 * Cross-foundation certified employees aggregated monthly (12-month window)
 */
export interface OrgInvolvementCertifiedEmployeesMonthlyResponse {
  accountId: string;
  totalCertifications: number;
  totalCertifiedEmployees: number;
  monthlyData: number[];
  monthlyLabels: string[];
}

/**
 * Daily data point for training enrollments
 */
export interface OrgTrainingEnrollmentDailyDataPoint {
  date: string;
  count: number;
  cumulativeCount: number;
}

/**
 * GET /api/analytics/org-training-enrollments
 * Cross-foundation training enrollments YTD (daily grain)
 */
export interface OrgTrainingEnrollmentsResponse {
  accountId: string;
  totalEnrollments: number;
  dailyData: OrgTrainingEnrollmentDailyDataPoint[];
}
