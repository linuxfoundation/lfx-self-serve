// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_MESSAGE_README_MAX_CHARS, FOUNDATION_MESSAGE_README_TRUNCATION_MARKER } from '@lfx-one/shared/constants';
import { GithubUrlTarget, MktgReadmeFetchResult, MktgReadmeSkipReason } from '@lfx-one/shared/interfaces';
import { parseGithubUrlTarget } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { logger } from './logger.service';

/** Outbound request timeout for the README fetch — a slow GitHub must not stall the generate POST. */
const GITHUB_README_TIMEOUT_MS = 10_000;

/** GitHub REST API base — the ONLY host this service ever fetches. */
const GITHUB_API_BASE = 'https://api.github.com';

/** Repository GitHub serves an organization's profile README from. */
const GITHUB_ORG_PROFILE_REPO = '.github';

/** Path of the organization profile README inside {@link GITHUB_ORG_PROFILE_REPO}. */
const GITHUB_ORG_PROFILE_README_PATH = 'profile/README.md';

/**
 * How long a successfully fetched README stays reusable in-process. A Message
 * Foundation regeneration is a full resubmit of the SAME answers on a fresh
 * session, so without this every revision pays another GitHub round-trip (up
 * to {@link GITHUB_README_TIMEOUT_MS}) plus rate-limit budget for a
 * `github_url` that has not changed. Short enough that a user who edits their
 * README and re-runs a few minutes later still sees the new one.
 */
const GITHUB_README_CACHE_TTL_MS = 5 * 60_000;

/** Hard cap on cached repos — the cache is a revision-loop optimisation, not a store. */
const GITHUB_README_CACHE_MAX_ENTRIES = 100;

/**
 * Best-effort server-side README fetch for agents with no web access (the
 * Message Foundation's `readme_markdown` input). Strictly best-effort by
 * contract: EVERY failure — unparsable URL, non-GitHub host, missing README,
 * rate limit, timeout — returns a null README so the generation proceeds and
 * the agent marks README-dependent gaps TBD per its grounding rule. Never
 * throws.
 *
 * Best-effort is not the same as silent. Every attempt returns a
 * {@link MktgReadmeOutcome} alongside the README, and a skip is logged at
 * INFO/WARNING with its reason — a document generated without a README is a
 * materially thinner document, and the user is told so on the result instead
 * of being left to wonder why the agent underperformed.
 *
 * Account URLs are resolved rather than rejected: `github.com/<owner>` has no
 * repository README, but GitHub serves a profile README for BOTH kinds of
 * account it may name — an organization's from `<owner>/.github` at
 * `profile/README.md`, a personal one from the `<owner>/<owner>` repository —
 * and either is often exactly the overview the agent wants. Both are attempted
 * before giving up, because the URL alone never says which kind of account it
 * is; a miss gives up cleanly.
 *
 * SSRF guard: the user-supplied URL is never fetched. It is only PARSED (by
 * the shared `parseGithubUrlTarget`, github.com hosts only, path segments
 * validated against GitHub's character set) and the actual request goes to the
 * GitHub REST API on `api.github.com` — which also resolves non-standard
 * README filenames and the default branch for us.
 *
 * Confused-deputy guard: `github_url` is user-controlled, so the BFF's
 * `GITHUB_API_TOKEN` must never be usable as a read oracle for repositories
 * the requesting LFX user cannot see. When a token is configured, the repo's
 * visibility is verified via the repo metadata endpoint FIRST, and the
 * authenticated README request is only made for `public` repositories —
 * private and org-internal repos return a null README regardless of what the
 * token itself could read, under their own `not-public` reason so the user is
 * told about access rather than sent to fix a URL that was never wrong. The
 * organization fallback runs through the same gate on the `.github` repo.
 * Tokenless requests need no check: unauthenticated GitHub hides private
 * repos already.
 *
 * Successful fetches are memoised per repo for
 * {@link GITHUB_README_CACHE_TTL_MS} so the regeneration loop (a full
 * resubmit of unchanged answers on a fresh session) does not re-pay the
 * round-trip and the rate-limit budget each revision. Only PUBLIC content is
 * ever cached — an entry can only be written after the visibility gate above
 * has passed, and the short TTL bounds how long a repo that has since been
 * made private could still be served from memory. Failures are never cached:
 * a transient 5xx or timeout must not suppress the next attempt.
 */
export class GithubReadmeService {
  /**
   * Per-repo memo of successful fetches, keyed `owner/repo` (lowercased —
   * GitHub treats both case-insensitively), with the organization profile
   * README under its own `<org>/.github/profile` key. Process-local and
   * bounded; the routes hold one controller instance, so one cache per pod.
   */
  private readonly readmeCache = new Map<string, { readme: string; expiresAt: number }>();

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

  /**
   * Fetch a README for the user's URL as raw markdown, size-capped, with the
   * outcome that explains it. Never throws and never fails the run.
   */
  public async fetchReadme(req: Request, githubUrl: string): Promise<MktgReadmeFetchResult> {
    const target = parseGithubUrlTarget(githubUrl);
    if (!target) {
      // Raised from debug: this is the failure the user experiences as a
      // mysteriously thin document, and it must be greppable in the logs.
      logger.info(req, 'github_readme_fetch', 'URL is not a recognizable github.com repository or organization — generating without a README', {
        reason: 'not-a-repo-url',
      });
      return { readme: null, outcome: { fetched: false, skipReason: 'not-a-repo-url' } };
    }

    if (target.kind === 'owner') {
      return this.fetchOwnerProfileReadme(req, target.owner);
    }

    return this.fetchRepositoryReadme(req, target);
  }

  /** The repository's own README (the ordinary path). */
  private async fetchRepositoryReadme(req: Request, target: Extract<GithubUrlTarget, { kind: 'repository' }>): Promise<MktgReadmeFetchResult> {
    const repo = { owner: target.owner, repo: target.repo };

    // Regeneration resubmits the same `github_url`; serve it from memory
    // rather than re-paying the round-trip and the rate-limit budget.
    const cacheKey = `${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`;
    const cached = this.readCache(cacheKey);
    if (cached !== null) {
      logger.debug(req, 'github_readme_fetch', 'Serving README from the in-process cache — no GitHub round-trip', {
        owner: repo.owner,
        repo: repo.repo,
      });
      return { readme: cached, outcome: { fetched: true, source: 'repository' } };
    }

    const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/readme`;
    const attempt = await this.requestReadme(req, url, repo, cacheKey);
    if (attempt.readme === null) {
      return { readme: null, outcome: { fetched: false, skipReason: attempt.skipReason } };
    }
    return { readme: attempt.readme, outcome: { fetched: true, source: 'repository' } };
  }

  /**
   * An account URL names no repository, so there is no repository README — but
   * GitHub renders a profile README for either kind of account the URL may
   * name, and the URL cannot say which: an organization's lives in
   * `<owner>/.github` at `profile/README.md`, a personal one is the README of
   * the `<owner>/<owner>` repository. Both are attempted, organization first
   * (the common case for the LF projects this collects URLs for), turning a
   * dead end into an overview the agent can actually ground on. When neither
   * exists we give up cleanly and say so.
   */
  private async fetchOwnerProfileReadme(req: Request, owner: string): Promise<MktgReadmeFetchResult> {
    const orgAttempt = await this.fetchOrgProfileReadme(req, owner);
    if (orgAttempt.readme !== null || orgAttempt.outcome.skipReason === 'fetch-failed') {
      // A GitHub outage or rate limit is a different fact with a different
      // remedy — retry, not "fix your URL" — and the personal-profile probe
      // would only hit the same wall, so it is not attempted.
      return orgAttempt;
    }

    const userAttempt = await this.fetchUserProfileReadme(req, owner);
    if (userAttempt.readme !== null) {
      return userAttempt;
    }

    // Same rule as the first probe, for the same reason: "GitHub failed us" is
    // not "this account publishes no profile README". If the personal probe
    // could not be ASKED, we do not know whether a personal profile README
    // exists, so the honest report is `fetch-failed` (retry) rather than a
    // verdict on the URL. Any other outcome is a genuine absence and leaves the
    // organization attempt's own reason — which is about the URL the user
    // typed: it names no repository.
    const skipReason = userAttempt.outcome.skipReason === 'fetch-failed' ? 'fetch-failed' : orgAttempt.outcome.skipReason;
    logger.info(req, 'github_readme_fetch', 'No profile README available for the account — generating without a README', {
      owner,
      reason: skipReason,
    });
    return { readme: null, outcome: { fetched: false, skipReason } };
  }

  /** The organization profile README — `<owner>/.github` → `profile/README.md`. */
  private async fetchOrgProfileReadme(req: Request, owner: string): Promise<MktgReadmeFetchResult> {
    const repo = { owner, repo: GITHUB_ORG_PROFILE_REPO };
    const cacheKey = `${owner.toLowerCase()}/${GITHUB_ORG_PROFILE_REPO}/profile`;
    const cached = this.readCache(cacheKey);
    if (cached !== null) {
      logger.debug(req, 'github_readme_fetch', 'Serving the organization profile README from the in-process cache — no GitHub round-trip', { owner });
      return { readme: cached, outcome: { fetched: true, source: 'org-profile' } };
    }

    logger.info(req, 'github_readme_fetch', 'URL resolves to an account, not a repository — trying the organization profile README', {
      owner,
      profile_repo: GITHUB_ORG_PROFILE_REPO,
    });

    // The contents endpoint (not /readme) — the profile README lives at a
    // fixed path INSIDE the .github repo, and that repo's own root README is
    // a different document.
    const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(GITHUB_ORG_PROFILE_REPO)}/contents/${GITHUB_ORG_PROFILE_README_PATH}`;
    const attempt = await this.requestReadme(req, url, repo, cacheKey);
    if (attempt.readme === null) {
      // `fetch-failed` is carried through rather than rewritten as "not a
      // repository". Everything else (no `.github` repo, no
      // `profile/README.md`, a private `.github`) is the ordinary "this
      // account publishes no organization profile README" case, which for the
      // URL the user actually typed means exactly `not-a-repo-url`: most
      // accounts have no `.github` repo at all, and reporting that as a
      // visibility problem would send them looking for permissions that were
      // never the issue.
      const skipReason = attempt.skipReason === 'fetch-failed' ? 'fetch-failed' : 'not-a-repo-url';
      return { readme: null, outcome: { fetched: false, skipReason } };
    }
    return { readme: attempt.readme, outcome: { fetched: true, source: 'org-profile' } };
  }

  /**
   * The personal profile README — the root README of the `<owner>/<owner>`
   * repository, which is how GitHub renders a USER's profile. Reached only
   * when the organization profile README is genuinely absent, so an account
   * that turns out to be a person still grounds the agent on something real
   * instead of on a path that could never have held their profile.
   */
  private async fetchUserProfileReadme(req: Request, owner: string): Promise<MktgReadmeFetchResult> {
    // Same cache key shape as any repository README, because that is exactly
    // what this is — `github.com/<owner>/<owner>` later hits the same entry.
    const cacheKey = `${owner.toLowerCase()}/${owner.toLowerCase()}`;
    const cached = this.readCache(cacheKey);
    if (cached !== null) {
      logger.debug(req, 'github_readme_fetch', 'Serving the personal profile README from the in-process cache — no GitHub round-trip', { owner });
      return { readme: cached, outcome: { fetched: true, source: 'user-profile' } };
    }

    logger.info(req, 'github_readme_fetch', 'No organization profile README — trying the personal profile README', {
      owner,
      profile_repo: owner,
    });

    const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(owner)}/readme`;
    const attempt = await this.requestReadme(req, url, { owner, repo: owner }, cacheKey);
    if (attempt.readme === null) {
      return { readme: null, outcome: { fetched: false, skipReason: attempt.skipReason } };
    }
    return { readme: attempt.readme, outcome: { fetched: true, source: 'user-profile' } };
  }

  /**
   * One authenticated-or-anonymous README request against `api.github.com`,
   * with the visibility gate, the size cap, and the memo write. Returns a null
   * README plus the reason on every failure — the reason travels in the return
   * value rather than on the instance, because one service instance serves
   * concurrent requests and an instance field would be clobbered across the
   * `await` boundaries.
   */
  private async requestReadme(
    req: Request,
    url: string,
    repo: { owner: string; repo: string },
    cacheKey: string
  ): Promise<{ readme: string } | { readme: null; skipReason: MktgReadmeSkipReason }> {
    try {
      // Confused-deputy guard: an authenticated request may only target repos
      // the anonymous public also sees — never repos only the token can read.
      if (this.apiToken) {
        const visibility = await this.checkRepoVisibility(req, repo);
        if (visibility !== 'public') {
          return { readme: null, skipReason: visibility };
        }
      }

      const response = await fetch(url, {
        method: 'GET',
        // Raw media type returns the README body directly (no base64 step).
        headers: this.buildHeaders('application/vnd.github.raw+json'),
        signal: AbortSignal.timeout(GITHUB_README_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logFailedResponse(req, 'GitHub README fetch', response, repo);
        if (response.status !== 404) {
          return { readme: null, skipReason: 'fetch-failed' };
        }
        // A 404 is ambiguous without a token: GitHub answers the same way for
        // "public repo, no README" and "repo you cannot see". Resolve it so a
        // tokenless deployment still tells a private-repo user about ACCESS
        // rather than claiming their repository has no README. With a token
        // the visibility gate above already ran, so the 404 can only be a
        // genuinely absent README.
        return { readme: null, skipReason: this.apiToken ? 'no-readme' : await this.classifyAnonymous404(req, repo) };
      }

      const text = await response.text();
      if (!text.trim()) {
        logger.info(req, 'github_readme_fetch', 'README is empty — generating without a README', { owner: repo.owner, repo: repo.repo });
        return { readme: null, skipReason: 'no-readme' };
      }
      const readme =
        text.length > FOUNDATION_MESSAGE_README_MAX_CHARS
          ? text.slice(0, FOUNDATION_MESSAGE_README_MAX_CHARS) + FOUNDATION_MESSAGE_README_TRUNCATION_MARKER
          : text;
      this.writeCache(cacheKey, readme);
      return { readme };
    } catch (error) {
      logger.warning(req, 'github_readme_fetch', 'GitHub README fetch errored — generation proceeds without a README', {
        error: error instanceof Error ? error.message : String(error),
        owner: repo.owner,
        repo: repo.repo,
      });
      return { readme: null, skipReason: 'fetch-failed' };
    }
  }

  /**
   * Tells a genuinely absent README apart from a repository the anonymous
   * public cannot see, for the tokenless path where GitHub returns 404 for
   * both. One extra metadata call, only on the 404 branch: a 200 means the
   * repository is publicly visible and simply has no README, a 404 means it
   * is not visible to us at all. Anything else leaves the README endpoint's
   * own 404 as the answer — a throttled metadata call is no reason to
   * upgrade a definite "no README here" into a guess.
   */
  private async classifyAnonymous404(req: Request, repo: { owner: string; repo: string }): Promise<'no-readme' | 'not-public'> {
    try {
      const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: this.buildHeaders('application/vnd.github+json'),
        signal: AbortSignal.timeout(GITHUB_README_TIMEOUT_MS),
      });
      if (response.ok) {
        return 'no-readme';
      }
      if (response.status === 404) {
        logger.info(req, 'github_readme_fetch', 'Repository is not visible anonymously — generating without a README', {
          owner: repo.owner,
          repo: repo.repo,
          reason: 'not-public',
        });
        return 'not-public';
      }
      return 'no-readme';
    } catch {
      return 'no-readme';
    }
  }

  /** The repo's cached README while it is still fresh; null on a miss or an expired entry (which is dropped). */
  private readCache(cacheKey: string): string | null {
    const entry = this.readmeCache.get(cacheKey);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.readmeCache.delete(cacheKey);
      return null;
    }
    return entry.readme;
  }

  /**
   * Memoise a successful fetch, evicting expired entries first and then the
   * oldest one if the cap is still reached (Map preserves insertion order).
   * Re-inserting refreshes both the value and its position.
   */
  private writeCache(cacheKey: string, readme: string): void {
    const now = Date.now();
    for (const [key, entry] of this.readmeCache) {
      if (entry.expiresAt <= now) {
        this.readmeCache.delete(key);
      }
    }
    this.readmeCache.delete(cacheKey);
    if (this.readmeCache.size >= GITHUB_README_CACHE_MAX_ENTRIES) {
      const oldest = this.readmeCache.keys().next();
      if (!oldest.done) {
        this.readmeCache.delete(oldest.value);
      }
    }
    this.readmeCache.set(cacheKey, { readme, expiresAt: now + GITHUB_README_CACHE_TTL_MS });
  }

  /**
   * `public` only when the repo metadata endpoint confirms the repository is
   * public. Called ONLY when a token is configured (see the class doc):
   * private and `internal` repos — anything the requesting LFX user could
   * not read anonymously — are refused before the README request, so the
   * BFF's token can never be used to exfiltrate them.
   *
   * Fail-closed still means fail-HONEST. The gate never lets a non-public
   * repo through, but it distinguishes "GitHub told us this repo is not
   * publicly readable" (`not-public`, including a 404: the repository is not
   * visible to us) from "we could not ask" (`fetch-failed` — rate limit,
   * 5xx). Both skip the README; only the second is worth retrying, and the
   * result copy says so. Never throws for a status; a transport error
   * propagates to the caller's catch, which records `fetch-failed`.
   */
  private async checkRepoVisibility(req: Request, repo: { owner: string; repo: string }): Promise<'public' | 'not-public' | 'fetch-failed'> {
    const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders('application/vnd.github+json'),
      signal: AbortSignal.timeout(GITHUB_README_TIMEOUT_MS),
    });

    if (!response.ok) {
      this.logFailedResponse(req, 'GitHub repo visibility check', response, repo);
      // 404 is GitHub's answer for "not visible to this credential" — a
      // definitive not-public. Anything else (403 rate limit, 5xx) means the
      // question went unanswered.
      return response.status === 404 ? 'not-public' : 'fetch-failed';
    }

    const metadata = (await response.json()) as { private?: boolean; visibility?: string };
    if (metadata.private !== false || metadata.visibility !== 'public') {
      logger.warning(req, 'github_readme_fetch', 'Repository is not public — refusing authenticated README fetch; generation proceeds without a README', {
        owner: repo.owner,
        repo: repo.repo,
        visibility: metadata.visibility,
      });
      return 'not-public';
    }
    return 'public';
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
}
