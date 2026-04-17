// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FoundationHealthScoreDistributionResponse } from './analytics-data.interface';

/** Row in the "My Foundations and Projects" table */
export interface PersonaProjectRow {
  projectUid: string;
  projectSlug: string;
  projectName: string;
  logoUrl: string | null;
  /** Whether this row represents a foundation or a sub-project */
  type: 'foundation' | 'project';
  /** Descriptive subtitle: "N projects · N members" for foundations, parent foundation name for projects */
  subtitle: string;
  /** Highest-priority role from detections: "Board Member", "Maintainer", "Chair", etc. */
  role: string;
  /** Health status for foundations (null for projects) */
  healthStatus: 'on-track' | 'watch' | 'needs-attention' | null;
  /** Health detail text for foundations (null for projects) */
  healthDetail: string | null;
  /** Voting status from board_member detections, null if not applicable */
  votingStatus: string | null;
}

/** Summary pills data */
export interface DashboardSummaryPills {
  openSurveys: number;
  meetingsCompletedThisWeek: number;
  meetingsUpcomingThisWeek: number;
  itemsNeedReview: number;
}

/** Role group for dashboard role summary display */
export interface RoleGroup {
  label: string;
  names: string[];
  /** Pre-formatted name list for display (e.g. "CNCF, TLF and OpenSSF") */
  formattedNames: string;
}

/** Typed shape of the board_member detection extra payload from persona service */
export interface BoardMemberDetectionExtra {
  committee_uid: string;
  committee_name: string;
  committee_member_uid: string;
  role: string;
  voting_status: string;
  organization: {
    id: string;
    name: string;
    website?: string;
  };
}

/** Typed shape of the committee_member detection extra payload from persona service */
export interface CommitteeMemberDetectionExtra {
  committee_uid: string;
  committee_name: string;
  committee_member_uid: string;
  role: string;
}

/** Per-foundation analytics data returned by multi-foundation summary endpoint */
export interface PerFoundationAnalytics {
  totalProjects: number;
  totalMembers: number;
  totalValue: number;
  healthScores: FoundationHealthScoreDistributionResponse;
}

/** Response from GET /api/analytics/multi-foundation-summary */
export interface MultiFoundationSummaryResponse {
  aggregated: {
    totalValue: number;
    totalProjects: number;
    totalMembers: number;
  };
  perFoundation: Record<string, PerFoundationAnalytics>;
}
