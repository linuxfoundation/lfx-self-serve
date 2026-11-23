// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** One miss sample per middleware instance, shared across every asset and caller. */
export const BROWSER_ASSET_MISS_LOG_INTERVAL_MS = 30_000;

/** Maximum decoded pathname length included in a browser_asset_miss event. */
export const BROWSER_ASSET_MISS_LOG_PATH_MAX_LENGTH = 160;

/** Client shell Angular emits at the browser dist root: `index.csr.html` with SSR on, `index.html` otherwise. */
export const BROWSER_SHELL_FILENAMES = ['index.csr.html', 'index.html'] as const;

/** Entry script every page load needs, emitted at the browser dist root. The hash is optional: only builds with `outputHashing` set (production, staging, dev-cluster) add it. */
export const BROWSER_ENTRY_SCRIPT_PATTERN = /^main(?:-[a-z0-9]{8,})?\.js$/i;

/** Global stylesheet every page load needs, emitted at the browser dist root. The hash is optional, as for the entry script. */
export const BROWSER_ENTRY_STYLE_PATTERN = /^styles(?:-[a-z0-9]{8,})?\.css$/i;
