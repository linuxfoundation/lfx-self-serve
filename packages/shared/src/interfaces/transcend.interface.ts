// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Transcend Consent Manager browser API (`window.transcend`).
 *
 * `airgap.js` (loaded synchronously from `index.html`) defines this object as soon as it loads,
 * and the consent manager UI adds the rest of the API once it has loaded. Only the members LFX
 * calls are typed here.
 */
export interface TranscendApi {
  /** Opens the consent manager so the user can review or change their cookie preferences. */
  showConsentManager?: () => void;
}
