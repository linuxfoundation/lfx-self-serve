// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ErasableObjectStoreBackend,
  ObjectStoreFileSidecar,
  ObjectStoreListEntry,
  ObjectStorePutInput,
  ObjectStoreReadResult,
} from '@lfx-one/shared/interfaces';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { OBJECT_STORE_FILE_METADATA_SUFFIX, OBJECT_STORE_FILE_PARTIAL_SUFFIX } from '../constants';
import { PreconditionFailedError, ServiceValidationError } from '../errors';

/**
 * The file-backed backend of the object store — one folder per purpose,
 * used when no bucket is configured (local hand tests, unit tests). Serves
 * the S3 object contract with the filesystem divergences documented below:
 *
 * - An object key is a relative path under the purpose folder
 *   (`brand-kit/<project>/<sha>.md` → `<root>/brand-kit/<project>/<sha>.md`);
 *   nested prefixes become nested folders.
 * - What S3 keeps as object headers (content type, cache control, user
 *   metadata) lives in a `<key>.meta.json` sidecar next to the body. An
 *   object with no sidecar reads back with empty metadata, like an S3 object
 *   written without any.
 * - Body and sidecar are individually atomic, not an atomic pair as S3 headers
 *   and body are: each is written whole to a `.partial` neighbour and renamed,
 *   so a reader — or a crash — never meets a half-written file. The sidecar
 *   lands first and the body last, and a key reports an object only once its
 *   body is a file, so a put interrupted between the two is invisible until
 *   the next put of the key lands both. When the key already holds an object,
 *   a put interrupted the same way pairs the new labels with the old body
 *   until that next put — the same bytes, for a content-addressed key.
 * - `lastModified` is the sidecar's mtime (the body's only for an object that
 *   never had one). Every put rewrites the sidecar, so the stamp is the put
 *   time, and the labels and the stamp commit in the one rename: a
 *   metadata-refresh rewrite advances both together or neither, so the shared
 *   artifact layer's "latest is write time" ordering — and the refresh that
 *   moves an object to the front of it — behave exactly as against S3.
 * - A missing folder lists as empty instead of failing: before the first
 *   write there is nothing stored, and a local run should not WARN about it.
 *
 * Known divergence from S3: a filesystem has one namespace for files and
 * folders, so a key that is a path prefix of another (`a/b` next to `a/b/c`)
 * cannot be stored alongside it. Writing such a key is refused with a typed
 * `ServiceValidationError` on `key` instead of a raw fs error, and reading a
 * key that names a folder reports no object, as S3 would. Today's keys are
 * content-addressed (`<kind>/<project>/<sha>.<ext>`) and never nest this way.
 *
 * Unlike S3, every put (including unconditional puts) takes an exclusive per-key
 * directory lock. Overlapping puts fail with PreconditionFailedError instead of
 * last-writer-wins, so unconditional writers cannot bypass a conditional compare.
 * A crashed writer leaves the lock and blocks further writes until an operator
 * confirms no writer is active and removes `<key>.lock.partial` (a directory).
 * Locks are never stolen based on age.
 *
 * Keys are resolved and then checked to still sit inside the purpose folder,
 * so no key — however it was built — can read or write outside the store.
 */
export class FileObjectStoreBackend implements ErasableObjectStoreBackend {
  public readonly kind = 'file' as const;
  private readonly root: string;

  /** @param root Absolute (or cwd-relative) folder holding this purpose's objects. */
  public constructor(root: string) {
    this.root = resolve(root);
  }

  public location(): string {
    return this.root;
  }

  /**
   * Ready only when the root is a folder. A regular file at that path exists, so a bare
   * existence check would report healthy while `ensureBucket` then fails and nothing can be stored.
   */
  public async readiness(): Promise<boolean> {
    try {
      return (await stat(this.root)).isDirectory();
    } catch {
      return false;
    }
  }

  /** A folder is cheap and local-only, so it is always created when missing — no `S3_CREATE_MISSING_BUCKET` gate here. */
  public async ensureBucket(): Promise<{ created: boolean }> {
    const existed = await this.readiness();
    await mkdir(this.root, { recursive: true });
    return { created: !existed };
  }

  public async headObject(key: string): Promise<Record<string, string> | null> {
    const bodyPath = this.resolveKey(key);
    try {
      // A folder at the key's path is a prefix of other objects, not an object itself.
      if (!(await stat(bodyPath)).isFile()) {
        return null;
      }
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }
      throw error;
    }
    return (await this.readSidecar(bodyPath)).metadata;
  }

  public async putObject(key: string, input: ObjectStorePutInput): Promise<void> {
    const bodyPath = this.resolveKey(key);
    const lock = `${bodyPath}.lock${OBJECT_STORE_FILE_PARTIAL_SUFFIX}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await mkdir(dirname(bodyPath), { recursive: true });
      } catch (error) {
        if (isNestedKeyCollision(error)) {
          throw ServiceValidationError.forField('key', `Object key collides with a stored object: "${key}"`, { operation: 'object_store_put_object' });
        }
        throw error;
      }
      try {
        // Exclusive across instances/processes; never steal an abandoned lock.
        await mkdir(lock);
        break;
      } catch (error) {
        // A delete may prune the empty parent between the two mkdir calls.
        if (fsErrorCode(error) === 'ENOENT' && attempt === 0) continue;
        if (fsErrorCode(error) === 'EEXIST') throw new PreconditionFailedError('An object write is already in flight');
        throw error;
      }
    }
    try {
      if (input.ifMatch || input.ifNoneMatch) {
        const stored = await this.getObject(key);
        if ((input.ifNoneMatch && stored) || (input.ifMatch && stored?.etag !== input.ifMatch)) {
          throw new PreconditionFailedError();
        }
      }
      await this.writeObject(key, input);
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }

  public async deleteObject(key: string): Promise<void> {
    const bodyPath = this.resolveKey(key);
    const lock = `${bodyPath}.lock${OBJECT_STORE_FILE_PARTIAL_SUFFIX}`;
    try {
      await mkdir(lock);
    } catch (error) {
      if (fsErrorCode(error) === 'ENOENT') return; // Missing parent means no current object to delete.
      if (fsErrorCode(error) === 'EEXIST') throw new PreconditionFailedError('An object write is already in flight');
      throw error;
    }
    try {
      await rm(bodyPath, { force: true });
      await rm(`${bodyPath}${OBJECT_STORE_FILE_METADATA_SUFFIX}`, { force: true });
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
    // Remove now-empty partition folders too, but never another object's data
    // or the store root. Nonempty folders are the expected stopping point.
    let parent = dirname(bodyPath);
    while (parent !== this.root) {
      try {
        await rmdir(parent);
      } catch (error) {
        if (fsErrorCode(error) === 'ENOTEMPTY') break;
        if (fsErrorCode(error) !== 'ENOENT') throw error;
      }
      parent = dirname(parent);
    }
  }

  public async getObject(key: string): Promise<ObjectStoreReadResult | null> {
    const bodyPath = this.resolveKey(key);
    let body: string;
    try {
      body = await readFile(bodyPath, 'utf8');
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }
      throw error;
    }
    return { body, metadata: (await this.readSidecar(bodyPath)).metadata, etag: `"${createHash('sha256').update(body).digest('hex')}"` };
  }

  public async listObjects(prefix: string): Promise<ObjectStoreListEntry[]> {
    let entries: { name: string; parentPath: string; isFile(): boolean }[];
    try {
      entries = await readdir(this.root, { recursive: true, withFileTypes: true });
    } catch (error) {
      // Only an absent root is an empty store. ENOTDIR means the configured root (or an
      // ancestor) is a regular file — a configuration error, which readiness() also reports.
      if (fsErrorCode(error) === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const objects: ObjectStoreListEntry[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.endsWith(OBJECT_STORE_FILE_METADATA_SUFFIX) || entry.name.endsWith(OBJECT_STORE_FILE_PARTIAL_SUFFIX)) {
        continue;
      }
      const bodyPath = join(entry.parentPath, entry.name);
      // Keys are always posix-separated, whatever the host filesystem uses.
      const key = relative(this.root, bodyPath).split(sep).join('/');
      if (!key.startsWith(prefix)) {
        continue;
      }
      objects.push({ key, lastModified: await lastModifiedOf(bodyPath) });
    }
    return objects;
  }

  /** Publish labels before the atomic body rename, preserving legacy file-store behaviour. */
  private async writeObject(key: string, input: ObjectStorePutInput): Promise<void> {
    const bodyPath = this.resolveKey(key);
    const sidecarPath = `${bodyPath}${OBJECT_STORE_FILE_METADATA_SUFFIX}`;
    const sidecar: ObjectStoreFileSidecar = { contentType: input.contentType, cacheControl: input.cacheControl, metadata: input.metadata ?? {} };
    try {
      await writeWhole(sidecarPath, JSON.stringify(sidecar, null, 2));
      try {
        await writeWhole(bodyPath, input.body);
      } catch (error) {
        if (!(await isRegularFile(bodyPath))) {
          await rm(sidecarPath, { force: true });
        }
        throw error;
      }
    } catch (error) {
      if (isNestedKeyCollision(error)) {
        throw ServiceValidationError.forField('key', `Object key collides with a stored object: "${key}"`, { operation: 'object_store_put_object' });
      }
      throw error;
    }
  }

  /**
   * The body file for a key. Refuses a key that cannot round-trip through
   * `listObjects` as the same string — an empty, `.` or `..` segment (so a
   * leading, trailing or doubled `/`) — or any segment of which would collide
   * with a sidecar or be mistaken for an in-flight `.partial` file (a folder
   * squatting a sidecar's name would make a later put of the parent key fail
   * halfway). It then checks the resolved path still sits inside the purpose
   * folder as defense in depth. A refused key is a typed 400 (`ServiceValidationError`
   * on the `key` field), so a caller-built key — say a project uid carrying
   * `..` — reaches `apiErrorHandler` with structured metadata, not as an
   * untyped 500.
   */
  private resolveKey(key: string): string {
    const segments = key.split('/');
    const unstorable = (segment: string): boolean =>
      segment === '' ||
      segment === '.' ||
      segment === '..' ||
      segment.endsWith(OBJECT_STORE_FILE_METADATA_SUFFIX) ||
      segment.endsWith(OBJECT_STORE_FILE_PARTIAL_SUFFIX);
    if (!key || segments.some(unstorable)) {
      throw ServiceValidationError.forField('key', `Object key is not storable in the file-backed object store: "${key}"`, {
        operation: 'object_store_resolve_key',
      });
    }
    const bodyPath = resolve(this.root, ...segments);
    const inside = relative(this.root, bodyPath);
    // `..` alone or as the first path component means outside; a first segment that merely
    // begins with two dots (`..draft/x.md`) is a legitimate key and stays inside.
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
      throw ServiceValidationError.forField('key', `Object key escapes the file-backed object store folder: "${key}"`, {
        operation: 'object_store_resolve_key',
      });
    }
    return bodyPath;
  }

  /** The sidecar next to a body — or empty labels when it was never written or is unreadable as JSON. */
  private async readSidecar(bodyPath: string): Promise<ObjectStoreFileSidecar> {
    const empty: ObjectStoreFileSidecar = { contentType: '', cacheControl: '', metadata: {} };
    let raw: string;
    try {
      raw = await readFile(`${bodyPath}${OBJECT_STORE_FILE_METADATA_SUFFIX}`, 'utf8');
    } catch (error) {
      if (isMissing(error)) {
        return empty;
      }
      throw error;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<ObjectStoreFileSidecar>;
      return {
        contentType: typeof parsed.contentType === 'string' ? parsed.contentType : '',
        cacheControl: typeof parsed.cacheControl === 'string' ? parsed.cacheControl : '',
        metadata: isStringRecord(parsed.metadata) ? parsed.metadata : {},
      };
    } catch {
      return empty;
    }
  }
}

/**
 * Writes `data` to a uniquely named `.partial` neighbour of `target` and renames it into place
 * once the write has completed, so `target` is only ever absent or whole — `rename` within one
 * folder is atomic on every filesystem the store runs on. A failed write or rename removes the
 * partial file before rethrowing, so nothing is left behind.
 */
async function writeWhole(target: string, data: Uint8Array | string): Promise<void> {
  const partial = `${target}.${randomUUID()}${OBJECT_STORE_FILE_PARTIAL_SUFFIX}`;
  try {
    await writeFile(partial, data);
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

/**
 * The put time of an object: its sidecar's mtime, since every put rewrites the sidecar. A body
 * with no sidecar was never written through `putObject`, so it reports its own.
 */
async function lastModifiedOf(bodyPath: string): Promise<Date> {
  try {
    return (await stat(`${bodyPath}${OBJECT_STORE_FILE_METADATA_SUFFIX}`)).mtime;
  } catch (error) {
    if (fsErrorCode(error) === 'ENOENT') {
      return (await stat(bodyPath)).mtime;
    }
    throw error;
  }
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * True for ENOENT, ENOTDIR (a key segment names a stored object) and EISDIR (the key names
 * a folder of other objects) — every way the file system says "no object here", the same
 * answer S3 gives for a key that is only the prefix or extension of stored keys.
 */
function isMissing(error: unknown): boolean {
  const code = fsErrorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR';
}

/**
 * True when a write hit the file/folder namespace clash the class doc describes: the key's
 * parent is a stored object (EEXIST from mkdir, ENOTDIR from the write) or the key itself is
 * a folder holding other objects (EISDIR from renaming the body over it).
 */
function isNestedKeyCollision(error: unknown): boolean {
  const code = fsErrorCode(error);
  return code === 'EEXIST' || code === 'ENOTDIR' || code === 'EISDIR';
}

function fsErrorCode(error: unknown): string | undefined {
  return (error as { code?: string })?.code;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((entry) => typeof entry === 'string');
}
