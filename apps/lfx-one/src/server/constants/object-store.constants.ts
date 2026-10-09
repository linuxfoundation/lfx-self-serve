// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ObjectStorePurpose } from '@lfx-one/shared/interfaces';

/**
 * Env var naming the S3 bucket for each storage purpose. A purpose whose var
 * is set is served by S3; one whose var is unset falls back to the
 * file-backed store (outside `NODE_ENV=production`, where the var is
 * required — deployed environments keep S3).
 */
export const OBJECT_STORE_PURPOSE_BUCKET_ENV: Record<ObjectStorePurpose, string> = {
  avatars: 'S3_BUCKET',
  'marketing-os-artifacts': 'MARKETING_OS_ARTIFACTS_S3_BUCKET',
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
