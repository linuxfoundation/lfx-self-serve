// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Result of checking that the browser dist can serve the HTML shell, the entry script and the global stylesheet. */
export interface BrowserBundleReadiness {
  ready: boolean;
  /** Stable machine-readable reason, set only when `ready` is false. Never contains filesystem paths. */
  reason?: string;
}
