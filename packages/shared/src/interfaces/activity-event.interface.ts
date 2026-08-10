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
 */
export interface VoteActivityEventPayload {
  vote_uid: string;
  name: string;
  status: string;
}

export interface VoteOpenedActivityEvent extends BaseActivityEvent {
  type: 'vote_opened';
  payload: VoteActivityEventPayload;
}

export interface VoteClosedActivityEvent extends BaseActivityEvent {
  type: 'vote_closed';
  payload: VoteActivityEventPayload;
}

/** Survey lifecycle payload — shared by `survey_published` and `survey_closed`, same rationale as votes. */
export interface SurveyActivityEventPayload {
  survey_uid: string;
  title: string;
  status: string;
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
 * Sourced from `MeetingAttachment` (`v1_meeting_attachment`) / `PastMeetingAttachment`
 * (`v1_past_meeting_attachment`) rows whose `category` is `'Notes'` — see
 * `CommitteeActivityService.fetchNotesAddedEvents` (LFXV2-3077).
 */
export interface NotesAddedActivityEvent extends BaseActivityEvent {
  type: 'notes_added';
  payload: {
    document_uid: string;
    name: string;
    document_type: 'file' | 'link';
    /** Only set for document_type: 'link' — same asymmetry as DocumentUploadedActivityEvent.payload.url. */
    url?: string;
    meeting_id: string;
    /**
     * v1_meeting_attachment ('upcoming') vs v1_past_meeting_attachment ('past') — two distinct
     * upstream uid namespaces, same reasoning as document_uploaded's document_type discriminant.
     * Drives eventKey's namespace (committee-activity.service.ts) and the client's tab-routing
     * action (activity-feed.utils.ts).
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
