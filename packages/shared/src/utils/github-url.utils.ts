// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GithubUrlTarget } from '../interfaces';

/** Hosts a user-supplied GitHub URL may use. Anything else is not a GitHub target at all. */
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

/** Owner/repo path segments: GitHub's own allowed character set. */
const GITHUB_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;

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
  if (segments.length < 2) {
    return { kind: 'organization', owner };
  }

  const repo = segments[1].replace(/\.git$/, '');
  if (!GITHUB_SEGMENT_RE.test(repo)) {
    return null;
  }
  return { kind: 'repository', owner, repo };
}
