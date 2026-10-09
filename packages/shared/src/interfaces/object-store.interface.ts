// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The BFF object store: one service, two interchangeable backends. Deployed
// environments talk to a purpose-keyed S3 bucket; a local run with no bucket
// configured gets a folder under the app directory with the same list, get,
// put and metadata behaviour, so hand tests and unit tests persist and
// restore documents with nothing installed and no credentials.

/**
 * Storage purposes — each maps to its own bucket (or, file-backed, its own
 * folder). lfx-one is multi-bucket per the LFX object-store design:
 * - `avatars`: public profile pictures and other CDN-fronted public images.
 * - `marketing-os-artifacts`: private documents for EVERY Marketing OS agent,
 *   key-prefix namespaced per artifact type (dec-brand-kit-storage-v2) — one
 *   bucket, one shared persistence layer (`mktg-artifact.service.ts`).
 */
export type ObjectStorePurpose = 'avatars' | 'marketing-os-artifacts';

/** Which backend serves a purpose — surfaced in logs so a local run says where its documents went. */
export type ObjectStoreBackendKind = 's3' | 'file';

/** One listed object: key plus the store's last-modified stamp (S3 `LastModified`, file mtime). */
export interface ObjectStoreListEntry {
  key: string;
  lastModified?: Date;
}

/** One fetched object: its UTF-8 body and user metadata (S3 `x-amz-meta-*`, or the file sidecar). */
export interface ObjectStoreReadResult {
  body: string;
  metadata: Record<string, string>;
}

/** Everything a write carries besides its key. `body` is a `Uint8Array` so the contract stays Node-free; callers pass a `Buffer`. */
export interface ObjectStorePutInput {
  body: Uint8Array;
  contentType: string;
  cacheControl: string;
  metadata?: Record<string, string>;
}

/**
 * The primitive operations the object-store service orchestrates, bound to
 * ONE purpose (one bucket or one folder). Both backends honour the same
 * contract, which is what lets every caller — avatar upload, the shared
 * Marketing OS artifact layer — run unchanged against either:
 *
 * - `headObject` / `getObject` return `null` ONLY on a confirmed missing
 *   object; any other failure (403, timeout, 5xx, EACCES) throws and is never
 *   masqueraded as "absent".
 * - `listObjects` returns every object under the prefix, paginating or
 *   walking as the backend needs; the service never sees pages.
 * - `ensureBucket` applies the backend's own creation policy (S3: only when
 *   `S3_CREATE_MISSING_BUCKET` is `'true'`; file: always, a folder is cheap)
 *   and reports whether it created anything.
 */
export interface ObjectStoreBackend {
  readonly kind: ObjectStoreBackendKind;
  /** Where this purpose lives — the bucket name or the folder path — for logs only. */
  location(): string;
  /** Lightweight existence probe for health endpoints: true when the bucket/folder is reachable. Never creates. */
  readiness(): Promise<boolean>;
  /** Make the bucket/folder ready for writes per the backend's policy; a confirmed-missing bucket the policy forbids creating rethrows. */
  ensureBucket(): Promise<{ created: boolean }>;
  /** The object's user metadata, or null on a confirmed missing object. */
  headObject(key: string): Promise<Record<string, string> | null>;
  putObject(key: string, input: ObjectStorePutInput): Promise<void>;
  /** The object's UTF-8 body and user metadata, or null on a confirmed missing object. */
  getObject(key: string): Promise<ObjectStoreReadResult | null>;
  listObjects(prefix: string): Promise<ObjectStoreListEntry[]>;
}
