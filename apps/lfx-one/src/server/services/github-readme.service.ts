// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_MESSAGE_README_MAX_CHARS, FOUNDATION_MESSAGE_README_TRUNCATION_MARKER } from '@lfx-one/shared/constants';
import { Request } from 'express';

import { logger } from './logger.service';

/** Outbound request timeout for the README fetch — a slow GitHub must not stall the generate POST. */
const GITHUB_README_TIMEOUT_MS = 10_000;

/** GitHub REST API base — the ONLY host this service ever fetches. */
const GITHUB_API_BASE = 'https://api.github.com';

/** Hosts a user-supplied repo URL may use. Anything else is skipped (SSRF guard). */
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

/** Owner/repo path segments: GitHub's own allowed character set. */
const GITHUB_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * Best-effort server-side README fetch for agents with no web access (the
 * Message Foundation's `readme_markdown` input). Strictly best-effort by
 * contract: EVERY failure — unparsable URL, non-GitHub host, missing README,
 * rate limit, timeout — returns null so the generation proceeds without a
 * README and the agent marks README-dependent gaps TBD per its grounding
 * rule. Never throws.
 *
 * SSRF guard: the user-supplied URL is never fetched. It is only PARSED for
 * an owner/repo pair (github.com hosts only, path segments validated against
 * GitHub's character set), and the actual request goes to the GitHub REST
 * API's readme endpoint on `api.github.com` — which also resolves
 * non-standard README filenames and the default branch for us.
 *
 * Confused-deputy guard: `github_url` is user-controlled, so the BFF's
 * `GITHUB_API_TOKEN` must never be usable as a read oracle for repositories
 * the requesting LFX user cannot see. When a token is configured, the repo's
 * visibility is verified via the repo metadata endpoint FIRST, and the
 * authenticated README request is only made for `public` repositories —
 * private and org-internal repos return null exactly like a missing README,
 * regardless of what the token itself could read. Tokenless requests need no
 * check: unauthenticated GitHub hides private repos already.
 */
export class GithubReadmeService {
  /**
   * Optional server-side GitHub token (`GITHUB_API_TOKEN`). Unauthenticated
   * GitHub REST calls are capped at 60/hour PER SOURCE IP, so a deployment
   * sharing one egress IP would silently degrade to README-less generations
   * under load; a token raises the cap to 5,000/hour. Absent token = the
   * unauthenticated cap, which the rate-limit logging below makes visible.
   */
  private get apiToken(): string {
    return process.env['GITHUB_API_TOKEN'] || '';
  }

  /** Fetch the repo's README as raw markdown, size-capped; null on any failure. */
  public async fetchReadme(req: Request, githubUrl: string): Promise<string | null> {
    const repo = this.parseRepo(githubUrl);
    if (!repo) {
      logger.debug(req, 'github_readme_fetch', 'URL is not a recognizable github.com repo — skipping README fetch', {});
      return null;
    }

    const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/readme`;

    try {
      // Confused-deputy guard: an authenticated request may only target repos
      // the anonymous public also sees — never repos only the token can read.
      if (this.apiToken && !(await this.isPublicRepo(req, repo))) {
        return null;
      }

      const response = await fetch(url, {
        method: 'GET',
        // Raw media type returns the README body directly (no base64 step).
        headers: this.buildHeaders('application/vnd.github.raw+json'),
        signal: AbortSignal.timeout(GITHUB_README_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logFailedResponse(req, 'GitHub README fetch', response, repo);
        return null;
      }

      const text = await response.text();
      if (!text.trim()) {
        return null;
      }
      if (text.length > FOUNDATION_MESSAGE_README_MAX_CHARS) {
        return text.slice(0, FOUNDATION_MESSAGE_README_MAX_CHARS) + FOUNDATION_MESSAGE_README_TRUNCATION_MARKER;
      }
      return text;
    } catch (error) {
      logger.warning(req, 'github_readme_fetch', 'GitHub README fetch errored — generation proceeds without a README', {
        error: error instanceof Error ? error.message : String(error),
        owner: repo.owner,
        repo: repo.repo,
      });
      return null;
    }
  }

  /**
   * True only when the repo metadata endpoint confirms the repository is
   * `public`. Called ONLY when a token is configured (see the class doc):
   * private and `internal` repos — anything the requesting LFX user could
   * not read anonymously — are refused before the README request, so the
   * BFF's token can never be used to exfiltrate them. Any metadata failure
   * (404, rate limit, timeout) counts as not-public, keeping the fail-closed,
   * never-throws contract.
   */
  private async isPublicRepo(req: Request, repo: { owner: string; repo: string }): Promise<boolean> {
    const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders('application/vnd.github+json'),
      signal: AbortSignal.timeout(GITHUB_README_TIMEOUT_MS),
    });

    if (!response.ok) {
      this.logFailedResponse(req, 'GitHub repo visibility check', response, repo);
      return false;
    }

    const metadata = (await response.json()) as { private?: boolean; visibility?: string };
    if (metadata.private !== false || metadata.visibility !== 'public') {
      logger.warning(req, 'github_readme_fetch', 'Repository is not public — refusing authenticated README fetch; generation proceeds without a README', {
        owner: repo.owner,
        repo: repo.repo,
        visibility: metadata.visibility,
      });
      return false;
    }
    return true;
  }

  /** Common GitHub REST headers; Authorization only when a token is configured. */
  private buildHeaders(accept: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'lfx-one',
    };
    if (this.apiToken) {
      headers['Authorization'] = `Bearer ${this.apiToken}`;
    }
    return headers;
  }

  /**
   * GitHub signals a spent rate limit as 403 or 429 with
   * x-ratelimit-remaining: 0 — log it distinctly so operators can tell
   * "we're being throttled, configure GITHUB_API_TOKEN" apart from an
   * ordinary missing/private README.
   */
  private logFailedResponse(req: Request, what: string, response: Response, repo: { owner: string; repo: string }): void {
    const rateLimited = (response.status === 403 || response.status === 429) && response.headers.get('x-ratelimit-remaining') === '0';
    const detail = rateLimited
      ? `${what} rate-limited — set GITHUB_API_TOKEN to raise the cap; generation proceeds without a README`
      : `${what} failed — generation proceeds without a README`;
    logger.warning(req, 'github_readme_fetch', detail, {
      status: response.status,
      rate_limited: rateLimited,
      rate_limit_reset: response.headers.get('x-ratelimit-reset') || undefined,
      authenticated: !!this.apiToken,
      owner: repo.owner,
      repo: repo.repo,
    });
  }

  /**
   * Extract an owner/repo pair from a user-supplied GitHub URL (repo root,
   * README blob URL, or anything else whose first two path segments are the
   * repo). Returns null for non-GitHub hosts or malformed paths.
   */
  private parseRepo(githubUrl: string): { owner: string; repo: string } | null {
    let parsed: URL;
    try {
      // Tolerate a missing scheme ("github.com/org/repo") — prefix https.
      parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(githubUrl.trim()) ? githubUrl.trim() : `https://${githubUrl.trim()}`);
    } catch {
      return null;
    }
    if (!GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) {
      return null;
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      return null;
    }
    const owner = segments[0];
    const repo = segments[1].replace(/\.git$/, '');
    if (!GITHUB_SEGMENT_RE.test(owner) || !GITHUB_SEGMENT_RE.test(repo)) {
      return null;
    }
    return { owner, repo };
  }
}
