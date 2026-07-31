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
   * correctness guarantee); additionally pushed upstream as `date_from` on all four legs as
   * best-effort narrowing only — each leg's upstream `date_field` approximates a multi-field
   * fallback derivation it can't fully represent, so it narrows fetched volume but isn't relied
   * on for correctness. See the per-leg comments in `committee-activity.service.ts`.
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
