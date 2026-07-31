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
  /** Inclusive lower bound on `occurred_at`, applied as `date_from` on every source that supports it. */
  since?: string;
  /** Decoded from an incoming `page_token`. Undefined on page 1. */
  cursor?: ActivityPageCursor;
  limit: number;
}

/** Upstream response shape for a committee folder (`GET /committees/:id/folders`). */
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
