// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// ---------------------------------------------------------------------------
// Reddit Ads — Server-Only Constants
// ---------------------------------------------------------------------------

export const REDDIT_ACCOUNTS: readonly { accountId: string; label: string }[] = [{ accountId: '', label: 'The Linux Foundation' }] as const;

export const REDDIT_REQUEST_TIMEOUT_MS = 30_000;

export const REDDIT_REPORT_POLL_INTERVAL_MS = 3_000;
export const REDDIT_REPORT_MAX_POLLS = 20;

export const REDDIT_TOKEN_EXPIRY_BUFFER_SECONDS = 60;

export const REDDIT_METRICS = ['impressions', 'clicks', 'spend', 'conversions', 'ctr', 'ecpm', 'ecpc'] as const;
