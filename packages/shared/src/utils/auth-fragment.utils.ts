// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Fragment keys that carry authentication material and must never reach an analytics sink or a
 * third-party query string.
 *
 * The Gatewaze embed's LFID sign-in returns to `#access_token=…&refresh_token=…`. A refresh token
 * is long-lived, so a leak does not expire on its own.
 */
export const AUTH_FRAGMENT_KEYS = ['access_token', 'refresh_token', 'id_token', 'provider_token', 'provider_refresh_token'] as const;

/** Whether a URL fragment carries any key that counts as authentication material. */
export function hasAuthFragment(hash: string): boolean {
  if (!hash) {
    return false;
  }
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return AUTH_FRAGMENT_KEYS.some((key) => params.has(key));
}

/**
 * Returns `url` with an auth-bearing fragment replaced by a marker, or unchanged if it has none.
 *
 * Lives in the shared package rather than beside its caller so it is reachable by the runnable test
 * suite: the Angular provider that uses it sits under `src/app/`, whose specs need `ng test`.
 *
 * @param url Absolute or relative; a relative value is resolved against `base` so a same-origin
 *   referrer cannot slip through unredacted merely because it failed to parse standalone.
 * @param base Origin to resolve a relative `url` against.
 */
export function redactAuthFragment(url: string, base?: string): string {
  try {
    const parsed = new URL(url, base);
    if (!hasAuthFragment(parsed.hash)) {
      return url;
    }
    // A marker rather than an empty hash, so a reader can tell redaction happened.
    parsed.hash = 'redacted';
    return parsed.toString();
  } catch {
    // Never throw: the caller is a Datadog `beforeSend`, where a thrown error loses the event and
    // can take RUM down with it. An unparseable URL cannot be redacted precisely, so drop the
    // fragment wholesale — blunt, but it cannot leak.
    return url.split('#')[0];
  }
}
