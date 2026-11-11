// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface OrgLensMembershipSummaryRow {
  ACCOUNT_ID: string;
  FOUNDATION_ID: string;
  FOUNDATION_NAME: string;
  FOUNDATION_SLUG: string | null;
  FOUNDATION_LOGO_URL: string | null;
  MEMBERSHIP_TIER_DISPLAY_NAME: string;
  TIER_START_DATE: string | null;
  TIER_END_DATE: string | null;
  FIRST_MEMBERSHIP_STARTED_AT: string | null;
  BOARD_MEMBER_SEAT_COUNT: number;
  COMMITTEE_MEMBER_SEAT_COUNT: number;
  /** The seat holders' person keys, read only for a family roll-up's Governance Roles card; never returned to the client. */
  BOARD_MEMBER_SEAT_KEYS?: string[];
  COMMITTEE_MEMBER_SEAT_KEYS?: string[];
  ORG_PROJECTS_COUNT: number;
  PROJECT_COUNT: number;
  MEMBER_COUNT: number;
  IS_RENEWING_WITHIN_90_DAYS: boolean;
}

export interface OrgLensExpiredMembershipRow {
  ACCOUNT_ID?: string;
  FOUNDATION_ID: string;
  FOUNDATION_NAME: string;
  FOUNDATION_SLUG: string | null;
  FOUNDATION_LOGO_URL: string | null;
  MEMBERSHIP_TIER_DISPLAY_NAME: string;
  TIER_START_DATE: string | null;
  TIER_END_DATE: string | null;
  EXPIRATION_DATE: string | null;
  ACTION_TYPE: 'renew' | 'contact';
}

export interface OrgLensDiscoverMembershipRow {
  ACCOUNT_ID?: string;
  FOUNDATION_ID: string;
  FOUNDATION_NAME: string;
  FOUNDATION_SLUG: string | null;
  FOUNDATION_LOGO_URL: string | null;
  PROJECT_TYPE: string | null;
  SUGGESTED_TIER: string | null;
  CONTRIBUTORS_COUNT: number;
  CONTRIBUTION_COUNT: number;
  RELEVANT_PROJECTS: number;
}
