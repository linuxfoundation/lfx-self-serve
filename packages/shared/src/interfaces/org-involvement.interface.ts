// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Foundation entry in the org foundation coverage response. */
export interface OrgFoundationCoverageFoundation {
  foundationId: string;
  foundationSlug: string;
  foundationName: string;
}

/** GET /api/analytics/org-foundation-coverage — how many LF foundations this organization is involved in. */
export interface OrgFoundationCoverageResponse {
  accountId: string;
  foundationCount: number;
  foundations: OrgFoundationCoverageFoundation[];
}

/** GET /api/analytics/org-involvement-contributors-monthly — cross-foundation active contributors (12-month window). */
export interface OrgInvolvementContributorsMonthlyResponse {
  accountId: string;
  totalActiveContributors: number;
  monthlyData: number[];
  monthlyLabels: string[];
}

/** GET /api/analytics/org-involvement-maintainers-monthly — cross-foundation maintainers (12-month window). */
export interface OrgInvolvementMaintainersMonthlyResponse {
  accountId: string;
  accountName: string;
  totalMaintainersYearly: number;
  totalProjectsYearly: number;
  monthlyData: number[];
  monthlyLabels: string[];
}

/** GET /api/analytics/org-involvement-event-attendance-monthly — cross-foundation event attendance (12-month window). */
export interface OrgInvolvementEventAttendanceMonthlyResponse {
  accountId: string;
  accountName: string;
  totalAttended: number;
  totalSpeakers: number;
  attendeesMonthlyData: number[];
  speakersMonthlyData: number[];
  monthlyLabels: string[];
}

/** GET /api/analytics/org-involvement-certified-employees-monthly — cross-foundation certified employees (12-month window). */
export interface OrgInvolvementCertifiedEmployeesMonthlyResponse {
  accountId: string;
  totalCertifications: number;
  totalCertifiedEmployees: number;
  monthlyData: number[];
  monthlyLabels: string[];
}

/** Daily data point for training enrollments. */
export interface OrgTrainingEnrollmentDailyDataPoint {
  date: string;
  count: number;
  cumulativeCount: number;
}

/** GET /api/analytics/org-involvement-training-enrollments — cross-foundation training enrollments YTD (daily grain). */
export interface OrgTrainingEnrollmentsResponse {
  accountId: string;
  totalEnrollments: number;
  dailyData: OrgTrainingEnrollmentDailyDataPoint[];
}
