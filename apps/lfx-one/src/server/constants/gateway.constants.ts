// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

/** Timeout in milliseconds for outbound calls to upstream services via the API gateway. */
export const API_GW_TIMEOUT_MS = 30_000;

/** Request header that, sent as `'false'`, makes LF v1 services skip their Redis read cache for that request. */
export const LFX_CACHE_BYPASS_HEADER = 'X-LFX-CACHE';

/** Maximum number of bytes of an upstream error body to include in logs / errors. */
export const UPSTREAM_ERROR_BODY_LIMIT = 500;
