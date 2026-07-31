// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Server-internal shapes for the committee activity aggregation endpoint (LFXV2-1707) — not part
 * of the public `ActivityEvent` wire contract (`activity-event.interface.ts`). Kept in
 * `@lfx-one/shared` per repo convention (no local interfaces inside `apps/lfx-one/`), mirroring
 * `committee-engagement.internal.interface.ts`'s precedent for the sibling LFXV2-1705 endpoint.
 */

/** Parsed, validated query for `GET /api/committees/:uid/activity`, and the options threaded into the service. */
export interface CommitteeActivityQuery {
  /** Inclusive lower bound on `occurred_at`, applied as `date_from` on every source that supports it. */
  since?: string;
  /** Exclusive upper bound on `occurred_at`, decoded from an incoming `page_token`. Undefined on page 1. */
  before?: string;
  limit: number;
}

/** Shape encoded into the opaque `page_token` string — see `encodeActivityPageToken` in `committee-activity-query.helper.ts`. */
export interface ActivityPageTokenPayload {
  before: string;
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
