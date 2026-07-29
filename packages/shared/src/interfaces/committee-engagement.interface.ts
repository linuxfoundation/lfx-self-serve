// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS } from '../constants/committee-engagement.constants';

/** Time window a committee-engagement request/response is scoped to. */
export type CommitteeEngagementWindow = (typeof COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS)[number];

/** Engagement tier derived in the BFF from the member's attendance rate. */
export type CommitteeEngagementClassification = 'High' | 'Medium' | 'Low' | 'Inactive';

/** Per-member attendance rollup for a single committee + window. */
export interface CommitteeMemberEngagement {
  /** `CommitteeMember.uid` this row corresponds to. */
  uid: string;
  /** Meetings attended within the window. */
  attended: number;
  /** Meetings the member was invited to within the window. */
  invited: number;
  /** `attended / invited`, 0 when `invited` is 0, rounded to 2 decimal places. */
  rate: number;
  classification: CommitteeEngagementClassification;
}

/** Aggregate stats for `GET /api/committees/:uid/engagement`. */
export interface CommitteeEngagementSummary {
  /** `sum(attended) / sum(invited)` across the full committee roster, 0 when nobody was invited. */
  attendance_rate: number;
  /** Members classified High or Medium. */
  active_count: number;
  /** Full committee roster size (including members with no engagement data). */
  total_count: number;
  /** Members classified Low. */
  at_risk_count: number;
}

/** Response body for `GET /api/committees/:uid/engagement`. */
export interface CommitteeEngagementResponse {
  members: CommitteeMemberEngagement[];
  summary: CommitteeEngagementSummary;
  /** ISO timestamp the warehouse model last computed this data; `null` before the model has emitted any rows. */
  computed_at: string | null;
}
