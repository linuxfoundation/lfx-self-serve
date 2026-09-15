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
    let host = domain.includes('://') ? safeHost(domain) : domain;
    // Strip a leading www. and anything from the first slash so a bare host, a host with a
    // trailing slash, and a host with a path all key the same. Plain string ops (not regex)
    // to avoid a polynomial-backtracking pattern on slash-heavy input.
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }
    const slashIndex = host.indexOf('/');
    if (slashIndex !== -1) {
      host = host.slice(0, slashIndex);
    }
    return `domain:${host}`;
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

  // First pass, order-independent: for each normalized name, note the first domained
  // record (the canonical one whose domain/logo win) and any `id` carried by a
  // domainless record with that name. A domainless entry with an `id` is an exact CDP
  // match — the only source of a resolved organizationId — so it must never be silently
  // dropped as a "lesser" duplicate; instead its id rides along onto the domained record.
  const domainedByName = new Map<string, OrganizationSuggestion>();
  const idByName = new Map<string, string>();
  for (const org of combined) {
    const name = normalize(org.name);
    if (normalize(org.domain) && !domainedByName.has(name)) {
      domainedByName.set(name, org);
    }
    if (!normalize(org.domain) && org.id && !idByName.has(name)) {
      idByName.set(name, org.id);
    }
  }

  const seen = new Set<string>();
  const merged: OrganizationSuggestion[] = [];

  for (const org of combined) {
    const name = normalize(org.name);

    if (!normalize(org.domain)) {
      // A canonical domained record exists for this name — this domainless duplicate is
      // redundant; any id it carries was already captured in idByName and gets attached
      // to the domained record below, so nothing is lost.
      if (domainedByName.has(name)) {
        continue;
      }
      const key = normalizeOrgKey(org);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(org);
      continue;
    }

    const preservedId = idByName.get(name);
    const finalOrg = preservedId && !org.id ? { ...org, id: preservedId } : org;
    const key = normalizeOrgKey(finalOrg);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(finalOrg);
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
