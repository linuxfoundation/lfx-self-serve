// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileObjectStoreBackend } from './object-store-file.backend';

describe('FileObjectStoreBackend', () => {
  let scratch: string;
  let root: string;
  let backend: FileObjectStoreBackend;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'lfx-file-backend-spec-'));
    root = join(scratch, 'marketing-os-artifacts');
    backend = new FileObjectStoreBackend(root);
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  describe('bucket (folder) lifecycle', () => {
    it('reports the folder path as its location', () => {
      expect(backend.kind).toBe('file');
      expect(backend.location()).toBe(root);
    });

    it('readiness is false until the folder exists and never creates it', async () => {
      await expect(backend.readiness()).resolves.toBe(false);
      await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('ensureBucket creates the folder once and reports created only the first time', async () => {
      await expect(backend.ensureBucket()).resolves.toEqual({ created: true });
      await expect(backend.ensureBucket()).resolves.toEqual({ created: false });
      await expect(backend.readiness()).resolves.toBe(true);
    });
  });

  describe('put / head / get', () => {
    const key = 'brand-kit/proj-uid-1/abc.md';

    it('writes the body at <root>/<key> with a .meta.json sidecar carrying the object headers', async () => {
      await backend.putObject(key, {
        body: Buffer.from('# doc'),
        contentType: 'text/markdown; charset=utf-8',
        cacheControl: 'private',
        metadata: { version: '2', 'intake-mode': 'form' },
      });

      await expect(readFile(join(root, 'brand-kit', 'proj-uid-1', 'abc.md'), 'utf8')).resolves.toBe('# doc');
      const sidecar = JSON.parse(await readFile(join(root, 'brand-kit', 'proj-uid-1', 'abc.md.meta.json'), 'utf8'));
      expect(sidecar).toEqual({
        contentType: 'text/markdown; charset=utf-8',
        cacheControl: 'private',
        metadata: { version: '2', 'intake-mode': 'form' },
      });
    });

    it('headObject returns the stored metadata, and null for a missing object', async () => {
      await expect(backend.headObject(key)).resolves.toBeNull();

      await backend.putObject(key, { body: Buffer.from('# doc'), contentType: 'text/markdown', cacheControl: 'private', metadata: { version: '1' } });

      await expect(backend.headObject(key)).resolves.toEqual({ version: '1' });
    });

    it('getObject returns the UTF-8 body and metadata, and null for a missing object', async () => {
      await expect(backend.getObject(key)).resolves.toBeNull();

      await backend.putObject(key, { body: Buffer.from('# doc ünïcödé'), contentType: 'text/markdown', cacheControl: 'private', metadata: { version: '3' } });

      await expect(backend.getObject(key)).resolves.toEqual({ body: '# doc ünïcödé', metadata: { version: '3' } });
    });

    it('writes with no metadata read back as empty metadata, as an S3 object written without any would', async () => {
      await backend.putObject(key, { body: Buffer.from('img'), contentType: 'image/png', cacheControl: 'public, max-age=86400' });

      await expect(backend.headObject(key)).resolves.toEqual({});
      await expect(backend.getObject(key)).resolves.toEqual({ body: 'img', metadata: {} });
    });

    it('a body with no sidecar (or an unreadable one) still reads, with empty metadata', async () => {
      await mkdir(join(root, 'brand-kit', 'proj-uid-1'), { recursive: true });
      await writeFile(join(root, 'brand-kit', 'proj-uid-1', 'abc.md'), '# bare');

      await expect(backend.getObject(key)).resolves.toEqual({ body: '# bare', metadata: {} });

      await writeFile(join(root, 'brand-kit', 'proj-uid-1', 'abc.md.meta.json'), 'not json');

      await expect(backend.headObject(key)).resolves.toEqual({});
    });

    it('a re-put overwrites both the body and the sidecar', async () => {
      await backend.putObject(key, { body: Buffer.from('v1'), contentType: 'text/plain', cacheControl: 'private', metadata: { version: '1' } });
      await backend.putObject(key, { body: Buffer.from('v2'), contentType: 'text/plain', cacheControl: 'private', metadata: { version: '2' } });

      await expect(backend.getObject(key)).resolves.toEqual({ body: 'v2', metadata: { version: '2' } });
    });
  });

  describe('listObjects', () => {
    it('lists a missing folder as empty rather than failing', async () => {
      await expect(backend.listObjects('brand-kit/')).resolves.toEqual([]);
    });

    it('returns only the objects under the prefix, with posix keys and the body mtime, never the sidecars', async () => {
      const input = { body: Buffer.from('x'), contentType: 'text/markdown', cacheControl: 'private', metadata: { version: '1' } };
      await backend.putObject('brand-kit/proj-uid-1/aaa.md', input);
      await backend.putObject('brand-kit/proj-uid-1/bbb.md', input);
      await backend.putObject('brand-kit/proj-uid-2/ccc.md', input);
      await backend.putObject('icp/proj-uid-1/ddd.md', input);

      const objects = await backend.listObjects('brand-kit/proj-uid-1/');

      expect(objects.map((object) => object.key).sort()).toEqual(['brand-kit/proj-uid-1/aaa.md', 'brand-kit/proj-uid-1/bbb.md']);
      for (const object of objects) {
        expect(object.lastModified).toBeInstanceOf(Date);
      }
    });

    it('an empty prefix lists every object in the folder', async () => {
      const input = { body: Buffer.from('x'), contentType: 'text/plain', cacheControl: 'private' };
      await backend.putObject('avatars/user1', input);
      await backend.putObject('mentorship-logos/abc.png', input);

      const keys = (await backend.listObjects('')).map((object) => object.key).sort();

      expect(keys).toEqual(['avatars/user1', 'mentorship-logos/abc.png']);
    });
  });

  describe('key safety', () => {
    it.each(['../escape.md', 'brand-kit/../../escape.md', '/etc/passwd', ''])('refuses a key that would leave the folder: %j', async (key) => {
      await expect(backend.putObject(key, { body: Buffer.from('x'), contentType: 'text/plain', cacheControl: 'private' })).rejects.toThrow(
        /file-backed object store/
      );
      await expect(backend.getObject(key)).rejects.toThrow(/file-backed object store/);
      await expect(backend.headObject(key)).rejects.toThrow(/file-backed object store/);
    });

    it('refuses a key that would collide with a sidecar', async () => {
      await expect(
        backend.putObject('brand-kit/x.md.meta.json', { body: Buffer.from('x'), contentType: 'text/plain', cacheControl: 'private' })
      ).rejects.toThrow(/not storable/);
    });

    it('keeps the stored key byte-exact for the characters avatar keys carry (@, %, dots)', async () => {
      const key = 'avatars/some.user%40example.test';
      await backend.putObject(key, { body: Buffer.from('img'), contentType: 'image/png', cacheControl: 'public, max-age=86400' });

      const keys = (await backend.listObjects('avatars/')).map((object) => object.key);

      expect(keys).toEqual([key]);
      await expect(backend.getObject(key)).resolves.toMatchObject({ body: 'img' });
    });
  });
});
