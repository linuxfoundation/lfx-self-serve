// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Source kind backing an `ActivityFeedItem`.
 * @description Drives icon + tab-navigation choice in the committee Overview "Recent Activity" widget.
 */
export type ActivityFeedItemType = 'meeting' | 'past_meeting' | 'vote' | 'survey' | 'document';

/**
 * What clicking an `ActivityFeedItem` does — a discriminated union so each source's action is
 * explicit and type-checked, rather than overloading a single field to mean different things
 * (navigate a route, open a drawer, open an external link) depending on `type`. Semantic variants
 * (`past-meeting`, not a baked `{ kind: 'route'; path: string }`) so `packages/shared` doesn't carry
 * app route strings — the component maps each kind to wherever that surface actually lives, which
 * survives route refactors independent of this contract.
 */
export interface PastMeetingActivityFeedAction {
  kind: 'past-meeting';
  meetingId: string;
}

export interface VoteDrawerActivityFeedAction {
  kind: 'vote-drawer';
  voteUid: string;
}

export interface SurveyDrawerActivityFeedAction {
  kind: 'survey-drawer';
  surveyUid: string;
}

export interface ExternalUrlActivityFeedAction {
  kind: 'external-url';
  url: string;
}

export interface TabActivityFeedAction {
  kind: 'tab';
  tab: string;
}

export type ActivityFeedAction =
  | PastMeetingActivityFeedAction
  | VoteDrawerActivityFeedAction
  | SurveyDrawerActivityFeedAction
  | ExternalUrlActivityFeedAction
  | TabActivityFeedAction;

/**
 * A single row in the committee Overview "Recent Activity" widget — the UI view-model produced by
 * `mapActivityEventsToFeedItems` (`../utils/activity-feed.utils`) from the server's `ActivityEvent[]`
 * (`GET /api/committees/:uid/activity`, LFXV2-1707). Upcoming meetings ('meeting') are a reserved
 * variant, not currently emitted: they're future-dated and already covered by the "Next Meeting" card.
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
