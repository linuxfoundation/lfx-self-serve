// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** DOM id of the compact support launcher rendered by the app shell on phone widths. */
export const INTERCOM_CUSTOM_LAUNCHER_ID = 'lfx-support-launcher';

/**
 * CSS selector Intercom binds to open the messenger when the default launcher is hidden. `custom_launcher_selector` is a
 * single boot setting, so it also lists the profile help link (#2986), which the workspace-level selector otherwise owns.
 */
export const INTERCOM_CUSTOM_LAUNCHER_SELECTOR = `#${INTERCOM_CUSTOM_LAUNCHER_ID}, [data-testid="open-profile-banner-link"]`;
