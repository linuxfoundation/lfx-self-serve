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

/** GET /api/analytics/org-involvement-contributors-monthly — active contributors in all projects (lfx-self-serve#4694). */
export interface OrgInvolvementContributorsMonthlyResponse {
  accountId: string;
  totalActiveContributors: number;
  monthlyData: number[];
  monthlyLabels: string[];
}

/** GET /api/analytics/org-involvement-maintainers-monthly — the account's maintainer roles in all projects (lfx-self-serve#4482, #4694). */
export interface OrgInvolvementMaintainersMonthlyResponse {
  accountId: string;
  /**
   * Maintainer roles in all projects overlapping the last 2 years to today — the same count as People -> Contributors at its defaults.
   * `null` when the roles table is unavailable (never shown as zero).
   */
  maintainerRoles: number | null;
  /** Maintainer roles in all projects held in each month, oldest first. */
  monthlyData: number[];
  monthlyLabels: string[];
}

/** GET /api/analytics/org-involvement-event-attendance-monthly — cross-foundation event attendance (12-month window). */
export interface OrgInvolvementEventAttendanceMonthlyResponse {
  accountId: string;
  accountName: string;
  /** Distinct people who registered or attended foundation events over the window — NOT the sum of the monthly points. */
  totalAttended: number;
  /** Distinct accepted speakers over the window — NOT the sum of the monthly points. */
  totalSpeakers: number;
  attendeesMonthlyData: number[];
  speakersMonthlyData: number[];
  monthlyLabels: string[];
}
