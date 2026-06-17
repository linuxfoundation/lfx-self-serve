// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// ---------------------------------------------------------------------------
// Meta Ads — Server-Only Constants
// ---------------------------------------------------------------------------

export const META_BASE_URL = 'https://graph.facebook.com/v25.0';

// Hardcoded rather than externalized to a ConfigMap: LF has a single fixed Meta ad
// account with no multi-tenant routing, and these are public identifiers (not secrets).
// If additional accounts are added, migrate to a runtime ConfigMap for parity with LinkedIn.
export const META_ACCOUNTS: readonly { accountId: string; label: string; pageId: string }[] = [
  { accountId: 'act_193556282970417', label: 'LF Core', pageId: '41911143546' },
] as const;

export const META_REQUEST_TIMEOUT_MS = 30_000;

export const META_ADS_MANAGER_URL = 'https://adsmanager.facebook.com';
