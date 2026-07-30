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

import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';

import { ObjectStoreService } from './object-store.service';

const ORIGINAL_ENV = { ...process.env };

function buildReq(): any {
  return { path: '/test', log: {} };
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

    it('rethrows and does not create a bucket when HeadBucket fails and S3_CREATE_MISSING_BUCKET is not "true"', async () => {
      const headError = new Error('NotFound');
      sendMock.mockRejectedValueOnce(headError);

      await expect(service.ensureBucket()).rejects.toThrow('NotFound');
      expect(sendMock).toHaveBeenCalledOnce();
    });

    it('creates the bucket only when S3_CREATE_MISSING_BUCKET is exactly "true"', async () => {
      process.env['S3_CREATE_MISSING_BUCKET'] = 'true';
      sendMock.mockRejectedValueOnce(new Error('NotFound')).mockResolvedValueOnce({});

      await service.ensureBucket();

      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(sendMock.mock.calls[1][0]).toBeInstanceOf(CreateBucketCommand);
    });

    it('never creates a bucket based on S3_ENDPOINT_URL alone', async () => {
      process.env['S3_ENDPOINT_URL'] = 'http://localhost:5222';
      sendMock.mockRejectedValueOnce(new Error('NotFound'));

      await expect(service.ensureBucket()).rejects.toThrow('NotFound');
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

  describe('uploadProfilePicture', () => {
    it('uploads with a stable, sanitized key and the correct object metadata', async () => {
      sendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

      await service.uploadProfilePicture(buildReq(), '  Some.User@Example.com  ', Buffer.from('img'), 'image/png');

      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(sendMock.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
      const putCommand = sendMock.mock.calls[1][0];
      expect(putCommand).toBeInstanceOf(PutObjectCommand);
      expect(putCommand.input).toMatchObject({
        Bucket: 'avatars-bucket',
        Key: `avatars/${encodeURIComponent('some.user@example.com')}`,
        ContentType: 'image/png',
        CacheControl: 'public, max-age=31536000',
      });
    });

    it('returns a public_url with a cache-busting query param when CDN_URL_PREFIX is set', async () => {
      process.env['CDN_URL_PREFIX'] = 'https://cdn.example.com/';
      sendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

      const { url } = await service.uploadProfilePicture(buildReq(), 'user1', Buffer.from('img'), 'image/png');

      expect(url).toMatch(new RegExp(`^https://cdn\\.example\\.com/avatars/user1\\?v=\\d+$`));
    });

    it('returns a null url (degraded mode) when CDN_URL_PREFIX is unset', async () => {
      sendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

      const { url } = await service.uploadProfilePicture(buildReq(), 'user1', Buffer.from('img'), 'image/png');

      expect(url).toBeNull();
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
  });
});
