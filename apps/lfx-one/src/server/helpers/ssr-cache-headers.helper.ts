// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Applies the cache-control policy required on every SSR HTML response.
 *
 * The rendered HTML can carry per-user data (auth context, host_key/can_view_host_key on
 * meeting pages), so it must never be served from a shared/intermediary cache to another
 * user. `no-store` alone is sufficient: conformant caches never persist the response, so
 * there is nothing left to partition with a `Vary` header, and a `Vary` value would risk
 * clobbering a header Angular's own SSR redirect handling may have already set (e.g. an
 * i18n locale redirect's `Vary: Accept-Language`) if this were ever set with `.set()`
 * instead of `.append()`. Mutates `response.headers` in place — the Fetch `Response` this
 * is called with (or its `.headers`) must not be a shared/frozen instance.
 */
export function applySsrCacheHeaders(response: Response): void {
  response.headers.set('Cache-Control', 'private, no-store');
}
