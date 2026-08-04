// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { getPublicProfilesBucketUrl, PublicProfileService, resolvePublicFlag } from './public-profile.service';

const req = {} as unknown as Request;
const BUCKET_ENV = 'PUBLIC_PROFILES_BUCKET_URL';

/** Builds a minimal fetch Response stand-in with the given status and text body. */
function mockResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    text: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env[BUCKET_ENV];
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getPublicProfilesBucketUrl', () => {
  it('returns an empty string when the env var is unset (no baked-in default)', () => {
    expect(getPublicProfilesBucketUrl()).toBe('');
  });

  it('reads PUBLIC_PROFILES_BUCKET_URL and trims surrounding whitespace and trailing slashes', () => {
    process.env[BUCKET_ENV] = '  https://profiles-bucket.example.com///  ';
    expect(getPublicProfilesBucketUrl()).toBe('https://profiles-bucket.example.com');
  });
});

describe('resolvePublicFlag', () => {
  it('treats an absent flag as public (published implies public)', () => {
    expect(resolvePublicFlag({})).toBe(true);
  });

  it('treats a truthy PascalCase IsPublic as public', () => {
    expect(resolvePublicFlag({ IsPublic: true })).toBe(true);
  });

  it('treats an explicit false as private (PascalCase)', () => {
    expect(resolvePublicFlag({ IsPublic: false })).toBe(false);
  });

  it('treats an explicit false as private (camelCase)', () => {
    expect(resolvePublicFlag({ isPublic: false })).toBe(false);
  });
});

describe('PublicProfileService.getPublicProfile', () => {
  const service = new PublicProfileService();
  const TEST_BUCKET = 'https://test-bucket.example.com';

  beforeEach(() => {
    process.env[BUCKET_ENV] = TEST_BUCKET;
  });

  it('rejects a malformed username without fetching', async () => {
    const result = await service.getPublicProfile(req, '../secrets');
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws a 503 MicroserviceError when the bucket is not configured, without fetching', async () => {
    delete process.env[BUCKET_ENV];
    await expect(service.getPublicProfile(req, 'jane')).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws a 503 MicroserviceError when the configured bucket URL is malformed, without fetching', async () => {
    process.env[BUCKET_ENV] = 'not a url';
    await expect(service.getPublicProfile(req, 'jane')).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws a 503 MicroserviceError when the bucket URL uses a non-http scheme, without fetching', async () => {
    process.env[BUCKET_ENV] = 'file:///etc';
    await expect(service.getPublicProfile(req, 'jane')).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('URL-encodes the username into the bucket object key', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, JSON.stringify({ IsPublic: true, basic: { Name: 'Jane' } })));
    await service.getPublicProfile(req, 'jane.doe');
    expect(fetchMock).toHaveBeenCalledWith(`${TEST_BUCKET}/jane.doe.json`, expect.objectContaining({ signal: expect.anything() }));
  });

  it('returns null when the artifact does not exist (404)', async () => {
    fetchMock.mockResolvedValue(mockResponse(404, 'Not Found'));
    expect(await service.getPublicProfile(req, 'ghost')).toBeNull();
  });

  it('returns null when S3 forbids access (403)', async () => {
    fetchMock.mockResolvedValue(mockResponse(403, 'Forbidden'));
    expect(await service.getPublicProfile(req, 'ghost')).toBeNull();
  });

  it('returns the parsed profile with isPublic true for a public artifact', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, JSON.stringify({ IsPublic: true, basic: { Name: 'Jane Apple' } })));
    const result = await service.getPublicProfile(req, 'jane');
    expect(result).toEqual({ IsPublic: true, basic: { Name: 'Jane Apple' }, isPublic: true });
  });

  it('normalizes isPublic to false for a private artifact and preserves the payload', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, JSON.stringify({ IsPublic: false, basic: { Name: 'Jane' } })));
    const result = await service.getPublicProfile(req, 'jane');
    expect(result?.isPublic).toBe(false);
  });

  it('throws a MicroserviceError on a non-404 upstream failure', async () => {
    fetchMock.mockResolvedValue(mockResponse(500, 'boom'));
    await expect(service.getPublicProfile(req, 'jane')).rejects.toBeInstanceOf(MicroserviceError);
  });

  it('throws a MicroserviceError when the body is empty', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, '   '));
    await expect(service.getPublicProfile(req, 'jane')).rejects.toBeInstanceOf(MicroserviceError);
  });

  it('throws a MicroserviceError when the body is invalid JSON', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, '{not json'));
    await expect(service.getPublicProfile(req, 'jane')).rejects.toBeInstanceOf(MicroserviceError);
  });

  it('maps a fetch timeout to a 504 MicroserviceError', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    fetchMock.mockRejectedValue(timeout);
    await expect(service.getPublicProfile(req, 'jane')).rejects.toMatchObject({ statusCode: 504 });
  });

  it('maps a network failure to a 502 MicroserviceError', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));
    await expect(service.getPublicProfile(req, 'jane')).rejects.toMatchObject({ statusCode: 502 });
  });
});
