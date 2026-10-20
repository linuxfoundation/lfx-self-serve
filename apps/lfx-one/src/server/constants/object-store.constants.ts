// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ObjectStorePurpose } from '@lfx-one/shared/interfaces';

/**
 * Env var naming the S3 bucket for each storage purpose. A purpose whose var
 * is set is served by S3. One whose var is unset falls back to the file-backed
 * store only when `OBJECT_STORE_PURPOSE_FILE_FALLBACK` allows it and the
 * server is not under `NODE_ENV=production`; otherwise the var is required.
 */
export const OBJECT_STORE_PURPOSE_BUCKET_ENV: Record<ObjectStorePurpose, string> = {
  avatars: 'S3_BUCKET',
  'marketing-os-artifacts': 'MARKETING_OS_ARTIFACTS_S3_BUCKET',
};

/**
 * Whether a purpose with no bucket configured may be served from the
 * file-backed store (outside `NODE_ENV=production`, which never falls back).
 *
 * Only PRIVATE purposes qualify. `marketing-os-artifacts` documents are read
 * back through the BFF, so a folder stands in for the bucket completely.
 * `avatars` objects are public and CDN-fronted: the service stores the
 * `CDN_URL_PREFIX` URL, not the bytes, so a file on disk would leave a stored
 * URL pointing at nothing. That purpose keeps its bucket var required, as
 * before the file backend existed.
 */
export const OBJECT_STORE_PURPOSE_FILE_FALLBACK: Record<ObjectStorePurpose, boolean> = {
  avatars: false,
  'marketing-os-artifacts': true,
};

/**
 * Env var overriding where the file-backed store keeps its objects. Relative
 * paths resolve against the server's working directory, which is the app
 * folder (`apps/lfx-one`) for every repo-run command (`yarn start`, `yarn
 * test:server`, `node dist/lfx-one/server/server.mjs`).
 */
export const OBJECT_STORE_LOCAL_DIR_ENV = 'OBJECT_STORE_LOCAL_DIR';

/**
 * Default root of the file-backed store, relative to the app folder:
 * `apps/lfx-one/.object-store/<purpose>/<key>`. Gitignored — local hand-test
 * output lives here and is never committed.
 */
export const OBJECT_STORE_LOCAL_DEFAULT_DIR = '.object-store';

/**
 * Suffix of the per-object sidecar the file backend writes next to each body
 * (`<key>.meta.json`) to carry what S3 keeps as object headers: content type,
 * cache control and user metadata. Listings skip files with this suffix, and
 * a key that ends in it is refused so a document can never shadow a sidecar.
 */
export const OBJECT_STORE_FILE_METADATA_SUFFIX = '.meta.json';

/**
 * Suffix of the in-flight file the file backend writes next to its target
 * (`<target>.<uuid>.partial`) and renames into place once every byte is on
 * disk, so a body or sidecar is never observed half-written. One left behind
 * by a crash is garbage: listings skip files with this suffix, and a key that
 * ends in it is refused so a document can never be mistaken for one.
 */
export const OBJECT_STORE_FILE_PARTIAL_SUFFIX = '.partial';
