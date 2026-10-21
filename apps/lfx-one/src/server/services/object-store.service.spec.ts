// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { logger } from './logger.service';
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
  /** Scratch root for the file-backed store — never the app folder's default `.object-store`. */
  let localDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env['S3_ENDPOINT_URL'];
    delete process.env['CDN_URL_PREFIX'];
    delete process.env['S3_CREATE_MISSING_BUCKET'];
    delete process.env['OBJECT_STORE_LOCAL_DIR'];
    process.env['S3_BUCKET'] = 'avatars-bucket';
    process.env['MARKETING_OS_ARTIFACTS_S3_BUCKET'] = 'marketing-os-artifacts-test';
    process.env['AWS_REGION'] = 'us-west-2';
    localDir = await mkdtemp(join(tmpdir(), 'lfx-object-store-spec-'));
    service = new ObjectStoreService();
  });

  it('passes S3 preconditions and only treats contention as a failed comparison', async () => {
    sendMock.mockResolvedValue({});
    const input = { body: Buffer.from('{}'), contentType: 'application/json', cacheControl: 'private', ifNoneMatch: '*' as const };
    await expect(service.putConditionalObject(buildReq(), 'marketing-os-artifacts', 'current.json', input)).resolves.toBe(true);
    expect(sendMock.mock.calls.at(-1)?.[0].input).toMatchObject({ IfNoneMatch: '*' });
    sendMock.mockRejectedValue({ $metadata: { httpStatusCode: 412 } });
    await expect(
      service.putConditionalObject(buildReq(), 'marketing-os-artifacts', 'current.json', { ...input, ifNoneMatch: undefined, ifMatch: 'observed' })
    ).resolves.toBe(false);
    expect(sendMock.mock.calls.at(-1)?.[0].input).toMatchObject({ IfMatch: 'observed' });
    sendMock.mockRejectedValue(buildForbiddenError());
    await expect(service.putConditionalObject(buildReq(), 'marketing-os-artifacts', 'current.json', input)).rejects.toThrow('Forbidden');
  });

  it('rejects absent or conflicting conditional-write preconditions with a typed validation error', async () => {
    const input = { body: Buffer.from('{}'), contentType: 'application/json', cacheControl: 'private' };
    for (const invalid of [input, { ...input, ifMatch: 'token', ifNoneMatch: '*' as const }]) {
      await expect(service.putConditionalObject(buildReq(), 'marketing-os-artifacts', 'current.json', invalid)).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });
    }
    expect(sendMock).not.toHaveBeenCalled();
  });

  afterEach(async () => {
    await rm(localDir, { recursive: true, force: true });
  });

  it('uses the main conditional API for private creates/replacements without logging the key', async () => {
    let exists = false;
    sendMock.mockImplementation(async (command) => {
      if (command instanceof GetObjectCommand) {
        if (!exists) throw buildNotFoundError();
        return { Body: { transformToString: async () => 'first' }, ETag: 'observed-version' };
      }
      if (command instanceof PutObjectCommand) exists = true;
      return {};
    });
    const key = 'profiles/opaque/current.json';
    await service.putMutableObject(buildReq(), 'marketing-os-artifacts', key, {
      body: Buffer.from('first'),
      contentType: 'application/json',
      cacheControl: 'private',
    });
    await service.putMutableObject(buildReq(), 'marketing-os-artifacts', key, {
      body: Buffer.from('second'),
      contentType: 'application/json',
      cacheControl: 'private',
    });
    const puts = sendMock.mock.calls.map(([command]) => command).filter((command) => command instanceof PutObjectCommand);
    expect(puts.map((command) => command.input.Body)).toEqual([Buffer.from('first'), Buffer.from('second')]);
    expect(puts.map((command) => command.input.Key)).toEqual([key, key]);
    expect(puts[0].input).toMatchObject({ IfNoneMatch: '*' });
    expect(puts[1].input).toMatchObject({ IfMatch: 'observed-version' });
    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain(key);
  });

  it('refuses a contended private write without retrying over a concurrent save', async () => {
    const key = 'profiles/opaque/current.json';
    sendMock.mockImplementation(async (command) => {
      if (command instanceof GetObjectCommand) return { Body: { transformToString: async () => 'first' }, ETag: 'observed-version' };
      if (command instanceof PutObjectCommand) throw { $metadata: { httpStatusCode: 412 } };
      return {};
    });
    await expect(
      service.putMutableObject(buildReq(), 'marketing-os-artifacts', key, {
        body: Buffer.from('second'),
        contentType: 'application/json',
        cacheControl: 'private',
      })
    ).rejects.toMatchObject({ code: 'OBJECT_STORE_REPLACE_FAILED' });
    const puts = sendMock.mock.calls.map(([command]) => command).filter((command) => command instanceof PutObjectCommand);
    expect(puts).toHaveLength(1);
    expect(puts[0].input).toMatchObject({ IfMatch: 'observed-version' });
    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain(key);
    expect(JSON.stringify(vi.mocked(logger.warning).mock.calls)).not.toContain(key);
  });

  it('reads private objects without logging keys, response bodies or provider error messages', async () => {
    const key = 'profiles/private-subject-hash/current.json';
    sendMock.mockResolvedValueOnce({ Body: { transformToString: async () => 'Private body' }, Metadata: {} });
    expect(await service.getPrivateObject(buildReq(), 'marketing-os-artifacts', key)).toMatchObject({ body: 'Private body' });
    sendMock.mockRejectedValueOnce(Object.assign(new Error(`PRIVATE_PROVIDER_MESSAGE ${key}`), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }));
    await expect(service.getPrivateObject(buildReq(), 'marketing-os-artifacts', key)).rejects.toMatchObject({ code: 'OBJECT_STORE_PRIVATE_READ_FAILED' });
    const logs = JSON.stringify([vi.mocked(logger.debug).mock.calls, vi.mocked(logger.warning).mock.calls, vi.mocked(logger.startOperation).mock.calls]);
    expect(logs).not.toContain(key);
    expect(logs).not.toContain('Private body');
    expect(logs).not.toContain('PRIVATE_PROVIDER_MESSAGE');
    expect(logs).toContain('AccessDenied');
  });
  it('creates private state only if absent, classifying contention without leaking its key', async () => {
    const key = 'profiles/private-subject-hash/current.json';
    const input = { body: Buffer.from('{}'), contentType: 'application/json', cacheControl: 'private' };
    sendMock.mockResolvedValue({});
    expect(await service.putPrivateObjectIfAbsent(buildReq(), 'marketing-os-artifacts', key, input)).toBe(true);
    expect(sendMock.mock.calls.at(-1)?.[0].input).toMatchObject({ IfNoneMatch: '*' });
    sendMock.mockRejectedValue({ $metadata: { httpStatusCode: 412 } });
    expect(await service.putPrivateObjectIfAbsent(buildReq(), 'marketing-os-artifacts', key, input)).toBe(false);
    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain(key);
  });

  it('deletes the current S3 key using only the deployed DeleteObject grant, without version operations or key logging', async () => {
    const key = 'profiles/private-subject-hash/current.json';
    sendMock.mockImplementation(async (command) => {
      if (command instanceof DeleteObjectCommand) return { DeleteMarker: true, VersionId: 'synthetic-marker' };
      throw new Error('Unexpected S3 operation');
    });
    await service.deletePrivateObject(buildReq(), 'marketing-os-artifacts', key);
    expect(sendMock).toHaveBeenCalledOnce();
    expect(sendMock.mock.calls[0][0].input).toEqual({ Bucket: 'marketing-os-artifacts-test', Key: key });
    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain(key);
    expect(JSON.stringify(vi.mocked(logger.startOperation).mock.calls)).not.toContain(key);
  });

  it('treats a confirmed missing bucket as an idempotent current-object deletion, but not a denied deletion', async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error('Missing bucket'), { name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } }));
    await expect(service.deletePrivateObject(buildReq(), 'marketing-os-artifacts', 'profiles/opaque/current.json')).resolves.toBeUndefined();
    const key = 'profiles/private-subject-hash/current.json';
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error(`Denied ${key}`), { name: 'AccessDenied', Code: 'AccessDenied', $metadata: { httpStatusCode: 403 } })
    );
    await expect(service.deletePrivateObject(buildReq(), 'marketing-os-artifacts', key)).rejects.toMatchObject({ code: 'OBJECT_STORE_DELETE_FAILED' });
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'object_store_delete', 'Private object storage operation failed', {
      storage_failure: { name: 'AccessDenied', code: 'AccessDenied', httpStatusCode: 403 },
    });
    expect(JSON.stringify(vi.mocked(logger.warning).mock.calls)).not.toContain(key);
  });

  it.each([
    { name: 'AccessDenied', Code: 'AccessDenied', status: 403 },
    { name: 'NoSuchBucket', code: 'NoSuchBucket', status: 404 },
    { name: 'NotImplemented', Code: 'NotImplemented', status: 501 },
    { name: 'SlowDown', code: 'SlowDown', status: 503 },
    { name: 'AccessDenied', status: 403 },
  ])('keeps $name storage failures diagnosable without logging private messages/keys', async (failure) => {
    const key = 'profiles/private-subject-hash/current.json';
    const error = Object.assign(new Error(`Private object ${key}`), failure, { $metadata: { httpStatusCode: failure.status } });
    sendMock.mockImplementation(async (command) => {
      if (command instanceof GetObjectCommand) throw buildNotFoundError();
      if (command instanceof PutObjectCommand) throw error;
      return {};
    });
    await expect(
      service.putMutableObject(buildReq(), 'marketing-os-artifacts', key, {
        body: Buffer.from('private'),
        contentType: 'application/json',
        cacheControl: 'private',
      })
    ).rejects.toMatchObject({ code: 'OBJECT_STORE_REPLACE_FAILED' });
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'object_store_replace', 'Private object storage operation failed', {
      storage_failure: { name: failure.name, code: failure.Code ?? failure.code, httpStatusCode: failure.status },
    });
    expect(JSON.stringify(vi.mocked(logger.warning).mock.calls)).not.toContain(key);
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

    it('logs a readiness failure at ERROR for non-degradable callers (avatar path keeps its severity)', async () => {
      sendMock.mockRejectedValueOnce(buildForbiddenError());

      await expect(service.ensureBucket()).rejects.toThrow('Forbidden');

      expect(logger.error).toHaveBeenCalledWith(undefined, 'object_store_ensure_bucket', expect.anything(), expect.anything(), expect.anything());
      expect(logger.warning).not.toHaveBeenCalled();
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

    it('serves the private marketing-os-artifacts purpose from the file-backed store when its bucket env var is unset — no S3 client, no S3 call', async () => {
      delete process.env['MARKETING_OS_ARTIFACTS_S3_BUCKET'];
      process.env['OBJECT_STORE_LOCAL_DIR'] = localDir;

      await service.ensureBucket('marketing-os-artifacts');

      expect(sendMock).not.toHaveBeenCalled();
      expect(s3ClientCtor).not.toHaveBeenCalled();
      await expect(stat(join(localDir, 'marketing-os-artifacts'))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    });

    it('keeps S3_BUCKET REQUIRED for the public avatars purpose even outside production — a CDN URL must never point at a file on disk', async () => {
      delete process.env['S3_BUCKET'];
      process.env['OBJECT_STORE_LOCAL_DIR'] = localDir;

      await expect(service.ensureBucket()).rejects.toThrow('S3_BUCKET environment variable is required');
      expect(sendMock).not.toHaveBeenCalled();
      await expect(stat(join(localDir, 'avatars'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('keeps the bucket env var REQUIRED under NODE_ENV=production — deployed environments never fall back to disk', async () => {
      delete process.env['MARKETING_OS_ARTIFACTS_S3_BUCKET'];
      process.env['NODE_ENV'] = 'production';
      process.env['OBJECT_STORE_LOCAL_DIR'] = localDir;

      await expect(service.ensureBucket('marketing-os-artifacts')).rejects.toThrow('MARKETING_OS_ARTIFACTS_S3_BUCKET environment variable is required');
      expect(sendMock).not.toHaveBeenCalled();
      await expect(stat(join(localDir, 'marketing-os-artifacts'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('selects the backend per purpose — a configured avatars bucket stays on S3 while an unconfigured artifacts purpose uses the folder', async () => {
      delete process.env['MARKETING_OS_ARTIFACTS_S3_BUCKET'];
      process.env['OBJECT_STORE_LOCAL_DIR'] = localDir;
      sendMock.mockResolvedValueOnce({});

      await service.ensureBucket();
      await service.ensureBucket('marketing-os-artifacts');

      expect(sendMock).toHaveBeenCalledOnce();
      expect(sendMock.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
      expect(sendMock.mock.calls[0][0].input.Bucket).toBe('avatars-bucket');
      await expect(stat(join(localDir, 'marketing-os-artifacts'))).resolves.toBeDefined();
      await expect(stat(join(localDir, 'avatars'))).rejects.toMatchObject({ code: 'ENOENT' });
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

  describe('putContentAddressedObject', () => {
    const key = 'brand-kit/testorbit/abc.md';
    const body = Buffer.from('# doc');

    it('skips the PUT when the object already exists (content-addressed no-op)', async () => {
      // ensureBucket HeadBucket, then HeadObject exists
      sendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

      const written = await service.putContentAddressedObject(buildReq(), 'marketing-os-artifacts', key, body, 'text/markdown; charset=utf-8', 'private');

      expect(written).toBe(false);
      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(sendMock.mock.calls[1][0]).toBeInstanceOf(HeadObjectCommand);
    });

    it('still skips the PUT when the caller says the stored metadata is not superseded', async () => {
      sendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({ Metadata: { version: '3' } });
      const refreshMetadataWhen = vi.fn(() => false);

      const written = await service.putContentAddressedObject(
        buildReq(),
        'marketing-os-artifacts',
        key,
        body,
        'text/markdown; charset=utf-8',
        'private',
        undefined,
        {
          refreshMetadataWhen,
        }
      );

      expect(written).toBe(false);
      // The predicate reads the STORED metadata, so a caller can compare it
      // against what it is about to write.
      expect(refreshMetadataWhen).toHaveBeenCalledWith({ version: '3' });
      expect(sendMock).toHaveBeenCalledTimes(2);
    });

    it('rewrites the identical bytes with fresh metadata when the caller says the stored metadata is superseded', async () => {
      sendMock
        .mockResolvedValueOnce({}) // ensureBucket HeadBucket
        .mockResolvedValueOnce({ Metadata: { version: '1' } }) // HeadObject exists
        .mockResolvedValueOnce({}); // PutObject

      const written = await service.putContentAddressedObject(
        buildReq(),
        'marketing-os-artifacts',
        key,
        body,
        'text/markdown; charset=utf-8',
        'private',
        { version: '2' },
        {
          refreshMetadataWhen: (stored) => stored['version'] === '1',
        }
      );

      expect(written).toBe(true);
      const putCommand = sendMock.mock.calls[2][0];
      expect(putCommand).toBeInstanceOf(PutObjectCommand);
      expect(putCommand.input.Metadata).toEqual({ version: '2' });
      // Same key, same bytes — only the sidecar labels (and the store's
      // last-modified stamp) move forward.
      expect(putCommand.input.Key).toBe(key);
    });

    it('treats a missing predicate as the plain content-addressed no-op (no metadata read required)', async () => {
      sendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

      await expect(
        service.putContentAddressedObject(buildReq(), 'marketing-os-artifacts', key, body, 'text/markdown; charset=utf-8', 'private', { version: '9' })
      ).resolves.toBe(false);
      expect(sendMock).toHaveBeenCalledTimes(2);
    });

    it('writes the object with private cache-control into the purpose bucket when absent', async () => {
      sendMock
        .mockResolvedValueOnce({}) // ensureBucket HeadBucket
        .mockRejectedValueOnce(buildNotFoundError()) // HeadObject 404
        .mockResolvedValueOnce({}); // PutObject

      const written = await service.putContentAddressedObject(buildReq(), 'marketing-os-artifacts', key, body, 'text/markdown; charset=utf-8', 'private');

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

    it('rethrows a non-404 HeadObject error instead of treating it as absent, logging WARN — never ERROR (graceful-degradation rule)', async () => {
      sendMock.mockResolvedValueOnce({}).mockRejectedValueOnce(buildForbiddenError());

      await expect(
        service.putContentAddressedObject(buildReq(), 'marketing-os-artifacts', key, body, 'text/markdown; charset=utf-8', 'private')
      ).rejects.toThrow('Forbidden');
      expect(sendMock).toHaveBeenCalledTimes(2);
      // The real failure path must not emit ERROR: the recovering caller owns
      // severity (Brand Kit degrades at WARN), and unrecovered rethrows are
      // logged centrally by apiErrorHandler.
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warning).toHaveBeenCalledWith(
        expect.anything(),
        'object_store_put_content_addressed',
        expect.any(String),
        expect.objectContaining({ purpose: 'marketing-os-artifacts', key, error: 'Forbidden' })
      );
    });

    it('logs a bucket-readiness failure at WARN — never ERROR — on this degradable path (graceful-degradation rule)', async () => {
      // ensureBucket HeadBucket fails with a non-404 (403 / timeout / 5xx class)
      sendMock.mockRejectedValueOnce(buildForbiddenError());

      await expect(
        service.putContentAddressedObject(buildReq(), 'marketing-os-artifacts', key, body, 'text/markdown; charset=utf-8', 'private')
      ).rejects.toThrow('Forbidden');
      // A bucket-readiness outage reached via the graceful-degrade persist path must not page:
      // Brand Kit catches the rejection and degrades at WARN, so no ERROR line is allowed here.
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warning).toHaveBeenCalledWith(
        undefined,
        'object_store_ensure_bucket',
        expect.any(String),
        expect.objectContaining({ bucket: 'marketing-os-artifacts-test', error: 'Forbidden' })
      );
    });

    it('propagates the error when the PUT fails, logging WARN — never ERROR (graceful-degradation rule)', async () => {
      sendMock.mockResolvedValueOnce({}).mockRejectedValueOnce(buildNotFoundError()).mockRejectedValueOnce(new Error('put failed'));

      await expect(
        service.putContentAddressedObject(buildReq(), 'marketing-os-artifacts', key, body, 'text/markdown; charset=utf-8', 'private')
      ).rejects.toThrow('put failed');
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warning).toHaveBeenCalledWith(
        expect.anything(),
        'object_store_put_content_addressed',
        expect.any(String),
        expect.objectContaining({ purpose: 'marketing-os-artifacts', key, error: 'put failed' })
      );
    });

    it('passes caller-provided metadata through to the PUT', async () => {
      sendMock
        .mockResolvedValueOnce({}) // ensureBucket HeadBucket
        .mockRejectedValueOnce(buildNotFoundError()) // HeadObject 404
        .mockResolvedValueOnce({}); // PutObject

      await service.putContentAddressedObject(buildReq(), 'marketing-os-artifacts', key, body, 'text/markdown; charset=utf-8', 'private', {
        version: '2',
        'intake-mode': 'form',
      });

      const putCommand = sendMock.mock.calls[2][0];
      expect(putCommand).toBeInstanceOf(PutObjectCommand);
      expect(putCommand.input.Metadata).toEqual({ version: '2', 'intake-mode': 'form' });
    });
  });

  describe('listObjects', () => {
    it('lists keys and last-modified under the prefix without any ensureBucket call', async () => {
      sendMock.mockResolvedValueOnce({
        Contents: [{ Key: 'brand-kit/testorbit/a.md', LastModified: new Date('2026-08-15T00:00:00Z') }, { Key: 'brand-kit/testorbit/b.md' }],
        IsTruncated: false,
      });

      const objects = await service.listObjects(buildReq(), 'marketing-os-artifacts', 'brand-kit/testorbit/');

      expect(objects).toEqual([
        { key: 'brand-kit/testorbit/a.md', lastModified: new Date('2026-08-15T00:00:00Z') },
        { key: 'brand-kit/testorbit/b.md', lastModified: undefined },
      ]);
      // A read never head-checks or creates buckets — one List call only.
      expect(sendMock).toHaveBeenCalledOnce();
      const listCommand = sendMock.mock.calls[0][0];
      expect(listCommand).toBeInstanceOf(ListObjectsV2Command);
      expect(listCommand.input).toMatchObject({ Bucket: 'marketing-os-artifacts-test', Prefix: 'brand-kit/testorbit/' });
    });

    it('paginates through truncated pages with the continuation token', async () => {
      sendMock
        .mockResolvedValueOnce({ Contents: [{ Key: 'brand-kit/testorbit/a.md' }], IsTruncated: true, NextContinuationToken: 'token-1' })
        .mockResolvedValueOnce({ Contents: [{ Key: 'brand-kit/testorbit/b.md' }], IsTruncated: false });

      const objects = await service.listObjects(buildReq(), 'marketing-os-artifacts', 'brand-kit/testorbit/');

      expect(objects.map((object) => object.key)).toEqual(['brand-kit/testorbit/a.md', 'brand-kit/testorbit/b.md']);
      expect(sendMock).toHaveBeenCalledTimes(2);
      expect(sendMock.mock.calls[1][0].input.ContinuationToken).toBe('token-1');
    });

    it('rethrows a list failure logging WARN — never ERROR (graceful-degradation rule)', async () => {
      sendMock.mockRejectedValueOnce(buildForbiddenError());

      await expect(service.listObjects(buildReq(), 'marketing-os-artifacts', 'brand-kit/testorbit/')).rejects.toThrow('Forbidden');
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warning).toHaveBeenCalledWith(
        expect.anything(),
        'object_store_list_objects',
        expect.any(String),
        expect.objectContaining({ purpose: 'marketing-os-artifacts', prefix: 'brand-kit/testorbit/', error: 'Forbidden' })
      );
    });
  });

  describe('headObject', () => {
    it('returns metadata without downloading a body and propagates the original read error', async () => {
      sendMock.mockResolvedValueOnce({ Metadata: { state: 'writing' } });
      await expect(service.headObject(buildReq(), 'marketing-os-artifacts', 'document-runs/p/r.json')).resolves.toEqual({ state: 'writing' });
      expect(sendMock.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
      const failure = buildForbiddenError();
      sendMock.mockRejectedValueOnce(failure);
      await expect(service.headObject(buildReq(), 'marketing-os-artifacts', 'document-runs/p/r.json')).rejects.toBe(failure);
    });
  });

  describe('getObject', () => {
    const key = 'brand-kit/testorbit/abc.md';

    it('returns the UTF-8 body and user metadata', async () => {
      sendMock.mockResolvedValueOnce({
        Body: { transformToString: vi.fn().mockResolvedValue('# doc') },
        Metadata: { version: '2', 'intake-mode': 'form' },
      });

      const object = await service.getObject(buildReq(), 'marketing-os-artifacts', key);

      expect(object).toEqual({ body: '# doc', metadata: { version: '2', 'intake-mode': 'form' } });
      expect(sendMock.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
    });

    it('returns null only on a confirmed missing object (404)', async () => {
      sendMock.mockRejectedValueOnce(buildNotFoundError());

      await expect(service.getObject(buildReq(), 'marketing-os-artifacts', key)).resolves.toBeNull();
      expect(logger.warning).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('rethrows a non-404 failure (never masks it as absent), logging WARN — never ERROR', async () => {
      sendMock.mockRejectedValueOnce(buildForbiddenError());

      await expect(service.getObject(buildReq(), 'marketing-os-artifacts', key)).rejects.toThrow('Forbidden');
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warning).toHaveBeenCalledWith(
        expect.anything(),
        'object_store_get_object',
        expect.any(String),
        expect.objectContaining({ purpose: 'marketing-os-artifacts', key, error: 'Forbidden' })
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

  // The same public surface, served by the folder under the app directory when
  // the private marketing-os-artifacts bucket is not configured: what a local
  // hand test and these unit tests run on.
  describe('file-backed store (no bucket configured)', () => {
    const key = 'brand-kit/testorbit/abc.md';
    const body = Buffer.from('# doc');

    beforeEach(() => {
      delete process.env['S3_BUCKET'];
      delete process.env['MARKETING_OS_ARTIFACTS_S3_BUCKET'];
      delete process.env['AWS_REGION'];
      process.env['OBJECT_STORE_LOCAL_DIR'] = localDir;
    });

    it('defaults the store root to .object-store under the working directory (the app folder) and says so at INFO', async () => {
      delete process.env['OBJECT_STORE_LOCAL_DIR'];

      // readiness only probes — it never creates the folder, so the default path is safe to resolve here.
      await service.readiness('marketing-os-artifacts');

      expect(logger.info).toHaveBeenCalledWith(
        undefined,
        'object_store_backend',
        expect.any(String),
        expect.objectContaining({
          purpose: 'marketing-os-artifacts',
          bucket_env: 'MARKETING_OS_ARTIFACTS_S3_BUCKET',
          directory: resolve(process.cwd(), '.object-store', 'marketing-os-artifacts'),
        })
      );
    });

    it('needs no AWS_REGION and no S3 client at all', async () => {
      await service.ensureBucket('marketing-os-artifacts');
      await service.putContentAddressedObject(buildReq(), 'marketing-os-artifacts', key, body, 'text/markdown; charset=utf-8', 'private');

      expect(s3ClientCtor).not.toHaveBeenCalled();
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('reports readiness false before the first write and true once the folder exists', async () => {
      await expect(service.readiness('marketing-os-artifacts')).resolves.toBe(false);
      await service.ensureBucket('marketing-os-artifacts');
      await expect(service.readiness('marketing-os-artifacts')).resolves.toBe(true);
    });

    it('persists a document with its metadata and restores it through list + get, exactly like S3', async () => {
      const written = await service.putContentAddressedObject(buildReq(), 'marketing-os-artifacts', key, body, 'text/markdown; charset=utf-8', 'private', {
        version: '2',
        'intake-mode': 'form',
      });
      expect(written).toBe(true);

      const objects = await service.listObjects(buildReq(), 'marketing-os-artifacts', 'brand-kit/testorbit/');
      expect(objects).toHaveLength(1);
      expect(objects[0].key).toBe(key);
      expect(objects[0].lastModified).toBeInstanceOf(Date);

      await expect(service.getObject(buildReq(), 'marketing-os-artifacts', key)).resolves.toMatchObject({
        etag: expect.any(String),
        body: '# doc',
        metadata: { version: '2', 'intake-mode': 'form' },
      });
      // The bytes land under <root>/<purpose>/<key>, readable by anyone poking at the folder.
      await expect(readFile(join(localDir, 'marketing-os-artifacts', key), 'utf8')).resolves.toBe('# doc');
    });

    it('survives a server restart: a fresh service instance reads what the previous one stored', async () => {
      await service.putContentAddressedObject(buildReq(), 'marketing-os-artifacts', key, body, 'text/markdown; charset=utf-8', 'private', { version: '1' });

      const restarted = new ObjectStoreService();

      await expect(restarted.getObject(buildReq(), 'marketing-os-artifacts', key)).resolves.toMatchObject({
        body: '# doc',
        metadata: { version: '1' },
        etag: expect.any(String),
      });
    });

    it('keeps the content-addressed no-op and the strictly-newer metadata refresh', async () => {
      await service.putContentAddressedObject(buildReq(), 'marketing-os-artifacts', key, body, 'text/markdown; charset=utf-8', 'private', { version: '1' });

      const repeat = await service.putContentAddressedObject(buildReq(), 'marketing-os-artifacts', key, body, 'text/markdown; charset=utf-8', 'private', {
        version: '1',
      });
      expect(repeat).toBe(false);

      const refreshed = await service.putContentAddressedObject(
        buildReq(),
        'marketing-os-artifacts',
        key,
        body,
        'text/markdown; charset=utf-8',
        'private',
        { version: '2' },
        { refreshMetadataWhen: (stored) => stored['version'] === '1' }
      );
      expect(refreshed).toBe(true);
      await expect(service.getObject(buildReq(), 'marketing-os-artifacts', key)).resolves.toMatchObject({ metadata: { version: '2' } });
    });

    it('lists a prefix that was never written as empty and reads a missing key as null — without a WARN', async () => {
      await expect(service.listObjects(buildReq(), 'marketing-os-artifacts', 'icp/nothing-here/')).resolves.toEqual([]);
      await expect(service.getObject(buildReq(), 'marketing-os-artifacts', 'icp/nothing-here/abc.md')).resolves.toBeNull();
      expect(logger.warning).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('never serves the public avatars purpose: with CDN_URL_PREFIX set and no S3_BUCKET, uploads fail instead of storing a URL that points at nothing', async () => {
      process.env['CDN_URL_PREFIX'] = 'https://cdn.example.com';

      await expect(service.uploadProfilePicture(buildReq(), 'User1', Buffer.from('img'), 'image/png')).rejects.toThrow(
        'S3_BUCKET environment variable is required'
      );
      await expect(service.putPublicImage(buildReq(), 'mentorship-logos/abc.png', Buffer.from('img'), 'image/png')).rejects.toThrow(
        'S3_BUCKET environment variable is required'
      );
      await expect(stat(join(localDir, 'avatars'))).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });
});
