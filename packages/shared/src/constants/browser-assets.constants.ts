// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** One miss sample per middleware instance, shared across every asset and caller. */
export const BROWSER_ASSET_MISS_LOG_INTERVAL_MS = 30_000;

/** Maximum decoded pathname length included in a browser_asset_miss event. */
export const BROWSER_ASSET_MISS_LOG_PATH_MAX_LENGTH = 160;
