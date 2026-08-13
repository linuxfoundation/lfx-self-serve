// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { sendMock, s3ClientCtor } = vi.hoisted(() => {
  const sendMock = vi.fn();
  const s3ClientCtor = vi.fn(function (this: any, config: any) {
    this.config = config;
    this.send = sendMock;
  });
  return { sendMock, s3ClientCtor };
});

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  return { ...actual, S3Client: s3ClientCtor };
});

vi.mock('./logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { CreateBucketCommand, HeadBucketCommand, HeadObjectCommand, NotFound, PutObjectCommand } from '@aws-sdk/client-s3';

import { ObjectStoreService } from './object-store.service';

const ORIGINAL_ENV = { ...process.env };

function buildReq(): any {
  return { path: '/test', log: {} };
}

function buildNotFoundError(): NotFound {
  return new NotFound({ message: 'The specified bucket does not exist', $metadata: { httpStatusCode: 404 } });
}

function buildForbiddenError(): Error & { $metadata: { httpStatusCode: number } } {
  const error = new Error('Forbidden') as Error & { $metadata: { httpStatusCode: number } };
  error.$metadata = { httpStatusCode: 403 };
  return error;
}

describe('ObjectStoreService', () => {
  let service: ObjectStoreService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env['S3_ENDPOINT_URL'];
    delete process.env['CDN_URL_PREFIX'];
    delete process.env['S3_CREATE_MISSING_BUCKET'];
    process.env['S3_BUCKET'] = 'avatars-bucket';
    process.env['MARKETING_OS_ARTIFACTS_S3_BUCKET'] = 'marketing-os-artifacts-test';
    process.env['AWS_REGION'] = 'us-west-2';
    service = new ObjectStoreService();
  });

  describe('ensureBucket', () => {
    it('does not create a bucket when HeadBucket succeeds', async () => {
      sendMock.mockResolvedValueOnce({});

      await service.ensureBucket();

      expect(sendMock).toHaveBeenCalledOnce();
      expect(sendMock.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
    });

    it('rethrows and does not create a bucket when HeadBucket fails with a confirmed 404 and S3_CREATE_MISSING_BUCKET is not "true"', async () => {
      sendMock.mockRejectedValueOnce(buildNotFoundError());

      await expect(service.ensureBucket()).rejects.toThrow();
      expect(sendMock).toHaveBeenCalledOnce();
    });

    it('creates the bucket only when HeadBucket confirms a 404 and S3_CREATE_MISSING_BUCKET is exactly "true"', async () => {
      process.env['S3_CREATE_MISSING_BUCKET'] = 'true';
      sendMock.mockRejectedValueOnce(buildNotFoundError()).mockResolvedValueOnce({});

      await service.ensureBucket();

      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(sendMock.mock.calls[1][0]).toBeInstanceOf(CreateBucketCommand);
    });

    it('never creates a bucket based on S3_ENDPOINT_URL alone', async () => {
      process.env['S3_ENDPOINT_URL'] = 'http://localhost:5222';
      sendMock.mockRejectedValueOnce(buildNotFoundError());

      await expect(service.ensureBucket()).rejects.toThrow();
      expect(sendMock).toHaveBeenCalledOnce();
    });

    it('rethrows and does not create a bucket on a non-404 error (e.g. 403) even when S3_CREATE_MISSING_BUCKET is "true"', async () => {
      process.env['S3_CREATE_MISSING_BUCKET'] = 'true';
      sendMock.mockRejectedValueOnce(buildForbiddenError());

      await expect(service.ensureBucket()).rejects.toThrow('Forbidden');
      expect(sendMock).toHaveBeenCalledOnce();
    });
  });

  describe('readiness', () => {
    it('returns true when HeadBucket resolves', async () => {
      sendMock.mockResolvedValueOnce({});
      await expect(service.readiness()).resolves.toBe(true);
    });

    it('returns false when HeadBucket rejects', async () => {
      sendMock.mockRejectedValueOnce(new Error('down'));
      await expect(service.readiness()).resolves.toBe(false);
    });
  });

  describe('purpose-keyed buckets', () => {
    it('resolves the marketing-os-artifacts bucket from MARKETING_OS_ARTIFACTS_S3_BUCKET', async () => {
      sendMock.mockResolvedValueOnce({});

      await service.readiness('marketing-os-artifacts');

      expect(sendMock.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
      expect(sendMock.mock.calls[0][0].input.Bucket).toBe('marketing-os-artifacts-test');
    });

    it('rejects with no S3 call when the purpose bucket env var is unset', async () => {
      delete process.env['MARKETING_OS_ARTIFACTS_S3_BUCKET'];

      await expect(service.ensureBucket('marketing-os-artifacts')).rejects.toThrow('MARKETING_OS_ARTIFACTS_S3_BUCKET environment variable is required');
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('memoizes ensureBucket per purpose — one purpose failing does not poison the other', async () => {
      // avatars head succeeds; marketing head 404s without create permission
      sendMock.mockResolvedValueOnce({}).mockRejectedValueOnce(buildNotFoundError());

      await service.ensureBucket();
      await expect(service.ensureBucket('marketing-os-artifacts')).rejects.toThrow();

      // avatars stays memoized (no additional call)
      await service.ensureBucket();
      expect(sendMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('putObjectIfAbsent', () => {
    const key = 'brand-kit/testorbit/abc.md';
    const body = Buffer.from('# doc');

    it('skips the PUT when the object already exists (content-addressed no-op)', async () => {
      // ensureBucket HeadBucket, then HeadObject exists
      sendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

      const written = await service.putObjectIfAbsent(buildReq(), 'marketing-os-artifacts', key, body, 'text/markdown; charset=utf-8', 'private');

      expect(written).toBe(false);
      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(sendMock.mock.calls[1][0]).toBeInstanceOf(HeadObjectCommand);
    });

    it('writes the object with private cache-control into the purpose bucket when absent', async () => {
      sendMock
        .mockResolvedValueOnce({}) // ensureBucket HeadBucket
        .mockRejectedValueOnce(buildNotFoundError()) // HeadObject 404
        .mockResolvedValueOnce({}); // PutObject

      const written = await service.putObjectIfAbsent(buildReq(), 'marketing-os-artifacts', key, body, 'text/markdown; charset=utf-8', 'private');

      expect(written).toBe(true);
      const putCommand = sendMock.mock.calls[2][0];
      expect(putCommand).toBeInstanceOf(PutObjectCommand);
      expect(putCommand.input).toMatchObject({
        Bucket: 'marketing-os-artifacts-test',
        Key: key,
        ContentType: 'text/markdown; charset=utf-8',
        CacheControl: 'private',
      });
    });

    it('rethrows a non-404 HeadObject error instead of treating it as absent', async () => {
      sendMock.mockResolvedValueOnce({}).mockRejectedValueOnce(buildForbiddenError());

      await expect(service.putObjectIfAbsent(buildReq(), 'marketing-os-artifacts', key, body, 'text/markdown; charset=utf-8', 'private')).rejects.toThrow(
        'Forbidden'
      );
      expect(sendMock).toHaveBeenCalledTimes(2);
    });

    it('propagates the error when the PUT fails', async () => {
      sendMock.mockResolvedValueOnce({}).mockRejectedValueOnce(buildNotFoundError()).mockRejectedValueOnce(new Error('put failed'));

      await expect(service.putObjectIfAbsent(buildReq(), 'marketing-os-artifacts', key, body, 'text/markdown; charset=utf-8', 'private')).rejects.toThrow(
        'put failed'
      );
    });
  });

  describe('uploadProfilePicture', () => {
    it('uploads with a stable, sanitized (unencoded) key and the correct object metadata', async () => {
      sendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

      await service.uploadProfilePicture(buildReq(), '  Some.User@Example.com  ', Buffer.from('img'), 'image/png');

      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(sendMock.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
      const putCommand = sendMock.mock.calls[1][0];
      expect(putCommand).toBeInstanceOf(PutObjectCommand);
      expect(putCommand.input).toMatchObject({
        Bucket: 'avatars-bucket',
        Key: 'avatars/some.user@example.com',
        ContentType: 'image/png',
        CacheControl: 'public, max-age=86400',
      });
    });

    it('returns a public_url with a cache-busting query param when CDN_URL_PREFIX is set', async () => {
      process.env['CDN_URL_PREFIX'] = 'https://cdn.example.com/';
      sendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

      const { url } = await service.uploadProfilePicture(buildReq(), 'user1', Buffer.from('img'), 'image/png');

      expect(url).toMatch(new RegExp(`^https://cdn\\.example\\.com/avatars/user1\\?v=\\d+$`));
    });

    it('percent-encodes the username in the public URL (stored key stays unencoded) so the URL round-trips through HTTP decoding back to the stored key', async () => {
      process.env['CDN_URL_PREFIX'] = 'https://cdn.example.com/';
      sendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

      const { url } = await service.uploadProfilePicture(buildReq(), 'some.user@example.com', Buffer.from('img'), 'image/png');

      expect(url).toMatch(new RegExp(`^https://cdn\\.example\\.com/avatars/${encodeURIComponent('some.user@example.com')}\\?v=\\d+$`));
      const putCommand = sendMock.mock.calls[1][0];
      expect(putCommand.input.Key).toBe('avatars/some.user@example.com');
    });

    it('returns a null url (degraded mode) when CDN_URL_PREFIX is unset', async () => {
      sendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

      const { url } = await service.uploadProfilePicture(buildReq(), 'user1', Buffer.from('img'), 'image/png');

      expect(url).toBeNull();
    });

    it('propagates the error when PutObject fails', async () => {
      const putError = new Error('put failed');
      sendMock.mockResolvedValueOnce({}).mockRejectedValueOnce(putError);

      await expect(service.uploadProfilePicture(buildReq(), 'user1', Buffer.from('img'), 'image/png')).rejects.toThrow('put failed');
    });

    it('rejects a bare-hostname CDN_URL_PREFIX instead of silently producing a relative public URL', async () => {
      process.env['CDN_URL_PREFIX'] = 'avatars-public.dev.downloads.lfx.community';
      sendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

      await expect(service.uploadProfilePicture(buildReq(), 'user1', Buffer.from('img'), 'image/png')).rejects.toThrow(
        /CDN_URL_PREFIX must be an absolute http\(s\) URL/
      );
    });

    it('escapes "/" in the username into the key instead of erroring, and the URL round-trips back to the exact stored key with a single decode', async () => {
      process.env['CDN_URL_PREFIX'] = 'https://cdn.example.com/';
      sendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

      const { url } = await service.uploadProfilePicture(buildReq(), 'a/b', Buffer.from('img'), 'image/png');

      const putCommand = sendMock.mock.calls[1][0];
      expect(putCommand.input.Key).toBe('avatars/a%2Fb');
      expect(decodeURIComponent(new URL(url!).pathname)).toBe('/avatars/a%2Fb');
    });

    it('escapes a literal "%" so it cannot be mistaken for the "/" escape sequence (collision-free)', async () => {
      sendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});
      // 'a/b' and the literal text 'a%2fb' must not sanitize to the same key.
      await service.uploadProfilePicture(buildReq(), 'a/b', Buffer.from('img'), 'image/png');
      const firstKey = sendMock.mock.calls[1][0].input.Key;

      sendMock.mockResolvedValueOnce({});
      await service.uploadProfilePicture(buildReq(), 'a%2fb', Buffer.from('img'), 'image/png');
      const secondKey = sendMock.mock.calls[2][0].input.Key;

      expect(firstKey).toBe('avatars/a%2Fb');
      expect(secondKey).toBe('avatars/a%252fb');
      expect(firstKey).not.toBe(secondKey);
    });
  });

  describe('client construction', () => {
    it('enables forcePathStyle and omits endpoint when S3_ENDPOINT_URL is unset', async () => {
      sendMock.mockResolvedValueOnce({});
      await service.readiness();

      expect(s3ClientCtor).toHaveBeenCalledOnce();
      const config = s3ClientCtor.mock.calls[0][0];
      expect(config.forcePathStyle).toBe(true);
      expect(config.endpoint).toBeUndefined();
    });

    it('passes the endpoint override when S3_ENDPOINT_URL is set', async () => {
      process.env['S3_ENDPOINT_URL'] = 'http://localhost:5222';
      sendMock.mockResolvedValueOnce({});
      await service.readiness();

      const config = s3ClientCtor.mock.calls[0][0];
      expect(config.endpoint).toBe('http://localhost:5222');
      expect(config.forcePathStyle).toBe(true);
    });

    it('rejects with no S3 call when AWS_REGION is unset — never falls back to a default region', async () => {
      delete process.env['AWS_REGION'];

      await expect(service.ensureBucket()).rejects.toThrow('AWS_REGION environment variable is required');
      expect(sendMock).not.toHaveBeenCalled();
      expect(s3ClientCtor).not.toHaveBeenCalled();
    });
  });
});
