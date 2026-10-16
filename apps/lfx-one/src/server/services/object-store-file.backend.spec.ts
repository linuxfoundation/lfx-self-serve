// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ServiceValidationError } from '../errors';
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

  it('serializes conditional writes across independent backend instances', async () => {
    const other = new FileObjectStoreBackend(root);
    const input = { body: Buffer.from('first'), contentType: 'text/plain', cacheControl: 'private', ifNoneMatch: '*' as const };
    const results = await Promise.allSettled([backend.putObject('current.json', input), other.putObject('current.json', input)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const stored = await backend.getObject('current.json');
    expect(stored?.etag).toBeTruthy();
    await backend.putObject('current.json', { ...input, body: Buffer.from('second'), ifNoneMatch: undefined, ifMatch: stored!.etag });
    await expect(other.putObject('current.json', { ...input, ifNoneMatch: undefined, ifMatch: stored!.etag })).rejects.toMatchObject({ statusCode: 412 });
    expect((await backend.getObject('current.json'))?.body).toBe('second');
  });

  it('keeps abandoned locks until operator recovery, including for unconditional writes', async () => {
    await mkdir(join(root, 'current.json.lock.partial'), { recursive: true });
    const input = { body: Buffer.from('current'), contentType: 'application/json', cacheControl: 'private' };
    await expect(backend.putObject('current.json', input)).rejects.toMatchObject({ statusCode: 412 });
    await rm(join(root, 'current.json.lock.partial'), { recursive: true });
    await expect(backend.putObject('current.json', input)).resolves.toBeUndefined();
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

    it('readiness is false when the configured root is a regular file — a store nothing can be written to', async () => {
      await writeFile(root, 'not a folder');
      await expect(backend.readiness()).resolves.toBe(false);
      await expect(backend.ensureBucket()).rejects.toMatchObject({ code: 'EEXIST' });
      // A misconfigured root surfaces from a listing too, instead of reading as "nothing stored".
      await expect(backend.listObjects('')).rejects.toMatchObject({ code: 'ENOTDIR' });
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

    it('a put leaves exactly the body and its sidecar — the in-flight .partial files are renamed away', async () => {
      await backend.putObject(key, { body: Buffer.from('v1'), contentType: 'text/plain', cacheControl: 'private', metadata: { version: '1' } });
      await backend.putObject(key, { body: Buffer.from('v2'), contentType: 'text/plain', cacheControl: 'private', metadata: { version: '2' } });

      await expect(readdir(join(root, 'brand-kit', 'proj-uid-1'))).resolves.toEqual(['abc.md', 'abc.md.meta.json']);
    });

    it('a .partial file left by an interrupted put is neither listed nor read as an object', async () => {
      await backend.putObject(key, { body: Buffer.from('# doc'), contentType: 'text/markdown', cacheControl: 'private' });
      await writeFile(join(root, 'brand-kit', 'proj-uid-1', 'zzz.md.0f1e2d3c.partial'), 'half');

      expect((await backend.listObjects('')).map((object) => object.key)).toEqual([key]);
      await expect(backend.getObject('brand-kit/proj-uid-1/zzz.md')).resolves.toBeNull();
    });

    it('a sidecar left by a put interrupted before its body is invisible, and the next put of the key lands both', async () => {
      await mkdir(join(root, 'brand-kit', 'proj-uid-1'), { recursive: true });
      await writeFile(join(root, 'brand-kit', 'proj-uid-1', 'abc.md.meta.json'), JSON.stringify({ metadata: { version: '1' } }));

      await expect(backend.headObject(key)).resolves.toBeNull();
      await expect(backend.getObject(key)).resolves.toBeNull();
      await expect(backend.listObjects('')).resolves.toEqual([]);

      await backend.putObject(key, { body: Buffer.from('# doc'), contentType: 'text/markdown', cacheControl: 'private', metadata: { version: '1' } });

      await expect(backend.getObject(key)).resolves.toMatchObject({ body: '# doc', metadata: { version: '1' }, etag: expect.any(String) });
    });

    it('headObject returns the stored metadata, and null for a missing object', async () => {
      await expect(backend.headObject(key)).resolves.toBeNull();

      await backend.putObject(key, { body: Buffer.from('# doc'), contentType: 'text/markdown', cacheControl: 'private', metadata: { version: '1' } });

      await expect(backend.headObject(key)).resolves.toEqual({ version: '1' });
    });

    it('getObject returns the UTF-8 body and metadata, and null for a missing object', async () => {
      await expect(backend.getObject(key)).resolves.toBeNull();

      await backend.putObject(key, { body: Buffer.from('# doc ünïcödé'), contentType: 'text/markdown', cacheControl: 'private', metadata: { version: '3' } });

      await expect(backend.getObject(key)).resolves.toMatchObject({ body: '# doc ünïcödé', metadata: { version: '3' }, etag: expect.any(String) });
    });

    it('writes with no metadata read back as empty metadata, as an S3 object written without any would', async () => {
      await backend.putObject(key, { body: Buffer.from('img'), contentType: 'image/png', cacheControl: 'public, max-age=86400' });

      await expect(backend.headObject(key)).resolves.toEqual({});
      await expect(backend.getObject(key)).resolves.toMatchObject({ body: 'img', metadata: {}, etag: expect.any(String) });
    });

    it('a body with no sidecar (or an unreadable one) still reads, with empty metadata', async () => {
      await mkdir(join(root, 'brand-kit', 'proj-uid-1'), { recursive: true });
      await writeFile(join(root, 'brand-kit', 'proj-uid-1', 'abc.md'), '# bare');

      await expect(backend.getObject(key)).resolves.toMatchObject({ body: '# bare', metadata: {}, etag: expect.any(String) });

      await writeFile(join(root, 'brand-kit', 'proj-uid-1', 'abc.md.meta.json'), 'not json');

      await expect(backend.headObject(key)).resolves.toEqual({});
    });

    it('a re-put overwrites both the body and the sidecar', async () => {
      await backend.putObject(key, { body: Buffer.from('v1'), contentType: 'text/plain', cacheControl: 'private', metadata: { version: '1' } });
      await backend.putObject(key, { body: Buffer.from('v2'), contentType: 'text/plain', cacheControl: 'private', metadata: { version: '2' } });

      await expect(backend.getObject(key)).resolves.toMatchObject({ body: 'v2', metadata: { version: '2' }, etag: expect.any(String) });
    });
  });

  describe('listObjects', () => {
    it('lists a missing folder as empty rather than failing', async () => {
      await expect(backend.listObjects('brand-kit/')).resolves.toEqual([]);
    });

    it('returns only the objects under the prefix, with posix keys and the put time, never the sidecars', async () => {
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

    it('stamps an object with its sidecar mtime, so a refresh that landed only the sidecar still moves it to the front', async () => {
      const input = { body: Buffer.from('x'), contentType: 'text/plain', cacheControl: 'private', metadata: { version: '1' } };
      await backend.putObject('brand-kit/proj-uid-1/aaa.md', input);
      await backend.putObject('brand-kit/proj-uid-1/bbb.md', input);
      const older = new Date('2026-01-01T00:00:00Z');
      const newer = new Date('2026-06-01T00:00:00Z');
      await utimes(join(root, 'brand-kit', 'proj-uid-1', 'aaa.md'), older, older);
      await utimes(join(root, 'brand-kit', 'proj-uid-1', 'aaa.md.meta.json'), older, older);
      await utimes(join(root, 'brand-kit', 'proj-uid-1', 'bbb.md'), newer, newer);
      await utimes(join(root, 'brand-kit', 'proj-uid-1', 'bbb.md.meta.json'), newer, newer);

      // A refresh of aaa interrupted after its sidecar landed: new labels and stamp, old body.
      const refreshed = new Date('2026-09-01T00:00:00Z');
      await writeFile(join(root, 'brand-kit', 'proj-uid-1', 'aaa.md.meta.json'), JSON.stringify({ metadata: { version: '2' } }));
      await utimes(join(root, 'brand-kit', 'proj-uid-1', 'aaa.md.meta.json'), refreshed, refreshed);

      const stamps = Object.fromEntries((await backend.listObjects('brand-kit/')).map((object) => [object.key, object.lastModified]));
      expect(stamps).toEqual({ 'brand-kit/proj-uid-1/aaa.md': refreshed, 'brand-kit/proj-uid-1/bbb.md': newer });
      await expect(backend.headObject('brand-kit/proj-uid-1/aaa.md')).resolves.toEqual({ version: '2' });
    });

    it('a body with no sidecar is stamped with its own mtime', async () => {
      await mkdir(join(root, 'brand-kit'), { recursive: true });
      await writeFile(join(root, 'brand-kit', 'bare.md'), '# bare');
      const when = new Date('2026-03-01T00:00:00Z');
      await utimes(join(root, 'brand-kit', 'bare.md'), when, when);

      await expect(backend.listObjects('')).resolves.toEqual([{ key: 'brand-kit/bare.md', lastModified: when }]);
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
    // A refused key is the project's typed 400 on the `key` field, never a raw Error: a
    // caller-built key (a project uid carrying `..`) must reach apiErrorHandler with structured
    // metadata instead of surfacing as an untyped 500.
    const refusedKey = (detail: RegExp) => ({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      validationErrors: [{ field: 'key', message: expect.stringMatching(detail), code: 'FIELD_VALIDATION_ERROR' }],
    });

    it.each(['../escape.md', 'brand-kit/../../escape.md', '/etc/passwd', ''])('refuses a key that would leave the folder: %j', async (key) => {
      const put = backend.putObject(key, { body: Buffer.from('x'), contentType: 'text/plain', cacheControl: 'private' });
      await expect(put).rejects.toBeInstanceOf(ServiceValidationError);
      await expect(put).rejects.toMatchObject(refusedKey(/file-backed object store/));
      await expect(backend.getObject(key)).rejects.toMatchObject(refusedKey(/file-backed object store/));
      await expect(backend.headObject(key)).rejects.toMatchObject(refusedKey(/file-backed object store/));
    });

    it('accepts a first segment that merely begins with two dots — it stays inside the folder', async () => {
      const key = '..draft/x.md';
      await backend.putObject(key, { body: Buffer.from('draft'), contentType: 'text/markdown', cacheControl: 'private' });

      await expect(readFile(join(root, '..draft', 'x.md'), 'utf8')).resolves.toBe('draft');
      await expect(backend.getObject(key)).resolves.toMatchObject({ body: 'draft' });
      expect((await backend.listObjects('')).map((object) => object.key)).toEqual([key]);
    });

    it.each(['brand-kit/x.md.meta.json', 'brand-kit/x.md.0f1e2d3c.partial', 'a.meta.json/x', 'brand-kit/x.partial/y.md'])(
      'refuses a key any segment of which would collide with a sidecar or pass for a partial file: %j',
      async (key) => {
        const put = backend.putObject(key, { body: Buffer.from('x'), contentType: 'text/plain', cacheControl: 'private' });
        await expect(put).rejects.toBeInstanceOf(ServiceValidationError);
        await expect(put).rejects.toMatchObject(refusedKey(/not storable/));
      }
    );

    // S3 stores `a/b` and `a/b/c` side by side; a filesystem cannot. The clash surfaces as the
    // same typed 400 as a refused key — never a raw EEXIST/ENOTDIR/EISDIR — and a key that only
    // names a folder of other objects reads as "no object", as it would against S3.
    describe('nested keys (one key a path prefix of another)', () => {
      const input = { body: Buffer.from('x'), contentType: 'text/plain', cacheControl: 'private' };

      it('refuses writing under a stored object with a typed 400', async () => {
        await backend.putObject('a/b', input);

        for (const key of ['a/b/c', 'a/b/c/d']) {
          const put = backend.putObject(key, input);
          await expect(put).rejects.toBeInstanceOf(ServiceValidationError);
          await expect(put).rejects.toMatchObject(refusedKey(/collides with a stored object/));
        }
        await expect(backend.getObject('a/b')).resolves.toMatchObject({ body: 'x', metadata: {}, etag: expect.any(String) });
      });

      it('refuses writing a key that is the folder of stored objects with a typed 400', async () => {
        await backend.putObject('a/b/c', input);

        const put = backend.putObject('a/b', input);
        await expect(put).rejects.toBeInstanceOf(ServiceValidationError);
        await expect(put).rejects.toMatchObject(refusedKey(/collides with a stored object/));
        await expect(backend.getObject('a/b/c')).resolves.toMatchObject({ body: 'x', metadata: {}, etag: expect.any(String) });
        // The failed rename cleaned up after itself: no .partial file next to the folder.
        await expect(readdir(join(root, 'a'))).resolves.toEqual(['b']);
      });

      it('a put whose sidecar cannot land writes nothing: a folder squatting the sidecar name', async () => {
        await mkdir(join(root, 'a.meta.json'), { recursive: true });

        const put = backend.putObject('a', input);
        await expect(put).rejects.toBeInstanceOf(ServiceValidationError);
        await expect(put).rejects.toMatchObject(refusedKey(/collides with a stored object/));
        await expect(backend.headObject('a')).resolves.toBeNull();
        await expect(readdir(root)).resolves.toEqual(['a.meta.json']);
      });

      it('reads a key that only names a folder, or sits under a stored object, as missing', async () => {
        await backend.putObject('a/b/c', input);
        await backend.putObject('x/y', input);

        await expect(backend.headObject('a/b')).resolves.toBeNull();
        await expect(backend.getObject('a/b')).resolves.toBeNull();
        await expect(backend.headObject('x/y/z')).resolves.toBeNull();
        await expect(backend.getObject('x/y/z')).resolves.toBeNull();
      });
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
