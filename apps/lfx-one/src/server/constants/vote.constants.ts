// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Max concurrent summary emails sent per vote (#3662) — upstream email-service has no batch-send endpoint. */
export const VOTE_SUMMARY_EMAIL_CONCURRENCY = 10;

/** Wall-clock budget for the whole on-demand summary send (#3662) — bounds a large recipient list to a handful of batches rather than holding the request open indefinitely. */
export const VOTE_SUMMARY_EMAIL_SEND_BUDGET_MS = 20_000;
