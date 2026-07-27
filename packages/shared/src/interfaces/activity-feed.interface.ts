// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Source kind backing an `ActivityFeedItem`.
 * @description Drives icon + tab-navigation choice in the group Overview activity feed stop-gap.
 */
export type ActivityFeedItemType = 'meeting' | 'past_meeting' | 'vote' | 'survey' | 'document';

/**
 * A single row in the group Overview activity feed stop-gap.
 * @description Normalized shape merged from past meetings, votes, surveys, and documents — sorted by
 * `timestamp` desc. Upcoming meetings ('meeting') are a reserved variant, not currently emitted: they're
 * future-dated and already covered by the "Next Meeting" card. Replaced by the real activity stream in
 * LFXV2-1707.
 */
export interface ActivityFeedItem {
  /** Source kind, drives the icon and default styling */
  type: ActivityFeedItemType;
  /** Stable key for `@for` tracking (source type + source uid) */
  key: string;
  /** Rendered row text, e.g. "Meeting scheduled: Weekly Sync" */
  label: string;
  /** ISO timestamp used for sorting */
  timestamp: string;
  /** Font Awesome icon class */
  icon: string;
  /** Tab-navigation context string passed to the existing `tab:context` handler, e.g. "meetings:upcoming" */
  tab: string;
}
