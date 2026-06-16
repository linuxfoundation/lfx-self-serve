// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// ---------------------------------------------------------------------------
// Meta Ads — Server-Only Constants
// ---------------------------------------------------------------------------

export const META_BASE_URL = 'https://graph.facebook.com/v25.0';

export const META_ACCOUNTS: readonly { accountId: string; label: string; pageId: string }[] = [
  { accountId: 'act_193556282970417', label: 'LF Core', pageId: '41911143546' },
] as const;

export const META_REQUEST_TIMEOUT_MS = 30_000;
