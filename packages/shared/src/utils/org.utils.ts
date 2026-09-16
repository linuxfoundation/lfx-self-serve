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
 * domained entry exists for an unambiguous name, the domainless one is dropped
 * in favor of the richer record — unless the domainless row carries an `id`
 * and the name maps to 2+ different domains, in which case it can't be
 * attributed to any one of them and survives as its own row.
 */
export function mergeOrgSuggestions(local: OrganizationSuggestion[], remote: OrganizationSuggestion[]): OrganizationSuggestion[] {
  const combined = [...local, ...remote];

  // First pass: note each name's canonical domained record, every domain key seen under
  // it (to detect an ambiguous name shared by 2+ domains), and any id to carry forward.
  const domainedByName = new Map<string, OrganizationSuggestion>();
  const domainKeysByName = new Map<string, Set<string>>();
  const idByDomainKey = new Map<string, string>();
  const idByName = new Map<string, string>();
  for (const org of combined) {
    const name = normalize(org.name);
    const domain = normalize(org.domain);
    if (domain) {
      if (!domainedByName.has(name)) {
        domainedByName.set(name, org);
      }
      const domainKey = normalizeOrgKey(org);
      if (!domainKeysByName.has(name)) {
        domainKeysByName.set(name, new Set());
      }
      domainKeysByName.get(name)!.add(domainKey);
      if (org.id && !idByDomainKey.has(domainKey)) {
        idByDomainKey.set(domainKey, org.id);
      }
    } else if (org.id && !idByName.has(name)) {
      idByName.set(name, org.id);
    }
  }

  const seen = new Set<string>();
  const merged: OrganizationSuggestion[] = [];

  for (const org of combined) {
    const name = normalize(org.name);
    const nameIsUnambiguous = (domainKeysByName.get(name)?.size ?? 0) <= 1;

    if (!normalize(org.domain)) {
      // Redundant only when the name is unambiguous or id-less; an ambiguous id-bearing
      // domainless row can't be attributed to any domain, so it survives as its own row.
      if (domainedByName.has(name) && (nameIsUnambiguous || !org.id)) {
        continue;
      }
      const preservedId = nameIsUnambiguous ? idByName.get(name) : org.id;
      const finalOrg = preservedId && !org.id ? { ...org, id: preservedId } : org;
      const key = normalizeOrgKey(finalOrg);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(finalOrg);
      continue;
    }

    // Prefer an existing id, then a same-domain duplicate's, then a same-name domainless
    // record's id — the latter only when the name maps to exactly one domain.
    const domainKey = normalizeOrgKey(org);
    const preservedId = org.id || idByDomainKey.get(domainKey) || (nameIsUnambiguous ? idByName.get(name) : undefined);
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
