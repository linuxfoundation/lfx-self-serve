// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Escapes the two characters that break the raw-key / percent-encoded-URL round trip: a literal
 * `/` would split the key into extra S3 path segments that don't survive as `%2F` (CDNs/S3
 * gateways decode an encoded slash inconsistently — some refuse it, some collapse it), and a
 * literal `%` would collide with our own escape sequence. Escaping `%` first means a username that
 * already contains a literal `%2F`-shaped substring can't be mistaken for an escaped `/`, keeping
 * the mapping collision-free. Every other character (letters, digits, `.`, `@`, `+`, unicode) is
 * left as-is, staying human-readable and matching packages/shared/src/utils/avatar.utils.ts's
 * buildMyprofileAvatarUrl convention of an unencoded key, encoded only at URL-construction time.
 */
export function toAvatarKeySegment(sanitizedUsername: string): string {
  return sanitizedUsername.replace(/%/g, '%25').replace(/\//g, '%2F');
}

/**
 * Returns the raw (unencoded) S3 object key an upload for this username was/would be stored under.
 * Stable per user — a re-upload overwrites the same object — so a lookup by username always lands
 * on the object that user's upload would have written.
 */
export function toAvatarObjectKey(username: string): string {
  return `avatars/${toAvatarKeySegment(username.trim().toLowerCase())}`;
}

/**
 * Returns the normalized CDN prefix (trailing slashes stripped), or null when CDN_URL_PREFIX is
 * unset — that's degraded mode (callers fall back to no public_url / to a lower-priority avatar
 * source), not a fatal error. When set, it must be an absolute http(s) URL: infra sometimes hands
 * back a bare hostname (e.g. `avatars-public.dev.downloads.lfx.community`), and interpolating that
 * verbatim would silently produce a relative URL that then gets persisted (e.g. into Auth0
 * user_metadata) as if it were absolute.
 */
export function getAvatarCdnPrefix(): string | null {
  const cdnPrefix = process.env['CDN_URL_PREFIX'];
  if (!cdnPrefix) {
    return null;
  }
  // Trim before validating and returning — new URL() trims ASCII whitespace internally, so an
  // untrimmed value with leading/trailing spaces would pass validation while the raw string
  // (with the spaces still in it) got returned and interpolated into a malformed URL downstream.
  const trimmedCdnPrefix = cdnPrefix.trim();
  // New URL() (rather than a `^https?:\/\//` regex) also rejects a scheme-only value like
  // "https://" — that string starts with the required prefix but has no hostname, and a regex
  // check alone would let it through and silently produce a malformed "https:/avatars/..." URL
  // after the trailing-slash trim below.
  let parsed: URL;
  try {
    parsed = new URL(trimmedCdnPrefix);
  } catch {
    throw new Error(`CDN_URL_PREFIX must be an absolute http(s) URL, got: "${cdnPrefix}"`);
  }
  // A query or fragment also can't survive buildAvatarUrl's plain string concatenation: appending
  // "/avatars/<key>" after "?token=x" lands the avatar path inside the query string instead of the
  // path, and after "#frag" it's hidden in the fragment — either way the resulting URL doesn't
  // point at the object it claims to.
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname || parsed.search || parsed.hash) {
    throw new Error(`CDN_URL_PREFIX must be an absolute http(s) URL, got: "${cdnPrefix}"`);
  }
  return trimmedCdnPrefix.replace(/\/+$/, '');
}

/**
 * Builds the CDN-fronted public URL for an avatar object key. `avatars/` is a literal path
 * separator and stays unencoded; only the key segment after it is percent-encoded — a single
 * decode hop in transit reconstructs the segment exactly (including any literal `%2F`/`%25` text
 * from toAvatarKeySegment), so the URL always resolves back to the stored key.
 */
export function buildAvatarUrl(cdnPrefix: string, keySegment: string): string {
  return `${cdnPrefix}/avatars/${encodeURIComponent(keySegment)}`;
}

/**
 * Derives the public avatar URL for a username without confirming the object exists — this is a
 * guess based on the upload key convention, not a fresh-upload confirmation, so it carries no
 * cache-busting `?v=` hint. Callers must treat a 404 on this URL as "no avatar uploaded" and fall
 * back to another source; that's an acceptable tradeoff only because the object's Cache-Control is
 * short-lived (see object-store.service.ts), so a stale hit self-heals within a day. Returns null
 * when CDN_URL_PREFIX is unset, mirroring uploadProfilePicture's degraded-mode contract.
 */
export function deriveAvatarUrl(username: string): string | null {
  const cdnPrefix = getAvatarCdnPrefix();
  if (!cdnPrefix) {
    return null;
  }
  const sanitizedUsername = username.trim().toLowerCase();
  return buildAvatarUrl(cdnPrefix, toAvatarKeySegment(sanitizedUsername));
}
