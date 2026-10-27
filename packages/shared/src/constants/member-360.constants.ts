// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Member360FailureReason, Member360SortColumn } from '../interfaces/member-360.interface';

// Mirrored from marketing-os-agents main 45734bc6, agents/member-360/src/model.ts.
export const CATEGORY_KEYS = ['committees', 'events', 'speaking', 'content', 'community_programs', 'marketing_social'] as const;

/** Category display names, verbatim from the weights table. */
export const CATEGORY_LABELS: Readonly<Record<(typeof CATEGORY_KEYS)[number], string>> = {
  committees: 'Committees & governance',
  events: 'Events',
  speaking: 'Speaking',
  content: 'Content & thought leadership',
  community_programs: 'Community programs',
  marketing_social: 'Marketing engagement & social',
};

export const MEMBER_360_SORT_COLUMNS: Member360SortColumn[] = [
  { key: 'rank', label: '#' },
  { key: 'member_organization', label: 'Member' },
  { key: 'engagement_tier', label: 'Tier' },
  { key: 'engagement_score', label: 'Score' },
  { key: null, label: 'Six categories' },
  { key: 'trend', label: 'Trend' },
  { key: 'days_to_renewal', label: 'Renewal' },
  { key: 'recommended_next_action', label: 'Next action' },
  { key: 'action_owner', label: 'Owner' },
  { key: 'priority', label: 'Priority' },
];

/** Default weights (percent), verbatim from the weights table; sum to 100. */
export const DEFAULT_WEIGHTS: Readonly<Record<(typeof CATEGORY_KEYS)[number], number>> = {
  committees: 20,
  events: 20,
  speaking: 15,
  content: 15,
  community_programs: 10,
  marketing_social: 20,
};

export const ENGAGEMENT_TIERS = ['Champion', 'Engaged', 'Passive', 'At Risk', 'Dormant'] as const;
/** Shared by the workbook and the result page's renewal/tier presentation. */
export const MEMBER_360_RENEWAL_RED_DAYS = 120;
export const MEMBER_360_RENEWAL_AMBER_DAYS = 240;
export const MEMBER_360_TIER_TONES = {
  Champion: 'emerald',
  Engaged: 'emerald',
  Passive: 'amber',
  'At Risk': 'red',
  Dormant: 'red',
} as const;
export const ACTION_OWNERS = ['Marketing', 'Member Success', 'Sales'] as const;
export const MEMBER_360_TIER_OPTIONS = [{ label: 'All', value: '' }, ...ENGAGEMENT_TIERS.map((value) => ({ label: value, value }))];
export const MEMBER_360_OWNER_OPTIONS = [{ label: 'All', value: '' }, ...ACTION_OWNERS.map((value) => ({ label: value, value }))];
export const PRIORITIES = ['High', 'Medium', 'Low'] as const;
export const DATA_SOURCES = ['lfx_platform', 'uploaded_trackers', 'hubspot', 'social_listening', 'web_research', 'google_drive'] as const;
export const SCOPE_WARNINGS = ['all_lf_requested'] as const;
export const CATEGORY_SCORE_KEYS = Object.fromEntries(CATEGORY_KEYS.map((k) => [k, `${k}_score`])) as Record<
  (typeof CATEGORY_KEYS)[number],
  `${(typeof CATEGORY_KEYS)[number]}_score`
>;
export const MEMBER_360_COMPARISON_UNAVAILABLE = 'MEMBER_360_COMPARISON_UNAVAILABLE';
export const MEMBER_360_INVALID_RESULT = 'MEMBER_360_INVALID_RESULT';
export const MEMBER_360_FAILURE_MESSAGE_MAX_CHARS = 600;
export const MEMBER_360_FAILURE_MESSAGE = 'The run ended without a Member 360 result.';
export const MEMBER_360_STOPPED_MESSAGE = 'The agent stopped before producing a result.';
export const MEMBER_360_ACCESS_REFUSAL_REGEX = /\b(?:no entitled project|entitlement (?:check )?(?:denied|reports no)|not entitled|scope[\s_-]*guard)\b/i;
export const MEMBER_360_FAILURE_MESSAGES: Readonly<Record<Member360FailureReason, string>> = {
  no_edit_access: "Member 360 couldn't run: your account doesn't have edit access to this project's member data.",
  agent_stopped: "Member 360 couldn't finish this run.",
};
export const MEMBER_360_TRACKER_TYPE_ERROR = 'Only .xlsx or .csv trackers can be uploaded.';
export const MEMBER_360_TRACKER_FILENAME_ERROR = 'Use a shorter file name without slashes.';
export const MEMBER_360_TRACKER_EXTENSION_REGEX = /\.(csv|xlsx)$/i;
export const MEMBER_360_CONTRACT_ID = 'member-360-output/v1';
export const MEMBER_360_FINALIZE_TOOL = 'finalize_member_360';
/** Agent 2.1.1 compactFinalizeRequest receipt. */
export const MEMBER_360_FINALIZE_RECEIPT_ID = 'member-360-finalize/v1';
/** Byte-exact agent partial-run summary prefix (checkpoint-batch.ts / partial-run.ts). */
export const MEMBER_360_PARTIAL_SUMMARY_PREFIX = 'Partial report.';
export const MEMBER_360_QUESTIONS_MARKER = 'member-360-questions/v1';
export const MEMBER_360_API = '/api/mktg-agents/member-360';
export const MEMBER_360_MAX_BYTES = 5 * 1024 * 1024;
export const MEMBER_360_MAX_TRACKERS = 10;
export const MEMBER_360_MAX_TRACKER_ROWS = 2000;
export const MEMBER_360_MAX_TRACKER_COLUMNS = 100;
export const MEMBER_360_TRACKER_FILENAME_HEADER = 'X-File-Name';
export const MEMBER_360_TRACKER_FILENAME_REGEX = /^[^\r\n/\\]{1,200}\.(csv|xlsx)$/i;
export const MEMBER_360_CONTACT_PLACEHOLDERS = ['tbd', 'n/a', 'none', 'unknown', 'not available', 'not provided'] as const;
export const MEMBER_360_REDACTED_SUMMARY =
  'Member 360 analysis is available in the ranking, team actions, evidence and method sections. Contact details have been removed from this stored run.';
/** Bound ZIP metadata and actual inflated bytes before ExcelJS parses XML. */
export const MEMBER_360_MAX_ZIP_ENTRIES = 1000;
export const MEMBER_360_WORKBOOK_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/**
 * Live 21-member runs take 5–6 minutes; a 291-member run remained active past 10.
 * Work scales with members and reads. Two hours exceeds plausible run time, stays
 * inside the 24-hour pending TTL, and only stops polling sessions Guild never closes.
 */
export const MEMBER_360_RUN_CEILING_MS = 7_200_000;
/** Slower polling while the run waits for the user's answers. */
export const MEMBER_360_NEEDS_INPUT_POLL_INTERVAL_MS = 30_000;
export const MEMBER_360_TRACKER_KINDS = ['event_sponsors', 'attendees', 'speaking', 'ambassadors', 'content', 'webinars', 'other'] as const;
export const MEMBER_360_HEAT_ORDER = ['events', 'speaking', 'community_programs', 'committees', 'content', 'marketing_social'] as const;
export const MEMBER_360_WINDOW_OPTIONS = [
  { label: 'Trailing 12 months, recent quarter emphasised (default)', value: '12' },
  { label: 'Trailing 6 months', value: '6' },
  { label: 'Calendar year', value: 'year' },
] as const;
export const MEMBER_360_RANKING_COLUMNS = [
  ['Rank', 'rank'],
  ['Member Organization', 'member_organization'],
  ['Membership Tier', 'membership_tier'],
  ['Annual Value', 'annual_value'],
  ['Renewal Date', 'renewal_date'],
  ['Days to Renewal', 'days_to_renewal'],
  ['Engagement Score', 'engagement_score'],
  ['Engagement Tier', 'engagement_tier'],
  ['Trend', 'trend'],
  ['Committees Score', 'committees_score'],
  ['Events Score', 'events_score'],
  ['Speaking Score', 'speaking_score'],
  ['Content Score', 'content_score'],
  ['Community Programs Score', 'community_programs_score'],
  ['Marketing & Social Score', 'marketing_social_score'],
  ['Last Meaningful Engagement', 'last_meaningful_engagement'],
  ['Engaged Contacts', 'engaged_contacts'],
  ['Top Gaps', 'top_gaps'],
  ['Recommended Next Action', 'recommended_next_action'],
  ['Action Owner', 'action_owner'],
  ['Priority', 'priority'],
] as const;
export const MEMBER_360_INTRO = 'Choose a window and add any trackers you have; it reads LFX, searches the web and ranks every member with one next action.';
