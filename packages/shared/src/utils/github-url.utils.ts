// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GITHUB_RESERVED_ROOT_SEGMENTS } from '../constants/github-url.constants';
import { GithubUrlTarget } from '../interfaces';

/** Hosts a user-supplied GitHub URL may use. Anything else is not a GitHub target at all. */
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

/** Repository name segment: GitHub's own allowed character set for repos (underscores and dots included). */
const GITHUB_REPO_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * Owner (user or organization) segment. STRICTER than the repository rule:
 * GitHub accounts allow alphanumerics and single, non-leading, non-trailing
 * hyphens — no underscores and no dots — so `github.com/bad_owner/repo` names
 * an account that cannot exist and the BFF's README request for it is a
 * guaranteed 404. Catching it in the parser turns a thin document minutes
 * later into a field error now.
 */
const GITHUB_OWNER_SEGMENT_RE = /^[A-Za-z0-9](?:-?[A-Za-z0-9])*$/;

/** GitHub's account-name length limit; anything longer cannot be an owner. */
const GITHUB_OWNER_MAX_LENGTH = 39;

/** GitHub's repository-name length limit; anything longer cannot be a repository. */
const GITHUB_REPO_MAX_LENGTH = 100;

/**
 * Parses a user-supplied GitHub URL into the thing it actually names: an
 * owner/repo pair, or an account (user or organization) on its own. Returns
 * null for non-GitHub hosts, malformed URLs, and hostile path segments.
 *
 * ONE parser for both sides of the contract. The intake form uses it to warn,
 * before submission, that a value will not resolve to a readable repository —
 * the failure Joan hit when `https://github.com/aaif` (an account, not a
 * repository) was accepted silently — and the BFF's README fetch uses the same
 * result to decide between the repository README and the profile READMEs.
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
  if (!GITHUB_OWNER_SEGMENT_RE.test(owner) || owner.length > GITHUB_OWNER_MAX_LENGTH) {
    return null;
  }
  // A github.com product route (`/orgs/...`, `/marketplace/...`, ...) names no
  // account, so nothing under it can be an owner or an owner/repo pair.
  if (GITHUB_RESERVED_ROOT_SEGMENTS.has(owner.toLowerCase())) {
    return null;
  }
  if (segments.length < 2) {
    // An account, not necessarily an ORGANIZATION: `github.com/<owner>` is a
    // personal profile just as often, and nothing in the URL distinguishes
    // them. Callers that need the difference resolve it against the API.
    return { kind: 'owner', owner };
  }

  const repo = segments[1].replace(/\.git$/, '');
  if (!GITHUB_REPO_SEGMENT_RE.test(repo) || repo.length > GITHUB_REPO_MAX_LENGTH) {
    return null;
  }
  return { kind: 'repository', owner, repo };
}
