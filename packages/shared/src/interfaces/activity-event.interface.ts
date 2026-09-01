// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CommitteeDocumentType } from './committee.interface';

/**
 * Full target lifecycle-event vocabulary for a committee's activity feed (LFXV2-1707). Only
 * `meeting_held`, `vote_opened`/`vote_closed`, `survey_published`/`survey_closed`,
 * `document_uploaded`, and `notes_added` are actually emitted in v1 (aggregation-derived from
 * existing sources: past meetings, votes, surveys, documents, meeting attachments — see
 * `committee-activity.service.ts`). `notes_added` is sourced from `MeetingAttachment` /
 * `PastMeetingAttachment` rows whose `category` is `'Notes'` (LFXV2-3077) — a new aggregation leg,
 * not a filter on the `document_uploaded` leg, since folders/links/`committee_document` files carry
 * no `category` field. `document_deleted`, `member_joined`, and `member_left` (see
 * `DeferredActivityEvent`) remain deferred: no upstream source exists yet (no document-delete
 * tombstone — hard delete, unindexed; no committee-membership history tracking). The union stays
 * complete now so the wire contract doesn't grow a breaking change when a real event log starts
 * emitting them.
 *
 * Derived from `ActivityEvent['type']` (declared below — TypeScript allows forward references
 * between type aliases in the same module) rather than hand-restated, so adding, removing, or
 * renaming a variant in the `ActivityEvent` union can't silently drift out of sync with this type —
 * a hand-written duplicate would still compile even if the two fell out of step.
 */
export type ActivityEventType = ActivityEvent['type'];

interface BaseActivityEvent {
  /** ISO timestamp this event happened at — the feed's sort key. */
  occurred_at: string;
  committee_uid: string;
}

export interface MeetingHeldActivityEvent extends BaseActivityEvent {
  type: 'meeting_held';
  payload: {
    /** Navigation id — matches PastMeeting.id, same field the click action routes to `/meetings/:id` with. */
    meeting_id: string;
    /**
     * `getPastMeetingResourceId(meeting)` (`meeting_and_occurrence_id ?? id`) — distinct from
     * `meeting_id` because a recurring meeting's occurrences share one `meeting_id` but need
     * distinct `@for` tracking keys client-side; using `meeting_id` alone would collide.
     */
    meeting_occurrence_id: string;
    title: string;
    /**
     * Carried here (not re-hydrated client-side from a separate signal) because the activity feed
     * is its own independent, differently-windowed fetch from the Overview page's own
     * `pastMeetings()` signal — a password-protected meeting can appear in one without appearing in
     * the other, which silently dropped the password on navigation (Copilot/Cursor Bugbot/dealako
     * review on PR #1288).
     */
    password: string | null;
  };
}

/**
 * Vote lifecycle payload — shared by both `vote_opened` and `vote_closed`. `status` carries the
 * full upstream `PollStatus` value (not collapsed into the coarse event type) so a client can still
 * render the exact status label ("Vote Disabled: X") the same way the old stop-gap did.
 *
 * `opened_at` (GH-1967 review): this leg collapses each vote to a single event reflecting only its
 * current lifecycle state (`mapVoteToEvent`'s own doc comment) — so once a vote that opened inside
 * some window has since closed, only its close moment is visible via `occurred_at`, and its opening
 * is otherwise unrecoverable. Always populated (from the same row already read to build the rest of
 * this payload) regardless of the event's own type, so a completeness-sensitive caller (e.g.
 * `WeeklyBriefService#withStaleness`) can check it as a second, independent relevance signal
 * alongside `occurred_at` — without changing this leg's one-event-per-vote contract for its
 * original Recent Activity consumer.
 *
 * `end_time` (GH-1967 Copilot review): the vote's scheduled close — the one field upstream's
 * weekly-brief `VoteSource` windows on (`date_field=end_time&date_from=windowStart&date_to=windowEnd`,
 * `vote_source.go`: "we want votes that closed within the window"). Carried so a staleness caller
 * can tell whether a regeneration could include this vote at all — an open moment alone never
 * qualifies a vote upstream, so gating on `opened_at`/`occurred_at` without it flags activity a
 * regenerate could never reflect. Absent when the row has no parseable end_time, which upstream's
 * end_time filter treats as unselectable too.
 */
export interface VoteActivityEventPayload {
  vote_uid: string;
  name: string;
  status: string;
  opened_at?: string;
  end_time?: string;
}

export interface VoteOpenedActivityEvent extends BaseActivityEvent {
  type: 'vote_opened';
  payload: VoteActivityEventPayload;
}

export interface VoteClosedActivityEvent extends BaseActivityEvent {
  type: 'vote_closed';
  payload: VoteActivityEventPayload;
}

/**
 * Survey lifecycle payload — shared by `survey_published` and `survey_closed`, same rationale as
 * votes. `opened_at` (GH-1967 review) is the survey's publish moment, same reasoning as
 * `VoteActivityEventPayload.opened_at` — but keyed on `survey_send_date` (with `created_at` only
 * as a fallback for rows with no send date), NOT bare record creation: ITX's survey API is a
 * schedule API, so a scheduled survey is created before it actually goes out (GH-1967 Copilot
 * review). `cutoff_date` (GH-1967 Copilot review) is
 * `survey_cutoff_date` — the field upstream's weekly-brief `SurveySource` windows on AND requires
 * to have already passed (`survey_source.go` skips unparseable cutoffs and drops
 * `cutoff.After(time.Now())` rows, "excluding surveys still collecting responses") — same
 * staleness-gating role as `VoteActivityEventPayload.end_time`: publication alone never qualifies
 * a survey upstream.
 */
export interface SurveyActivityEventPayload {
  survey_uid: string;
  title: string;
  status: string;
  opened_at?: string;
  cutoff_date?: string;
}

export interface SurveyPublishedActivityEvent extends BaseActivityEvent {
  type: 'survey_published';
  payload: SurveyActivityEventPayload;
}

export interface SurveyClosedActivityEvent extends BaseActivityEvent {
  type: 'survey_closed';
  payload: SurveyActivityEventPayload;
}

export interface DocumentUploadedActivityEvent extends BaseActivityEvent {
  type: 'document_uploaded';
  payload: { document_uid: string; name: string; document_type: CommitteeDocumentType; url?: string };
}

/**
 * Sourced from the query-service projection of `v1_meeting_attachment` / `v1_past_meeting_attachment`
 * rows (`CommitteeActivityNoteAttachment`, `activity-event.internal.interface.ts`) whose `category`
 * is `'Notes'` — see `CommitteeActivityService.fetchNotesAddedEvents` (LFXV2-3077). No `meeting_id`
 * in the payload: nothing consumes it yet, and the only value available from the past-meeting leg
 * (the originating meeting id, not `meeting_and_occurrence_id`) isn't precise enough for a future
 * deep-link — add it back with the right field once a consumer needs it.
 */
export interface NotesAddedActivityEvent extends BaseActivityEvent {
  type: 'notes_added';
  payload: {
    document_uid: string;
    name: string;
    document_type: 'file' | 'link';
    /** Only set for document_type: 'link' — same asymmetry as DocumentUploadedActivityEvent.payload.url. */
    url?: string;
    /**
     * v1_meeting_attachment ('upcoming') vs v1_past_meeting_attachment ('past') — two distinct
     * upstream uid namespaces, same reasoning as document_uploaded's document_type discriminant.
     * Drives eventKey's namespace (committee-activity.service.ts) and the client's tab-routing
     * action (activity-feed.utils.ts).
     *
     * Names the upstream resource type, not a time guarantee: v1_meeting_attachment rows hang off
     * an active meeting record, which keeps existing after its occurrence passes — so a note on a
     * one-off meeting that already happened, or on an ended recurring series, is still 'upcoming'
     * here and still routes to the Meetings tab's upcoming view, which won't contain it. Known,
     * accepted v1 limitation (same "route to the containing tab, not a precise deep link"
     * trade-off document_uploaded already makes for file/folder rows) — not fixed for the same
     * reason those aren't: there's no bounded-call way to know which sub-tab actually holds a
     * given meeting without a per-event follow-up.
     */
    meeting_scope: 'upcoming' | 'past';
  };
}

/**
 * Placeholder variant for the deferred event types — never constructed in v1 (no upstream source
 * exists to populate it). Kept in the union so `ActivityEventType` stays the full target vocabulary
 * without every consumer needing a separate "future type" case.
 */
export interface DeferredActivityEvent extends BaseActivityEvent {
  type: 'document_deleted' | 'member_joined' | 'member_left';
  payload: Record<string, never>;
}

/**
 * A single row in a committee's activity feed (`GET /api/committees/:uid/activity`, LFXV2-1707).
 * Each variant's payload is intentionally entity-shaped (raw fields), not presentation-shaped (no
 * labels/icons/routes) — the client maps `ActivityEvent` -> `ActivityFeedItem` for rendering via
 * `mapActivityEventsToFeedItems` (`../utils/activity-feed.utils`), so this contract stays stable
 * across UI-label or route changes and is what a future real event-log source would also produce.
 */
export type ActivityEvent =
  | MeetingHeldActivityEvent
  | VoteOpenedActivityEvent
  | VoteClosedActivityEvent
  | SurveyPublishedActivityEvent
  | SurveyClosedActivityEvent
  | DocumentUploadedActivityEvent
  | NotesAddedActivityEvent
  | DeferredActivityEvent;
