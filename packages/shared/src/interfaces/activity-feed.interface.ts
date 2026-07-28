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
 * What clicking an `ActivityFeedItem` does — a discriminated union so each source's action is
 * explicit and type-checked, rather than overloading a single field to mean different things
 * (navigate a tab, open a drawer, open an external link) depending on `type`.
 */
export type ActivityFeedAction =
  | { kind: 'route'; path: string }
  | { kind: 'vote-drawer'; voteUid: string }
  | { kind: 'survey-drawer'; surveyUid: string }
  | { kind: 'external-url'; url: string }
  | { kind: 'tab'; tab: string };

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
  /** What clicking this row does — see `ActivityFeedAction` */
  action: ActivityFeedAction;
}

export interface BuildActivityFeedInput {
  pastMeetings: PastMeeting[];
  votes: Vote[];
  surveys: Survey[];
  documents: CommitteeDocument[];
  /**
   * Vote items are excluded entirely when false, so the feed doesn't surface vote activity for a
   * committee that has voting disabled — matching the Votes tab itself being hidden in that state.
   * (A clicked vote row opens VoteResultsDrawer in place, not the Votes tab, so this is a content
   * decision rather than a dead-end-navigation guard.) This only affects the activity feed itself;
   * the committee-overview "My Pending Actions" / "Active Votes" surfaces read `votes()` independently
   * and are unaffected by this flag — see committee-overview.component.ts.
   */
  votingEnabled: boolean;
}
