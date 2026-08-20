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
const textResponse = (text: string, ok = true, status = 200): Response => ({ ok, status, text: () => Promise.resolve(text) }) as unknown as Response;

/**
 * The README fetch is strictly best-effort input plumbing for an agent with
 * no web access: the SSRF guard (only api.github.com is ever fetched, and
 * only for URLs that parse as github.com repos), the size cap with an
 * explicit truncation marker, and the never-throws contract are the
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
        await service.fetchReadme(req, url);
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
});
