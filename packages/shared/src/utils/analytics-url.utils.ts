// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ANALYTICS_ALLOWED_QUERY_PARAM_PREFIX, ANALYTICS_URL_FIELDS, ANALYTICS_URL_PARSE_BASE } from '../constants/analytics-url.constants';
import type { SegmentEvent, SegmentPageEvent } from '../interfaces/segment.interface';

/**
 * Analytics URL sanitization.
 *
 * Security (linuxfoundation/lfx-self-serve-ops#49, CWE-201): URLs reaching analytics vendors may
 * carry secrets in the query string or hash — meeting passcodes (`?password=`), invite tokens,
 * auth fragments. These helpers enforce an allowlist: only origin + pathname plus `utm_*` query
 * parameters survive, and every hash is dropped. An allowlist (rather than a denylist of known
 * secret keys) keeps future secret parameters from failing open.
 */

/** Strip everything from the first `?` or `#` — the fallback when a URL cannot be parsed. */
function stripQueryAndHash(url: string): string {
  return url.split(/[?#]/)[0];
}

/** Allowlisted query string of a URL, or an empty string when the URL cannot be parsed. */
function sanitizeUrlSearch(url: string): string {
  try {
    return sanitizeAnalyticsSearch(new URL(url, ANALYTICS_URL_PARSE_BASE).search);
  } catch {
    return '';
  }
}

function parseAbsoluteUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Keep only `utm_*` query parameters (case-sensitive prefix).
 * @returns `?` plus the encoded allowlisted params, or an empty string when none survive
 */
export function sanitizeAnalyticsSearch(search: string): string {
  try {
    const kept = new URLSearchParams();
    new URLSearchParams(search.split('#')[0]).forEach((value, key) => {
      if (key.startsWith(ANALYTICS_ALLOWED_QUERY_PARAM_PREFIX)) {
        kept.append(key, value);
      }
    });
    const query = kept.toString();
    return query ? `?${query}` : '';
  } catch {
    return '';
  }
}

/**
 * Sanitize a URL for analytics: keep origin + pathname and allowlisted query params, drop the hash
 * and any userinfo. Absolute input stays absolute; relative input stays relative (resolved against
 * `base` when given). Unparseable input is cut at the first `?` or `#`.
 */
export function sanitizeAnalyticsUrl(url: string, base?: string): string {
  if (!url) {
    return '';
  }

  try {
    const absolute = parseAbsoluteUrl(url);
    if (!absolute) {
      const relative = new URL(url, base ?? ANALYTICS_URL_PARSE_BASE);
      return `${relative.pathname}${sanitizeAnalyticsSearch(relative.search)}`;
    }

    absolute.username = '';
    absolute.password = '';
    absolute.search = sanitizeAnalyticsSearch(absolute.search);
    absolute.hash = '';
    return absolute.href;
  } catch {
    return stripQueryAndHash(url);
  }
}

/**
 * Reduce a URL (absolute or relative) to its pathname. Unparseable input is cut at the first `?` or `#`.
 */
export function sanitizeAnalyticsPath(url: string, base?: string): string {
  if (!url) {
    return '';
  }

  try {
    return new URL(url, base ?? ANALYTICS_URL_PARSE_BASE).pathname;
  } catch {
    return stripQueryAndHash(url);
  }
}

/**
 * Build the page name and explicitly sanitized properties for a route navigation. `search` and
 * `referrer` are always present (possibly empty) so the vendor SDK cannot fill them back in from
 * the raw browser location.
 * @param routerUrl Router URL after redirects
 * @param href Current `window.location.href`
 * @param title Current `document.title`
 * @param referrer Current `document.referrer`
 */
export function buildSegmentPageEvent(routerUrl: string, href: string, title: string, referrer: string): SegmentPageEvent {
  const path = sanitizeAnalyticsPath(routerUrl);

  return {
    name: path.split('/').pop() || 'Home',
    path,
    url: sanitizeAnalyticsUrl(href),
    search: sanitizeUrlSearch(href),
    title,
    referrer: sanitizeAnalyticsUrl(referrer),
  };
}

function sanitizeUrlField(field: (typeof ANALYTICS_URL_FIELDS)[number], value: string): string {
  switch (field) {
    case 'search':
      return sanitizeAnalyticsSearch(value);
    case 'path':
      return sanitizeAnalyticsPath(value);
    case 'url':
    case 'referrer':
      return sanitizeAnalyticsUrl(value);
  }
}

function sanitizeUrlFields(container: unknown): void {
  if (container === undefined || container === null) {
    return;
  }
  if (typeof container !== 'object') {
    // Unexpected shape — throwing makes the wrapper cancel the event rather than send it unsanitized.
    throw new TypeError('Unexpected Segment event container');
  }

  const fields = container as Record<string, unknown>;
  for (const field of ANALYTICS_URL_FIELDS) {
    if (!Object.hasOwn(fields, field)) {
      continue;
    }
    const value = fields[field];
    if (typeof value === 'string') {
      fields[field] = sanitizeUrlField(field, value);
    } else {
      delete fields[field];
    }
  }
}

/**
 * Event sanitizer for `LfxSegmentsAnalytics.initWithEventSanitizer`. Runs synchronously on every
 * event (including the automatic initial page) and rewrites the URL fields of `context.page` and
 * `properties` in place. Non-string URL fields are removed. Returns the same event object, so `type`
 * and `messageId` are preserved. Unexpected input throws, which the wrapper treats as cancellation.
 */
export function sanitizeSegmentEvent(event: SegmentEvent): SegmentEvent {
  sanitizeUrlFields(event.context?.page);
  sanitizeUrlFields(event.properties);
  return event;
}
