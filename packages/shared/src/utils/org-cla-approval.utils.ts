// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Approval-list value validation and ordering for the Organization Lens CLA Group detail page
// (#1985).
//
// The validators here are deliberate ports of the producer's own, not independent opinions about
// what an email or a GitLab group looks like. The producer validates every add AND every remove
// and answers 400 for the whole request if any single value fails, so a list of entries where
// one is malformed is rejected in full. Validating client-side is therefore not decoration: it is
// what keeps a CLA manager from losing five good entries to a typo in the sixth, and it lets the
// error name the offending field rather than surfacing one joined producer sentence about all of
// them.
//
// Where a port drifts from its original, the original wins. These mirror
// `cla-backend-go/utils/validators.go` as called from `v2/signatures/validators.go`.

import type { OrgClaApprovalCriteriaKind, OrgClaApprovalCriteriaOption, OrgClaApprovalEntry } from '../interfaces/cla.interface';
import { ORG_CLA_APPROVAL_CRITERIA } from '../constants/cla.constants';

/** `utils.ValidEmail` — the producer's regexp, unchanged. */
const EMAIL_PATTERN = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * `utils.ValidGitHubUsername` / `ValidGitHubOrg` / `ValidGitlabUsername` — all three share one
 * pattern upstream, and all three additionally require 3 or more characters.
 *
 * Note it is `*` and not `+`: the producer's own pattern matches the empty string, and the length
 * check below is what actually rejects one. Kept as-is so the two implementations agree on a
 * value like `"  "`.
 */
const HANDLE_PATTERN = /^[a-zA-Z0-9._-]*$/;

/** `utils.ValidGitlabOrg` — a gitlab.com URL, with the scheme and `www.` both optional. */
const GITLAB_ORG_PATTERN = /^(?:http(s)?:\/\/)?(?:www\.)?(\w+[\w-]+\w+\.)?gitlab\.com[\w\-._~:/?#[\]@!$&'()*+,;=.]{3,100}$/;

/** Minimum length the producer enforces on every handle-shaped value (`<= 2` is rejected). */
const HANDLE_MIN_LENGTH = 3;

const DOMAIN_MAX_LENGTH = 255;
const DOMAIN_LABEL_MAX_LENGTH = 63;

/**
 * `utils.ValidDomain(domain, true)` — wildcards allowed.
 *
 * A character-by-character port rather than a regexp, because the original is a loop with
 * per-label rules (leading and trailing hyphens, label length, a top-level domain that may not
 * begin with a digit) and a regexp expressing all of them would be unreadable and would drift.
 *
 * Returns the producer's own message for the failure, so a rejected value reads the same here as
 * it would coming back from the API.
 */
function validateDomain(domain: string): string | null {
  if (domain.length === 0) return 'domain is empty';
  if (domain.length > DOMAIN_MAX_LENGTH) return `domain name length is ${domain.length}, can't exceed ${DOMAIN_MAX_LENGTH}`;

  let labelStart = 0;
  for (let i = 0; i < domain.length; i++) {
    const char = domain[i];

    if (char === '.') {
      if (i === labelStart) return `invalid character '.' at offset ${i}: label can't begin with a period`;
      if (i - labelStart > DOMAIN_LABEL_MAX_LENGTH) {
        return `byte length of label '${domain.slice(labelStart, i)}' is ${i - labelStart}, can't exceed ${DOMAIN_LABEL_MAX_LENGTH}`;
      }
      if (domain[labelStart] === '-') return `label '${domain.slice(labelStart, i)}' at offset ${labelStart} begins with a hyphen`;
      if (domain[i - 1] === '-') return `label '${domain.slice(labelStart, i)}' at offset ${labelStart} ends with a hyphen`;
      labelStart = i + 1;
      continue;
    }

    // The wildcard branch of the original, since every caller on this path allows `*`.
    if (!/[a-zA-Z0-9\-*]/.test(char)) return `invalid character '${char}' at offset ${i}`;
  }

  if (labelStart === domain.length) return "missing top level domain, domain can't end with a period";

  const tld = domain.slice(labelStart);
  if (tld.length > DOMAIN_LABEL_MAX_LENGTH) {
    return `byte length of top level domain '${tld}' is ${tld.length}, can't exceed ${DOMAIN_LABEL_MAX_LENGTH}`;
  }
  if (tld.startsWith('-')) return `top level domain '${tld}' at offset ${labelStart} begins with a hyphen`;
  if (domain.endsWith('-')) return `top level domain '${tld}' at offset ${labelStart} ends with a hyphen`;
  if (/^[0-9]/.test(tld)) return `top level domain '${tld}' at offset ${labelStart} begins with a digit`;

  return null;
}

/**
 * Validates one approval-list value against the rules the producer applies to its kind.
 *
 * Returns `null` when the value is acceptable, or a message naming the problem. The messages are
 * the producer's wording where it has one, so the same rejection reads identically whether it was
 * caught here or came back as a 400.
 *
 * Trims first, as every producer validator does — a trailing space is not a distinct rule and
 * would otherwise be stored as one.
 */
export function validateOrgClaApprovalValue(kind: OrgClaApprovalCriteriaKind, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter a value.';

  switch (kind) {
    case 'email':
      return EMAIL_PATTERN.test(trimmed) ? null : `invalid approval list email ${trimmed}`;
    case 'domain':
      return validateDomain(trimmed);
    case 'github-username':
      if (trimmed.length < HANDLE_MIN_LENGTH) return 'github username must be 3 or more characters';
      return HANDLE_PATTERN.test(trimmed) ? null : `invalid GitHub username: ${trimmed}`;
    case 'github-org':
      if (trimmed.length < HANDLE_MIN_LENGTH) return 'github organization must be 3 or more characters';
      return HANDLE_PATTERN.test(trimmed) ? null : `invalid GitHub organization: ${trimmed}`;
    case 'gitlab-username':
      if (trimmed.length < HANDLE_MIN_LENGTH) return 'gitlab username must be 3 or more characters';
      return HANDLE_PATTERN.test(trimmed) ? null : `invalid Gitlab username: ${trimmed}`;
    case 'gitlab-group':
      if (trimmed.length < HANDLE_MIN_LENGTH) return 'gitlab organization must be 3 or more characters';
      return GITLAB_ORG_PATTERN.test(trimmed) ? null : `invalid Gitlab organization: ${trimmed}`;
  }
}

/**
 * The six options indexed by kind.
 *
 * A lookup rather than a `find`, so there is no undefined branch to cast away: the key type is the
 * union derived from `ORG_CLA_APPROVAL_CRITERIA` itself, which makes a miss unrepresentable.
 */
const CRITERIA_BY_KIND = Object.fromEntries(ORG_CLA_APPROVAL_CRITERIA.map((option) => [option.kind, option])) as Record<
  OrgClaApprovalCriteriaKind,
  OrgClaApprovalCriteriaOption
>;

/** The picker option for one kind. */
export function orgClaApprovalCriteriaOption(kind: OrgClaApprovalCriteriaKind): OrgClaApprovalCriteriaOption {
  return CRITERIA_BY_KIND[kind];
}

/** Human label for one kind, as the table's criteria column and the delete warning render it. */
export function orgClaApprovalCriteriaLabel(kind: OrgClaApprovalCriteriaKind): string {
  return orgClaApprovalCriteriaOption(kind).label;
}

/**
 * Sorts the list for reading: by criteria type in picker order, then by value.
 *
 * Upstream returns six independent arrays in whatever order Dynamo held them, so an unsorted
 * flattening would reorder rows between two loads of the same unchanged list. Grouping by kind
 * also keeps a domain rule — which can cover an entire workforce — adjacent to its siblings
 * rather than scattered among individual addresses.
 *
 * `localeCompare` with a numeric collator so `user2` precedes `user10`.
 */
export function sortOrgClaApprovalEntries(entries: OrgClaApprovalEntry[]): OrgClaApprovalEntry[] {
  const kindOrder = new Map(ORG_CLA_APPROVAL_CRITERIA.map((option, index) => [option.kind, index]));

  return [...entries].sort((a, b) => {
    const byKind = (kindOrder.get(a.kind) ?? 0) - (kindOrder.get(b.kind) ?? 0);
    if (byKind !== 0) return byKind;
    return a.value.localeCompare(b.value, 'en', { numeric: true, sensitivity: 'base' });
  });
}

/**
 * Whether a search term matches an entry.
 *
 * Matches the value and the criteria label, the two columns the term is visibly compared against
 * — the design's own `dataset.search`. The added-on date is deliberately not searchable: a term
 * like `2026` matching a date column the user was not looking at reads as a broken filter.
 */
export function orgClaApprovalEntryMatches(entry: OrgClaApprovalEntry, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return `${entry.value} ${orgClaApprovalCriteriaLabel(entry.kind)}`.toLowerCase().includes(needle);
}
