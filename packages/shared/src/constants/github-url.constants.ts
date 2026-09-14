// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * First path segments github.com reserves for its OWN routes, which can never
 * be an account name. Without this, `github.com/orgs/<org>/repositories` — the
 * URL a user copies straight out of an organization's repository list — parses
 * as the repository `orgs/<org>`, clears the repository validator, and the BFF
 * then asks the API for `/repos/orgs/<org>/readme`, gets a 404, and produces
 * exactly the unexplained README-less document this contract exists to
 * prevent.
 *
 * Deliberately a denylist of GitHub's product routes rather than an attempt at
 * every reserved word: a miss degrades to today's behaviour (a 404 and a
 * skip reason), while a false positive would reject a legitimate account.
 *
 * Exported so the parser's spec can assert EVERY entry is refused rather than
 * a hand-picked sample — a typo added here would otherwise silently reopen the
 * gap it closes. Callers decide "is this a repository URL?" with
 * `parseGithubUrlTarget`, never by consulting this set directly.
 */
export const GITHUB_RESERVED_ROOT_SEGMENTS = new Set([
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
