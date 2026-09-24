// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Bottom gutter under the scrolling pane — the gate shell's own `p-6`, so the page itself stays put. */
export const HEALTH_METRICS_L2_PANES_BOTTOM_GUTTER_PX = 24;

/** Floor for the measured pane height, so a short viewport still scrolls rather than collapsing. */
export const HEALTH_METRICS_L2_PANES_MIN_HEIGHT_PX = 320;

/**
 * How long a deep link's section key stays armed for its post-data re-scroll, re-armed per read.
 * Sized at roughly double the server's ~15s worst-case budget for one read, leaving room for
 * hydration and the network on top, so a slow-but-healthy read still lands its scroll.
 */
export const HEALTH_METRICS_L2_PENDING_SECTION_TTL_MS = 30_000;

/** Keys that scroll the document. A keystroke outside this set is not the reader leaving a deep link. */
export const HEALTH_METRICS_L2_SCROLL_KEYS: readonly string[] = [' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'];
