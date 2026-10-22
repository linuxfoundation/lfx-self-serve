// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Query parameter prefix allowed through to analytics vendors. Every other query parameter is
 * stripped so secrets carried in URLs (meeting passcodes, invite tokens) never leave the browser.
 * Matched case-sensitively.
 */
export const ANALYTICS_ALLOWED_QUERY_PARAM_PREFIX = 'utm_';

/**
 * URL-bearing fields the Segment event sanitizer rewrites in `context.page` and `properties`.
 */
export const ANALYTICS_URL_FIELDS = ['url', 'search', 'path', 'referrer'] as const;

/**
 * Base used only to parse relative URLs. The shared package cannot read `window.location`, and the
 * reserved `.invalid` TLD guarantees the base never appears in a sanitized result.
 */
export const ANALYTICS_URL_PARSE_BASE = 'https://analytics-url.invalid';
