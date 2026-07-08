// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OrganizationSuggestion } from '../interfaces';

/** Null-safe normalization for case-insensitive comparison: coalesces nullish to '', trims, lowercases. */
function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Stable dedupe key for an organization suggestion.
 *
 * Domain is the stronger identity signal, so it wins when present: full URLs
 * (e.g. "https://Example.com/") collapse to their bare host ("example.com").
 * Falls back to the normalized name for free-text orgs that have no domain
 * (the meetings guest flow creates these). Keys are prefixed so a name that
 * happens to equal a bare domain can never collide with a real domain key.
 */
export function normalizeOrgKey(org: Pick<OrganizationSuggestion, 'name' | 'domain'>): string {
  const domain = normalize(org.domain);
  if (domain) {
    const host = domain.includes('://') ? safeHost(domain) : domain;
    // Strip a leading www. and anything from the first slash so a bare host,
    // a host with a trailing slash, and a host with a path all key the same.
    return `domain:${host.replace(/^www\./, '').replace(/\/.*$/, '')}`;
  }
  return `name:${normalize(org.name)}`;
}

/**
 * True when an organization matches a typeahead query by name (case-insensitive
 * substring). Used to filter session-remembered orgs down to the current query
 * before merging them into upstream suggestions. An empty query matches nothing
 * so a blank field never floods the list with every remembered org.
 */
export function matchesOrgQuery(org: Pick<OrganizationSuggestion, 'name'>, query: string): boolean {
  const q = normalize(query);
  if (!q) {
    return false;
  }
  return normalize(org.name).includes(q);
}

/**
 * Merge locally-remembered organization suggestions with upstream (Clearbit)
 * results, local-first and deduped by {@link normalizeOrgKey}.
 *
 * The upstream org typeahead is served live from a third-party company database
 * that never contains user-invented orgs, so an org a user just created inline
 * would otherwise vanish from search. Merging the session's remembered orgs in
 * front of the upstream results keeps them one click away. Local entries win on
 * a key collision so the user's chosen name casing and logo are preserved.
 *
 * A free-text session org (no domain, e.g. "Google" typed inline) and the
 * canonical upstream org for the same name (domain + logo) key differently and
 * would otherwise both show, with the poorer free-text row on top. When a
 * domained entry exists for a name, the domainless one is dropped in favor of
 * the richer record.
 */
export function mergeOrgSuggestions(local: OrganizationSuggestion[], remote: OrganizationSuggestion[]): OrganizationSuggestion[] {
  const combined = [...local, ...remote];

  // Names that appear anywhere with a real domain: a canonical record exists,
  // so a domainless (free-text) entry for the same name is redundant.
  const domainedNames = new Set(combined.filter((org) => normalize(org.domain)).map((org) => normalize(org.name)));

  const seen = new Set<string>();
  const merged: OrganizationSuggestion[] = [];

  for (const org of combined) {
    if (!normalize(org.domain) && domainedNames.has(normalize(org.name))) {
      continue;
    }
    const key = normalizeOrgKey(org);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(org);
  }

  return merged;
}

/** Extracts the host from a URL, returning the raw value unchanged if it is not parseable. */
function safeHost(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return value;
  }
}
