// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// ---------------------------------------------------------------------------
// Reddit Ads — Server-Only Constants
// ---------------------------------------------------------------------------

export const REDDIT_ACCOUNTS: readonly { accountId: string; label: string }[] = [{ accountId: 't2_gv9wtbfa', label: 'The Linux Foundation' }] as const;

export const REDDIT_REQUEST_TIMEOUT_MS = 30_000;

export const REDDIT_TOKEN_EXPIRY_BUFFER_SECONDS = 60;
