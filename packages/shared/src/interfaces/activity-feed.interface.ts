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
  /** From the source event's own payload — see `MeetingHeldActivityEvent.payload.password`'s doc comment for why this isn't re-hydrated client-side. */
  password: string | null;
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

/**
 * View-model for the meeting-type/duration chip rendered on `past_meeting` activity rows in the
 * committee Overview "Recent Activity" widget — distinguishes otherwise-identical rows from the
 * same recurring series (LFXV2-3009). `null` from the deriving method means "don't render a chip"
 * (not a `past_meeting` row, or its `action.meetingId` has no match in the current `pastMeetings()`
 * fetch window) — the row falls back to today's label+timestamp-only rendering, no placeholder.
 */
export interface ActivityMeetingBadge {
  /** e.g. "Technical · 45m", or just "Technical" when duration is falsy */
  label: string;
  /** Font Awesome icon class from `MeetingTypeConfig.icon` */
  icon: string;
}

/**
 * Precomputed display view-model for one row of the committee Overview "Recent Activity" widget.
 * Wraps an `ActivityFeedItem` with its formatted timestamp/tooltip/badge fields, computed once per
 * `activityItems()`/`pastMeetings()` change rather than via template method calls (repo rule:
 * `docs/reviews/frontend-checklist.md` §4 — only signal reads, computed values, and pipes allowed
 * in templates, no methods that execute formatting/lookup logic). Mirrors `MyGroupsCardVm`'s
 * entity-plus-precomputed-fields shape (`committee.interface.ts`).
 */
export interface ActivityFeedRow {
  item: ActivityFeedItem;
  /** e.g. "3 days ago" — see `formatRelativeTime` */
  timestampLabel: string;
  /** `item.label` plus an absolute date, for the row's `[title]` tooltip */
  tooltip: string;
  /** `null` when `item` isn't a `past_meeting` row, or its meeting has no match in `pastMeetings()` */
  meetingBadge: ActivityMeetingBadge | null;
}
