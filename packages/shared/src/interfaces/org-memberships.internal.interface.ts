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
