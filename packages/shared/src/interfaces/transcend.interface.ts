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

/**
 * A tracking purpose's resolved consent in `airgap.getConsent().purposes`: `true` confirmed consent,
 * `false` unconfirmed or opted out, `'Auto'` opted in by default by the visitor's regional experience
 * (never explicitly confirmed). See https://docs.transcend.io/docs/articles/consent-management/reference/api.
 */
export type AirgapPurposeConsent = boolean | 'Auto';

/** `airgap.getConsent()` — the visitor's current tracking consent. */
export interface AirgapConsent {
  purposes: Record<string, AirgapPurposeConsent>;
  /** False when consent was resolved from regional defaults and the visitor has not made a choice. */
  confirmed: boolean;
}

/** Transcend `airgap.js` browser API (`window.airgap`). Only the members LFX calls are typed here. */
export interface AirgapApi {
  getConsent?: () => AirgapConsent;
  /** Post-ready, `airgap` is an EventTarget: `consent-resolution` fires once consent is resolved for the page load. */
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}
