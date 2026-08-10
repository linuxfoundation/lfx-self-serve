// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Server-internal shapes for the committee activity aggregation endpoint (LFXV2-1707) — not part
 * of the public `ActivityEvent` wire contract (`activity-event.interface.ts`). Kept in
 * `@lfx-one/shared` per repo convention (no local interfaces inside `apps/lfx-one/`), mirroring
 * `committee-engagement.internal.interface.ts`'s precedent for the sibling LFXV2-1705 endpoint.
 */

/**
 * Keyset pagination position: the `occurred_at` of the last item on the previous page, plus a
 * stable per-event tiebreaker key (see `eventKey` in `committee-activity.service.ts`) for when
 * multiple events share that exact timestamp — e.g. a batch of documents uploaded in one request
 * all sharing `created_at` to the second. A bare-timestamp cursor would either re-return or
 * permanently drop the other tied events; comparing `(occurred_at, key)` as a compound position
 * does neither.
 */
export interface ActivityPageCursor {
  before: string;
  key: string;
}

/** Parsed, validated query for `GET /api/committees/:uid/activity`, and the options threaded into the service. */
export interface CommitteeActivityQuery {
  /**
   * Inclusive lower bound on `occurred_at`. Enforced in-memory against the merged pool (the
   * correctness guarantee); additionally pushed upstream as `date_from` on several legs as
   * best-effort narrowing only — each leg's upstream `date_field` approximates a multi-field
   * fallback derivation it can't fully represent, so it narrows fetched volume but isn't relied
   * on for correctness. Surveys and notes deliberately opt out of upstream date narrowing
   * entirely — see their per-leg comments in `committee-activity.service.ts` for why.
   */
  since?: string;
  /**
   * Decoded from an incoming `page_token`. Undefined on page 1. `since` is NOT encoded into the
   * cursor — a client that paginates through several pages without resending the same `since` on
   * every request can silently widen the window mid-feed. Not exercised today (the client only
   * ever fetches page 1), but a caller relying on `since` across multiple pages must resend it
   * explicitly on every request.
   */
  cursor?: ActivityPageCursor;
  limit: number;
}

/**
 * Upstream response shape for a committee folder (`GET /committees/:id/folders`) — deliberately a
 * narrower duplicate of `committee.service.ts`'s pre-existing local `CommitteeFolder` (this leg
 * only needs `uid`/`name`/`created_at`/`updated_at` to build an activity row). Consolidating the
 * two into one shared type, and fixing that file's own pre-existing local-interface convention
 * violation, is out of scope for this endpoint — accepted as a known duplication risk rather than
 * expanding this change into an unrelated refactor.
 */
export interface CommitteeActivityFolder {
  uid: string;
  name: string;
  created_at?: string;
  updated_at?: string;
}

/** Upstream response shape for a committee link (`GET /committees/:id/links`). */
export interface CommitteeActivityLink {
  uid: string;
  name: string;
  url?: string;
  created_at?: string;
  updated_at?: string;
}

/** Query-service shape for an indexed `committee_document` (file) resource. */
export interface CommitteeActivityDocumentFile {
  uid: string;
  name: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Query-service projection for an indexed `v1_meeting_attachment` / `v1_past_meeting_attachment`
 * resource — deliberately distinct from `MeetingAttachment`/`PastMeetingAttachment`
 * (`meeting-attachment.interface.ts`), which are documented as aligned with the ITX proxy API
 * response, not the indexer's data schema. The indexer contract
 * (lfx-v2-meeting-service's `docs/indexer-contract.md`, V1 Meeting Attachment /
 * V1 Past Meeting Attachment sections) carries `modified_at`, not `updated_at` — using the ITX
 * shape here silently fell back to `created_at` for every row (LFXV2-3077 review finding).
 */
export interface CommitteeActivityNoteAttachment {
  uid: string;
  meeting_id: string;
  type: 'file' | 'link';
  category?: string;
  name: string;
  link?: string;
  created_at?: string;
  modified_at?: string;
}
