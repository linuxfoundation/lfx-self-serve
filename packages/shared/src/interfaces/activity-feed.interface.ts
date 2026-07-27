// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CommitteeDocument } from './committee.interface';
import type { PastMeeting } from './meeting.interface';
import type { Vote } from './poll.interface';
import type { Survey } from './survey.interface';

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

export interface BuildActivityFeedInput {
  pastMeetings: PastMeeting[];
  votes: Vote[];
  surveys: Survey[];
  documents: CommitteeDocument[];
  /**
   * Vote items are excluded entirely when false. The Overview activity feed navigates a clicked vote
   * row to the Votes tab, but that tab is hidden when the committee has voting disabled, and
   * tab-navigation only validates against the static valid-tabs list — not tab visibility — so an
   * activity row for a vote from before voting was disabled would otherwise navigate to a hidden,
   * blank tab. This only closes that gap for the activity feed itself; the committee-overview
   * "My Pending Actions" / "Active Votes" surfaces read `votes()` independently and are unaffected by
   * this flag — see committee-overview.component.ts.
   */
  votingEnabled: boolean;
}
