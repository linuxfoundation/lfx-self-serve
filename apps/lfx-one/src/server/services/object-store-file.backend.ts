// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ObjectStoreBackend, ObjectStoreListEntry, ObjectStorePutInput, ObjectStoreReadResult } from '@lfx-one/shared/interfaces';
import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { OBJECT_STORE_FILE_METADATA_SUFFIX } from '../constants';

/**
 * The file-backed backend of the object store — one folder per purpose,
 * used when no bucket is configured (local hand tests, unit tests). Mirrors
 * the S3 backend's observable behaviour so every caller runs unchanged:
 *
 * - An object key is a relative path under the purpose folder
 *   (`brand-kit/<project>/<sha>.md` → `<root>/brand-kit/<project>/<sha>.md`);
 *   nested prefixes become nested folders.
 * - What S3 keeps as object headers (content type, cache control, user
 *   metadata) lives in a `<key>.meta.json` sidecar next to the body. An
 *   object with no sidecar reads back with empty metadata, like an S3 object
 *   written without any.
 * - `lastModified` is the body file's mtime, so the shared artifact layer's
 *   "latest is write time" ordering — and its metadata-refresh rewrite that
 *   advances the stamp — behave exactly as against S3.
 * - A missing folder lists as empty instead of failing: before the first
 *   write there is nothing stored, and a local run should not WARN about it.
 *
 * Keys are resolved and then checked to still sit inside the purpose folder,
 * so no key — however it was built — can read or write outside the store.
 */
export class FileObjectStoreBackend implements ObjectStoreBackend {
  public readonly kind = 'file' as const;
  private readonly root: string;

  /** @param root Absolute (or cwd-relative) folder holding this purpose's objects. */
  public constructor(root: string) {
    this.root = resolve(root);
  }

  public location(): string {
    return this.root;
  }

  public async readiness(): Promise<boolean> {
    try {
      await access(this.root);
      return true;
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
      await stat(bodyPath);
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
    await mkdir(dirname(bodyPath), { recursive: true });
    const sidecar: FileObjectSidecar = {
      contentType: input.contentType,
      cacheControl: input.cacheControl,
      metadata: input.metadata ?? {},
    };
    // Sidecar first, body last: a reader only sees the object once its body
    // exists, and by then the labels describing it are already on disk.
    await writeFile(`${bodyPath}${OBJECT_STORE_FILE_METADATA_SUFFIX}`, JSON.stringify(sidecar, null, 2));
    await writeFile(bodyPath, input.body);
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
    return { body, metadata: (await this.readSidecar(bodyPath)).metadata };
  }

  public async listObjects(prefix: string): Promise<ObjectStoreListEntry[]> {
    let entries: { name: string; parentPath: string; isFile(): boolean }[];
    try {
      entries = await readdir(this.root, { recursive: true, withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }
      throw error;
    }

    const objects: ObjectStoreListEntry[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.endsWith(OBJECT_STORE_FILE_METADATA_SUFFIX)) {
        continue;
      }
      const bodyPath = join(entry.parentPath, entry.name);
      // Keys are always posix-separated, whatever the host filesystem uses.
      const key = relative(this.root, bodyPath).split(sep).join('/');
      if (!key.startsWith(prefix)) {
        continue;
      }
      objects.push({ key, lastModified: (await stat(bodyPath)).mtime });
    }
    return objects;
  }

  /**
   * The body file for a key. Refuses a key that cannot round-trip through
   * `listObjects` as the same string — an empty, `.` or `..` segment (so a
   * leading, trailing or doubled `/`) — or that would collide with a sidecar,
   * and then checks the resolved path still sits inside the purpose folder as
   * defense in depth.
   */
  private resolveKey(key: string): string {
    const segments = key.split('/');
    if (!key || key.endsWith(OBJECT_STORE_FILE_METADATA_SUFFIX) || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new Error(`Object key is not storable in the file-backed object store: "${key}"`);
    }
    const bodyPath = resolve(this.root, ...segments);
    const inside = relative(this.root, bodyPath);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
      throw new Error(`Object key escapes the file-backed object store folder: "${key}"`);
    }
    return bodyPath;
  }

  /** The sidecar next to a body — or empty labels when it was never written or is unreadable as JSON. */
  private async readSidecar(bodyPath: string): Promise<FileObjectSidecar> {
    const empty: FileObjectSidecar = { contentType: '', cacheControl: '', metadata: {} };
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
      const parsed = JSON.parse(raw) as Partial<FileObjectSidecar>;
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

/** On-disk shape of the `<key>.meta.json` sidecar — the headers S3 would keep on the object. */
interface FileObjectSidecar {
  contentType: string;
  cacheControl: string;
  metadata: Record<string, string>;
}

/** True for ENOENT (and ENOTDIR, when a key segment names a file) — the file-system "confirmed missing". */
function isMissing(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((entry) => typeof entry === 'string');
}
