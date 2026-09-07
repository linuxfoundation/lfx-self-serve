// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GithubUrlTarget } from '../interfaces';

/** Hosts a user-supplied GitHub URL may use. Anything else is not a GitHub target at all. */
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

/** Owner/repo path segments: GitHub's own allowed character set. */
const GITHUB_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * First path segments github.com reserves for its OWN routes, which can never
 * be an account name. Without this, `github.com/orgs/<org>/repositories` — the
 * URL a user copies straight out of an organization's repository list — parses
 * as the repository `orgs/<org>`, clears the repository validator, and the BFF
 * then asks the API for `/repos/orgs/<org>/readme`, gets a 404, and produces
 * exactly the unexplained README-less document this contract exists to
 * prevent. A reserved first segment is not a repository URL, so the parser
 * refuses it here rather than letting every caller re-derive the rule.
 *
 * Deliberately a denylist of GitHub's product routes rather than an attempt at
 * every reserved word: a miss degrades to today's behaviour (a 404 and a
 * skip reason), while a false positive would reject a legitimate account.
 */
const GITHUB_RESERVED_ROOT_SEGMENTS = new Set([
  'about',
  'account',
  'admin',
  'apps',
  'blog',
  'business',
  'codespaces',
  'collections',
  'contact',
  'customer-stories',
  'dashboard',
  'enterprise',
  'enterprises',
  'events',
  'explore',
  'features',
  'issues',
  'join',
  'login',
  'logout',
  'marketplace',
  'new',
  'notifications',
  'organizations',
  'orgs',
  'pricing',
  'pulls',
  'search',
  'security',
  'sessions',
  'settings',
  'signup',
  'site',
  'sponsors',
  'stars',
  'topics',
  'trending',
  'users',
  'watching',
]);

/**
 * Parses a user-supplied GitHub URL into the thing it actually names: an
 * owner/repo pair, or an owner on its own. Returns null for non-GitHub hosts,
 * malformed URLs, and hostile path segments.
 *
 * ONE parser for both sides of the contract. The intake form uses it to warn,
 * before submission, that a value will not resolve to a readable repository —
 * the failure Joan hit when `https://github.com/aaif` (an organization) was
 * accepted silently — and the BFF's README fetch uses the same result to
 * decide between the repository README and the organization profile README.
 * Two independent notions of "a repo URL" would drift the warning away from
 * the behavior it warns about.
 *
 * This is a PARSER, never a fetcher: the returned segments are validated
 * against GitHub's character set so callers can address `api.github.com`
 * without ever requesting the user-supplied URL itself (SSRF guard).
 */
export function parseGithubUrlTarget(githubUrl: string): GithubUrlTarget | null {
  const trimmed = (githubUrl ?? '').trim();
  if (!trimmed) {
    return null;
  }

  let parsed: URL;
  try {
    // Tolerate a missing scheme ("github.com/org/repo") — prefix https.
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (!GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) {
    return null;
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  const owner = segments[0] ?? '';
  if (!GITHUB_SEGMENT_RE.test(owner)) {
    return null;
  }
  // A github.com product route (`/orgs/...`, `/marketplace/...`, ...) names no
  // account, so nothing under it can be an owner or an owner/repo pair.
  if (GITHUB_RESERVED_ROOT_SEGMENTS.has(owner.toLowerCase())) {
    return null;
  }
  if (segments.length < 2) {
    return { kind: 'organization', owner };
  }

  const repo = segments[1].replace(/\.git$/, '');
  if (!GITHUB_SEGMENT_RE.test(repo)) {
    return null;
  }
  return { kind: 'repository', owner, repo };
}
