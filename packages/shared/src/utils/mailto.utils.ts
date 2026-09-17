// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Builds a `mailto:` URL. Returns `null` when `email` isn't a valid single-recipient address, so
 * the caller renders plain text instead. `subject`/`body` are percent-encoded; the address is left
 * as a bare addr-spec.
 *
 * The single source of truth for the CRLF-injection-safe address allowlist — domain-specific mailto
 * builders (`buildMeetingOrganizerMailto`, `buildFormationItemOwnerMailto`) call this rather than
 * each carrying their own copy of the regex, so a future hardening or fix lands once, not per
 * caller.
 */
export function buildMailtoUrl(params: { email?: string | null; subject?: string | null; body?: string | null }): string | null {
  const email = params.email?.trim();
  // Only emit a mailto for a conservative single-recipient address. The positive allowlist rejects
  // whitespace, separators (`,`/`;`), extra `@`, and — critically — percent escapes, so a record
  // like `victim@x.com%0D%0ABcc:attacker@x.com` can't decode into a CRLF + injected mail header.
  if (!email || !/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
    return null;
  }

  const query: string[] = [];
  if (params.subject) {
    query.push(`subject=${encodeURIComponent(params.subject)}`);
  }
  if (params.body) {
    query.push(`body=${encodeURIComponent(params.body)}`);
  }

  return `mailto:${email}${query.length ? `?${query.join('&')}` : ''}`;
}
