// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Optional capture tweaks for `downloadCardAsImage`. */
export interface DownloadCardOptions {
  /** Canvas background color (default: transparent) — multi-panel dashboards want an explicit one so the page background doesn't show through. */
  backgroundColor?: string;
}
