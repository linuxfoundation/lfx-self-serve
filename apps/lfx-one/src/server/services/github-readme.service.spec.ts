// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('@lfx-one/shared/constants', async () => {
  const constants = await vi.importActual('../../../../../packages/shared/src/constants/foundation-message.constants');
  return constants;
});
// Same reason as the constants mock above: the `@lfx-one/shared/*` alias isn't
// wired into this app's vitest config with Angular-free resolution, so the URL
// parser is re-exported from its real (pure, Angular-free) source module —
// the spec exercises the REAL parsing the service ships with.
vi.mock('@lfx-one/shared/utils', async () => vi.importActual('../../../../../packages/shared/src/utils/github-url.utils'));

import type { Request } from 'express';

import { FOUNDATION_MESSAGE_README_MAX_CHARS, FOUNDATION_MESSAGE_README_TRUNCATION_MARKER } from '@lfx-one/shared/constants';

import { GithubReadmeService } from './github-readme.service';

const req = { path: '/api/mktg-agents/foundation-message/generate' } as unknown as Request;

/** ok text Response stand-in. */
const textResponse = (text: string, ok = true, status = 200, headers: Record<string, string> = {}): Response =>
  ({ ok, status, headers: new Headers(headers), text: () => Promise.resolve(text) }) as unknown as Response;

/** ok JSON Response stand-in (repo metadata endpoint). */
const jsonResponse = (body: unknown, ok = true, status = 200, headers: Record<string, string> = {}): Response =>
  ({ ok, status, headers: new Headers(headers), json: () => Promise.resolve(body) }) as unknown as Response;

/** Repo metadata for a plain public repository. */
const publicRepoMetadata = { private: false, visibility: 'public' };

/**
 * The README fetch is strictly best-effort input plumbing for an agent with
 * no web access: the SSRF guard (only api.github.com is ever fetched, and
 * only for URLs that parse as github.com repos), the confused-deputy guard
 * (an authenticated fetch first verifies the repo is public, so the BFF's
 * token cannot leak private READMEs for user-named repos), the size cap with
 * an explicit truncation marker, and the never-throws contract are the
 * behaviors a regression would silently break.
 */
describe('GithubReadmeService', () => {
  let service: GithubReadmeService;
  let fetchMock: ReturnType<typeof vi.fn>;

  /** The README half of the fetch result — the outcome half has its own describe below. */
  const readmeOf = async (url: string, instance?: GithubReadmeService): Promise<string | null> => (await (instance ?? service).fetchReadme(req, url)).readme;

  beforeEach(() => {
    service = new GithubReadmeService();
    fetchMock = vi.fn().mockResolvedValue(textResponse('# Readme'));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('SSRF guard — the user URL is parsed, never fetched', () => {
    it('fetches ONLY the GitHub API readme endpoint for a github.com repo URL', async () => {
      const readme = await readmeOf('https://github.com/example-org/example-repo');

      expect(readme).toBe('# Readme');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/example-org/example-repo/readme');
    });

    it('resolves owner/repo from README blob URLs, .git suffixes, and schemeless URLs', async () => {
      for (const url of [
        'https://github.com/example-org/example-repo/blob/main/README.md',
        'https://github.com/example-org/example-repo.git',
        'github.com/example-org/example-repo',
      ]) {
        fetchMock.mockClear();
        // A fresh instance per URL: all three resolve to the same repo, and a
        // shared instance would serve iterations 2+ from the README cache.
        await readmeOf(url, new GithubReadmeService());
        expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/example-org/example-repo/readme');
      }
    });

    it('never fetches for non-GitHub hosts, malformed URLs, or hostile path segments', async () => {
      for (const url of [
        'https://gitlab.com/example-org/example-repo',
        'https://github.com.evil.example/example-org/example-repo',
        'https://169.254.169.254/latest/meta-data',
        'not a url at all',
      ]) {
        expect(await readmeOf(url)).toBeNull();
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  /**
   * An organization URL (`github.com/<org>`) names no repository, which is
   * exactly what silently cost a live run its README. It is not a dead end:
   * GitHub renders an organization's profile from `<org>/.github` at
   * `profile/README.md`, so that is attempted before giving up — and when it
   * misses, the give-up is clean and REPORTED, never silent.
   */
  describe('organization URLs — try the profile README before giving up', () => {
    it('fetches the organization profile README for an owner-only URL', async () => {
      fetchMock.mockResolvedValue(textResponse('# We are Example Org'));

      const result = await service.fetchReadme(req, 'https://github.com/example-org');

      expect(result.readme).toBe('# We are Example Org');
      expect(result.outcome).toEqual({ fetched: true, source: 'org-profile' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/example-org/.github/contents/profile/README.md');
    });

    it('gives up cleanly — and says why — when the organization has no profile README', async () => {
      fetchMock.mockResolvedValue(textResponse('', false, 404));

      const result = await service.fetchReadme(req, 'https://github.com/example-org');

      expect(result.readme).toBeNull();
      expect(result.outcome).toEqual({ fetched: false, skipReason: 'not-a-repo-url' });
    });

    it('logs the organization fallback at info — a skipped README must be greppable, not debug-only', async () => {
      const { logger } = await import('./logger.service');
      fetchMock.mockResolvedValue(textResponse('', false, 404));

      await service.fetchReadme(req, 'https://github.com/example-org');

      expect(logger.info).toHaveBeenCalledWith(req, 'github_readme_fetch', expect.stringContaining('organization profile README'), expect.anything());
      expect(logger.info).toHaveBeenCalledWith(
        req,
        'github_readme_fetch',
        expect.stringContaining('without a README'),
        expect.objectContaining({ reason: 'not-a-repo-url' })
      );
    });

    it('runs the organization fallback through the SAME visibility gate as any repo', async () => {
      vi.stubEnv('GITHUB_API_TOKEN', 'ghp_test-token');
      fetchMock.mockResolvedValueOnce(jsonResponse({ private: true, visibility: 'private' }));

      expect((await service.fetchReadme(req, 'https://github.com/example-org')).readme).toBeNull();

      // Only the metadata call on the .github repo — the contents endpoint was never hit.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/example-org/.github');
    });

    it('caches the profile README separately from the .github repo README', async () => {
      fetchMock.mockResolvedValue(textResponse('# Profile'));

      await service.fetchReadme(req, 'https://github.com/example-org');
      await service.fetchReadme(req, 'https://github.com/example-org/.github');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/example-org/.github/contents/profile/README.md');
      expect(fetchMock.mock.calls[1][0]).toBe('https://api.github.com/repos/example-org/.github/readme');
    });
  });

  /**
   * Best-effort must not mean silent: a document generated without a README is
   * materially thinner, so every attempt reports WHY it produced nothing and
   * the run surfaces it to the user.
   */
  describe('outcome reporting — why there is no README', () => {
    it('reports a repository README as fetched, with its source', async () => {
      expect((await service.fetchReadme(req, 'https://github.com/example-org/example-repo')).outcome).toEqual({ fetched: true, source: 'repository' });
    });

    it('reports an unparsable / non-GitHub URL as not-a-repo-url', async () => {
      expect((await service.fetchReadme(req, 'https://gitlab.com/example-org/example-repo')).outcome).toEqual({ fetched: false, skipReason: 'not-a-repo-url' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('logs the unrecognized URL at info with its reason — this skip used to be debug-only', async () => {
      const { logger } = await import('./logger.service');

      await service.fetchReadme(req, 'https://gitlab.com/example-org/example-repo');

      expect(logger.info).toHaveBeenCalledWith(
        req,
        'github_readme_fetch',
        expect.stringContaining('not a recognizable'),
        expect.objectContaining({ reason: 'not-a-repo-url' })
      );
    });

    it('separates an absent README (404) from GitHub failing us (5xx, timeout)', async () => {
      fetchMock.mockResolvedValue(textResponse('', false, 404));
      expect((await service.fetchReadme(req, 'https://github.com/example-org/example-repo')).outcome).toEqual({ fetched: false, skipReason: 'no-readme' });

      fetchMock.mockResolvedValue(textResponse('', false, 500));
      expect((await service.fetchReadme(req, 'https://github.com/example-org/other-repo')).outcome).toEqual({ fetched: false, skipReason: 'fetch-failed' });

      fetchMock.mockRejectedValue(new Error('timeout'));
      expect((await service.fetchReadme(req, 'https://github.com/example-org/third-repo')).outcome).toEqual({ fetched: false, skipReason: 'fetch-failed' });
    });

    it('reports a blank README body as no-readme rather than a fetch failure', async () => {
      fetchMock.mockResolvedValue(textResponse('   \n  '));
      expect((await service.fetchReadme(req, 'https://github.com/example-org/example-repo')).outcome).toEqual({ fetched: false, skipReason: 'no-readme' });
    });
  });

  describe('never blocks the run', () => {
    it('returns null on a non-ok response (missing README, rate limit)', async () => {
      fetchMock.mockResolvedValue(textResponse('', false, 404));
      expect(await readmeOf('https://github.com/example-org/example-repo')).toBeNull();
    });

    it('returns null when the fetch throws (timeout, DNS) instead of propagating', async () => {
      fetchMock.mockRejectedValue(new Error('boom'));
      await expect(readmeOf('https://github.com/example-org/example-repo')).resolves.toBeNull();
    });

    it('returns null for a blank README body', async () => {
      fetchMock.mockResolvedValue(textResponse('   \n  '));
      expect(await readmeOf('https://github.com/example-org/example-repo')).toBeNull();
    });
  });

  describe('authentication & rate limiting', () => {
    it('sends no Authorization header when GITHUB_API_TOKEN is unset', async () => {
      await readmeOf('https://github.com/example-org/example-repo');

      const headers = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers;
      expect('Authorization' in headers).toBe(false);
    });

    it('sends a Bearer Authorization header when GITHUB_API_TOKEN is set (raises the 60/hr shared-IP cap)', async () => {
      vi.stubEnv('GITHUB_API_TOKEN', 'ghp_test-token');
      fetchMock.mockResolvedValueOnce(jsonResponse(publicRepoMetadata)).mockResolvedValueOnce(textResponse('# Readme'));

      expect(await readmeOf('https://github.com/example-org/example-repo')).toBe('# Readme');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      for (const call of fetchMock.mock.calls) {
        expect((call[1] as { headers: Record<string, string> }).headers['Authorization']).toBe('Bearer ghp_test-token');
      }
    });

    it('verifies repo visibility BEFORE the authenticated README request when a token is set', async () => {
      vi.stubEnv('GITHUB_API_TOKEN', 'ghp_test-token');
      fetchMock.mockResolvedValueOnce(jsonResponse(publicRepoMetadata)).mockResolvedValueOnce(textResponse('# Readme'));

      await readmeOf('https://github.com/example-org/example-repo');

      expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/example-org/example-repo');
      expect(fetchMock.mock.calls[1][0]).toBe('https://api.github.com/repos/example-org/example-repo/readme');
    });

    it('refuses the authenticated README fetch for a private repo — the BFF token must not be a read oracle', async () => {
      vi.stubEnv('GITHUB_API_TOKEN', 'ghp_test-token');
      fetchMock.mockResolvedValueOnce(jsonResponse({ private: true, visibility: 'private' }));

      expect(await readmeOf('https://github.com/example-org/secret-repo')).toBeNull();

      // Only the metadata call — the README endpoint was never hit.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/example-org/secret-repo');
    });

    it('refuses org-internal repos (visibility !== public) even when not marked private', async () => {
      vi.stubEnv('GITHUB_API_TOKEN', 'ghp_test-token');
      fetchMock.mockResolvedValueOnce(jsonResponse({ private: false, visibility: 'internal' }));

      expect(await readmeOf('https://github.com/example-org/internal-repo')).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('fails closed when the visibility check itself fails — no README fetch on an unverified repo', async () => {
      vi.stubEnv('GITHUB_API_TOKEN', 'ghp_test-token');
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 404));

      expect(await readmeOf('https://github.com/example-org/example-repo')).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('skips the visibility check without a token — unauthenticated GitHub cannot see private repos anyway', async () => {
      expect(await readmeOf('https://github.com/example-org/example-repo')).toBe('# Readme');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/example-org/example-repo/readme');
    });

    it('logs a spent rate limit (403 + x-ratelimit-remaining: 0) distinctly from an ordinary missing README', async () => {
      const { logger } = await import('./logger.service');
      fetchMock.mockResolvedValue(textResponse('', false, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1750000000' }));

      expect(await readmeOf('https://github.com/example-org/example-repo')).toBeNull();

      expect(logger.warning).toHaveBeenCalledWith(
        req,
        'github_readme_fetch',
        expect.stringContaining('rate-limited'),
        expect.objectContaining({ status: 403, rate_limited: true })
      );
    });

    it('logs a plain 404 as a non-rate-limit failure', async () => {
      const { logger } = await import('./logger.service');
      fetchMock.mockResolvedValue(textResponse('', false, 404));

      expect(await readmeOf('https://github.com/example-org/example-repo')).toBeNull();

      expect(logger.warning).toHaveBeenCalledWith(
        req,
        'github_readme_fetch',
        expect.not.stringContaining('rate-limited'),
        expect.objectContaining({ status: 404, rate_limited: false })
      );
    });
  });

  describe('size cap', () => {
    it('truncates an oversized README with an explicit marker — never a silent clip', async () => {
      fetchMock.mockResolvedValue(textResponse('x'.repeat(FOUNDATION_MESSAGE_README_MAX_CHARS + 100)));

      const readme = await readmeOf('https://github.com/example-org/example-repo');

      expect(readme?.length).toBe(FOUNDATION_MESSAGE_README_MAX_CHARS + FOUNDATION_MESSAGE_README_TRUNCATION_MARKER.length);
      expect(readme?.endsWith(FOUNDATION_MESSAGE_README_TRUNCATION_MARKER)).toBe(true);
    });

    it('passes a within-cap README through untouched', async () => {
      fetchMock.mockResolvedValue(textResponse('# Small'));
      expect(await readmeOf('https://github.com/example-org/example-repo')).toBe('# Small');
    });
  });

  /**
   * Message Foundation regeneration is a full resubmit of the same answers on
   * a fresh session, so an uncached fetch would spend another round-trip (and
   * another slice of the shared-IP rate-limit budget) per revision for a
   * `github_url` that has not changed.
   */
  describe('README cache', () => {
    it('serves a repeat fetch of the same repo from memory — one GitHub round-trip per revision loop', async () => {
      expect(await readmeOf('https://github.com/example-org/example-repo')).toBe('# Readme');
      expect(await readmeOf('https://github.com/example-org/example-repo')).toBe('# Readme');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('matches on the repo, not the URL spelling (GitHub is case-insensitive)', async () => {
      await readmeOf('https://github.com/Example-Org/Example-Repo');
      await readmeOf('https://github.com/example-org/example-repo/blob/main/README.md');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('caches the repo, never the whole answer set — a different repo still fetches', async () => {
      await readmeOf('https://github.com/example-org/example-repo');
      await readmeOf('https://github.com/example-org/other-repo');

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('re-fetches once the entry expires so an edited README is picked up', async () => {
      vi.useFakeTimers();
      try {
        await readmeOf('https://github.com/example-org/example-repo');
        vi.advanceTimersByTime(5 * 60_000 + 1);
        fetchMock.mockResolvedValue(textResponse('# Edited'));

        expect(await readmeOf('https://github.com/example-org/example-repo')).toBe('# Edited');
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('never caches a failure — a transient error must not suppress the next attempt', async () => {
      fetchMock.mockResolvedValueOnce(textResponse('', false, 500)).mockResolvedValueOnce(textResponse('# Readme'));

      expect(await readmeOf('https://github.com/example-org/example-repo')).toBeNull();
      expect(await readmeOf('https://github.com/example-org/example-repo')).toBe('# Readme');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('caches only what passed the visibility gate — a refused private repo leaves no entry', async () => {
      vi.stubEnv('GITHUB_API_TOKEN', 'ghp_test-token');
      fetchMock.mockResolvedValue(jsonResponse({ private: true, visibility: 'private' }));

      expect(await readmeOf('https://github.com/example-org/secret-repo')).toBeNull();
      expect(await readmeOf('https://github.com/example-org/secret-repo')).toBeNull();

      // Re-checked every time: the gate is never short-circuited by the cache.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
