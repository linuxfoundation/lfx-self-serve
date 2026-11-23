// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Linux Foundation legal pages linked from the app footer's copyright sentence. */
export const FOOTER_LEGAL_LINKS = {
  platformUsage: 'https://www.linuxfoundation.org/legal/platform-use-agreement',
  privacyPolicy: 'https://www.linuxfoundation.org/legal/privacy-policy',
  trademarkUsage: 'https://www.linuxfoundation.org/legal/trademark-usage',
  policies: 'https://www.linuxfoundation.org/legal/policies',
} as const;

/**
 * Class on `<html>` that hides the Transcend consent prompt (`#transcend-consent-manager`) — set by pages
 * that carry their own privacy/terms consent line and a "Cookie settings" link (signed-out newsletter pages).
 */
export const CONSENT_PROMPT_HIDDEN_CLASS = 'lfx-consent-prompt-hidden';
