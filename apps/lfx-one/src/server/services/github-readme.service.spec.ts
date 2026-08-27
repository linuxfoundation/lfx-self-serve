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
      const readme = await service.fetchReadme(req, 'https://github.com/example-org/example-repo');

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
        await new GithubReadmeService().fetchReadme(req, url);
        expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/example-org/example-repo/readme');
      }
    });

    it('never fetches for non-GitHub hosts, malformed URLs, or hostile path segments', async () => {
      for (const url of [
        'https://gitlab.com/example-org/example-repo',
        'https://github.com.evil.example/example-org/example-repo',
        'https://169.254.169.254/latest/meta-data',
        'not a url at all',
        'https://github.com/only-owner',
      ]) {
        expect(await service.fetchReadme(req, url)).toBeNull();
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('never blocks the run', () => {
    it('returns null on a non-ok response (missing README, rate limit)', async () => {
      fetchMock.mockResolvedValue(textResponse('', false, 404));
      expect(await service.fetchReadme(req, 'https://github.com/example-org/example-repo')).toBeNull();
    });

    it('returns null when the fetch throws (timeout, DNS) instead of propagating', async () => {
      fetchMock.mockRejectedValue(new Error('boom'));
      await expect(service.fetchReadme(req, 'https://github.com/example-org/example-repo')).resolves.toBeNull();
    });

    it('returns null for a blank README body', async () => {
      fetchMock.mockResolvedValue(textResponse('   \n  '));
      expect(await service.fetchReadme(req, 'https://github.com/example-org/example-repo')).toBeNull();
    });
  });

  describe('authentication & rate limiting', () => {
    it('sends no Authorization header when GITHUB_API_TOKEN is unset', async () => {
      await service.fetchReadme(req, 'https://github.com/example-org/example-repo');

      const headers = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers;
      expect('Authorization' in headers).toBe(false);
    });

    it('sends a Bearer Authorization header when GITHUB_API_TOKEN is set (raises the 60/hr shared-IP cap)', async () => {
      vi.stubEnv('GITHUB_API_TOKEN', 'ghp_test-token');
      fetchMock.mockResolvedValueOnce(jsonResponse(publicRepoMetadata)).mockResolvedValueOnce(textResponse('# Readme'));

      expect(await service.fetchReadme(req, 'https://github.com/example-org/example-repo')).toBe('# Readme');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      for (const call of fetchMock.mock.calls) {
        expect((call[1] as { headers: Record<string, string> }).headers['Authorization']).toBe('Bearer ghp_test-token');
      }
    });

    it('verifies repo visibility BEFORE the authenticated README request when a token is set', async () => {
      vi.stubEnv('GITHUB_API_TOKEN', 'ghp_test-token');
      fetchMock.mockResolvedValueOnce(jsonResponse(publicRepoMetadata)).mockResolvedValueOnce(textResponse('# Readme'));

      await service.fetchReadme(req, 'https://github.com/example-org/example-repo');

      expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/example-org/example-repo');
      expect(fetchMock.mock.calls[1][0]).toBe('https://api.github.com/repos/example-org/example-repo/readme');
    });

    it('refuses the authenticated README fetch for a private repo — the BFF token must not be a read oracle', async () => {
      vi.stubEnv('GITHUB_API_TOKEN', 'ghp_test-token');
      fetchMock.mockResolvedValueOnce(jsonResponse({ private: true, visibility: 'private' }));

      expect(await service.fetchReadme(req, 'https://github.com/example-org/secret-repo')).toBeNull();

      // Only the metadata call — the README endpoint was never hit.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/example-org/secret-repo');
    });

    it('refuses org-internal repos (visibility !== public) even when not marked private', async () => {
      vi.stubEnv('GITHUB_API_TOKEN', 'ghp_test-token');
      fetchMock.mockResolvedValueOnce(jsonResponse({ private: false, visibility: 'internal' }));

      expect(await service.fetchReadme(req, 'https://github.com/example-org/internal-repo')).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('fails closed when the visibility check itself fails — no README fetch on an unverified repo', async () => {
      vi.stubEnv('GITHUB_API_TOKEN', 'ghp_test-token');
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 404));

      expect(await service.fetchReadme(req, 'https://github.com/example-org/example-repo')).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('skips the visibility check without a token — unauthenticated GitHub cannot see private repos anyway', async () => {
      expect(await service.fetchReadme(req, 'https://github.com/example-org/example-repo')).toBe('# Readme');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/example-org/example-repo/readme');
    });

    it('logs a spent rate limit (403 + x-ratelimit-remaining: 0) distinctly from an ordinary missing README', async () => {
      const { logger } = await import('./logger.service');
      fetchMock.mockResolvedValue(textResponse('', false, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1750000000' }));

      expect(await service.fetchReadme(req, 'https://github.com/example-org/example-repo')).toBeNull();

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

      expect(await service.fetchReadme(req, 'https://github.com/example-org/example-repo')).toBeNull();

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

      const readme = await service.fetchReadme(req, 'https://github.com/example-org/example-repo');

      expect(readme?.length).toBe(FOUNDATION_MESSAGE_README_MAX_CHARS + FOUNDATION_MESSAGE_README_TRUNCATION_MARKER.length);
      expect(readme?.endsWith(FOUNDATION_MESSAGE_README_TRUNCATION_MARKER)).toBe(true);
    });

    it('passes a within-cap README through untouched', async () => {
      fetchMock.mockResolvedValue(textResponse('# Small'));
      expect(await service.fetchReadme(req, 'https://github.com/example-org/example-repo')).toBe('# Small');
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
      expect(await service.fetchReadme(req, 'https://github.com/example-org/example-repo')).toBe('# Readme');
      expect(await service.fetchReadme(req, 'https://github.com/example-org/example-repo')).toBe('# Readme');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('matches on the repo, not the URL spelling (GitHub is case-insensitive)', async () => {
      await service.fetchReadme(req, 'https://github.com/Example-Org/Example-Repo');
      await service.fetchReadme(req, 'https://github.com/example-org/example-repo/blob/main/README.md');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('caches the repo, never the whole answer set — a different repo still fetches', async () => {
      await service.fetchReadme(req, 'https://github.com/example-org/example-repo');
      await service.fetchReadme(req, 'https://github.com/example-org/other-repo');

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('re-fetches once the entry expires so an edited README is picked up', async () => {
      vi.useFakeTimers();
      try {
        await service.fetchReadme(req, 'https://github.com/example-org/example-repo');
        vi.advanceTimersByTime(5 * 60_000 + 1);
        fetchMock.mockResolvedValue(textResponse('# Edited'));

        expect(await service.fetchReadme(req, 'https://github.com/example-org/example-repo')).toBe('# Edited');
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('never caches a failure — a transient error must not suppress the next attempt', async () => {
      fetchMock.mockResolvedValueOnce(textResponse('', false, 500)).mockResolvedValueOnce(textResponse('# Readme'));

      expect(await service.fetchReadme(req, 'https://github.com/example-org/example-repo')).toBeNull();
      expect(await service.fetchReadme(req, 'https://github.com/example-org/example-repo')).toBe('# Readme');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('caches only what passed the visibility gate — a refused private repo leaves no entry', async () => {
      vi.stubEnv('GITHUB_API_TOKEN', 'ghp_test-token');
      fetchMock.mockResolvedValue(jsonResponse({ private: true, visibility: 'private' }));

      expect(await service.fetchReadme(req, 'https://github.com/example-org/secret-repo')).toBeNull();
      expect(await service.fetchReadme(req, 'https://github.com/example-org/secret-repo')).toBeNull();

      // Re-checked every time: the gate is never short-circuited by the cache.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
