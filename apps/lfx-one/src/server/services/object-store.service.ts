// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { S3Client } from '@aws-sdk/client-s3';
import { ObjectStoreBackend, ObjectStoreListEntry, ObjectStorePurpose, ObjectStorePutInput, ObjectStoreReadResult } from '@lfx-one/shared/interfaces';
import { Request } from 'express';
import { resolve } from 'node:path';

import { OBJECT_STORE_LOCAL_DEFAULT_DIR, OBJECT_STORE_LOCAL_DIR_ENV, OBJECT_STORE_PURPOSE_BUCKET_ENV, OBJECT_STORE_PURPOSE_FILE_FALLBACK } from '../constants';
import { PreconditionFailedError, ServiceValidationError } from '../errors';
import { buildAvatarUrl, getAvatarCdnPrefix, toAvatarKeySegment } from '../utils/avatar-url.util';
import { logger } from './logger.service';
import { FileObjectStoreBackend } from './object-store-file.backend';
import { S3ObjectStoreBackend } from './object-store-s3.backend';

/**
 * Generic object-store service for managing bucket readiness, uploads and
 * reads. This service handles only infrastructure concerns, not business logic.
 *
 * Purpose-keyed buckets (`ObjectStorePurpose`, env vars in
 * `OBJECT_STORE_PURPOSE_BUCKET_ENV`): a purpose whose bucket env var is set is
 * served by S3 (`S3ObjectStoreBackend`). The private `marketing-os-artifacts`
 * purpose with its var unset is served by a folder under the app directory
 * (`FileObjectStoreBackend`, `apps/lfx-one/.object-store/<purpose>/`) using the
 * shared ObjectStoreBackend contract, including its documented file-write
 * contention case. Local runs persist documents without credentials. The public,
 * CDN-fronted `avatars` purpose never falls back (`OBJECT_STORE_PURPOSE_FILE_FALLBACK`):
 * its callers persist a `CDN_URL_PREFIX` URL, which a file on disk could not
 * serve, so its bucket var stays required as before. Under `NODE_ENV=production`
 * every bucket var is REQUIRED: deployed environments keep S3, and a
 * misconfigured pod must surface the missing var, never quietly write to its own disk.
 */
export class ObjectStoreService {
  private client: S3Client | null = null;
  private backends: Partial<Record<ObjectStorePurpose, ObjectStoreBackend>> = {};
  private ensureBucketPromises: Partial<Record<ObjectStorePurpose, Promise<void>>> = {};

  /**
   * Ensure the purpose's bucket (or folder) is ready for writes (lazy, memoized). The
   * creation policy is the backend's: S3 creates a confirmed-missing bucket only when
   * S3_CREATE_MISSING_BUCKET is explicitly 'true' (local S3-compatible stores) and otherwise
   * rethrows so a missing bucket in deployed envs surfaces as a permissions/config error; the
   * file backend always creates its folder.
   *
   * `options.degradable` controls the failure log level: callers that catch and degrade
   * gracefully (e.g. `putContentAddressedObject`'s consumer, the shared Marketing OS
   * agent-artifact persistence layer) pass true
   * so a readiness outage logs WARN instead of ERROR — the request still succeeds, so an ERROR here
   * would page on a recovered path. Non-degradable callers (avatar upload) keep ERROR. The
   * severity is captured when the memoized check is created; concurrent callers of the same
   * purpose share that promise and its single log line, which is exact today because each
   * purpose has a single caller class (avatars → uploadProfilePicture, marketing-os-artifacts →
   * MktgArtifactService, the one persistence layer every agent goes through).
   */
  public async ensureBucket(purpose: ObjectStorePurpose = 'avatars', options: { degradable?: boolean } = {}): Promise<void> {
    if (!this.ensureBucketPromises[purpose]) {
      // Reset only happens here, inside the settled .catch — so concurrent callers made while a
      // check is in flight all share this same pending promise and see the same outcome, and a
      // retry is only possible on the next call after this one has already rejected.
      this.ensureBucketPromises[purpose] = this.doEnsureBucket(purpose, options.degradable === true).catch((error) => {
        this.ensureBucketPromises[purpose] = undefined;
        throw error;
      });
    }
    return this.ensureBucketPromises[purpose];
  }

  /**
   * Store readiness check (HeadBucket, or folder access) for health/readiness endpoints.
   */
  public async readiness(purpose: ObjectStorePurpose = 'avatars'): Promise<boolean> {
    try {
      return await this.getBackend(purpose).readiness();
    } catch {
      return false;
    }
  }

  /**
   * Idempotent, content-addressed write into a purpose-keyed bucket. The key
   * is derived from a hash of the bytes, so an object that already exists
   * holds identical content by construction and its body is never rewritten —
   * the write is skipped and reported as a no-op success.
   *
   * The object's user METADATA is not content-addressed, though: the same
   * bytes can be produced again by a later, differently-labelled revision, and
   * the stored labels (plus the store's last-modified stamp) would still
   * describe the revision that happened to write them first. A caller that
   * reads those labels back — or that treats last-modified as "last produced"
   * — passes `options.refreshMetadataWhen` to re-PUT the identical bytes with
   * fresh metadata. It receives the stored metadata and MUST be monotonic
   * (true only for a strictly newer revision), or an idempotent no-op becomes
   * a write on every repeat call.
   *
   * HEAD-then-PUT remains racy. On S3, concurrent content-addressed writers
   * PUT identical body bytes; last-writer-wins does not change that content.
   * On the file backend, the exclusive per-key lock can instead reject an
   * overlapping put with PreconditionFailedError, even for identical bytes.
   * This method WARNs and rethrows; the Marketing OS artifact caller degrades
   * to no receipt and retries on the next result poll.
   *
   * @returns true when the object was written (absent, or metadata refreshed), false on the no-op.
   */
  public async putContentAddressedObject(
    req: Request,
    purpose: ObjectStorePurpose,
    key: string,
    body: Buffer,
    contentType: string,
    cacheControl: string,
    metadata?: Record<string, string>,
    options: { refreshMetadataWhen?: (storedMetadata: Record<string, string>) => boolean } = {}
  ): Promise<boolean> {
    // degradable: a readiness failure here rethrows to consumers that catch and degrade
    // gracefully (same rationale as the WARN in the catch below), so it must log WARN — not
    // ERROR — or a transient S3 outage on a successfully-degraded request would still page.
    await this.ensureBucket(purpose, { degradable: true });

    const backend = this.getBackend(purpose);
    const startTime = logger.startOperation(req, 'object_store_put_content_addressed', { purpose, key, content_type: contentType, size: body.length });

    try {
      let refreshed = false;
      // null only on a CONFIRMED missing object — anything else (403, timeout, 5xx) throws
      // out of headObject and is never treated as absent.
      const storedMetadata = await backend.headObject(key);
      if (storedMetadata !== null) {
        refreshed = options.refreshMetadataWhen?.(storedMetadata) === true;
        if (!refreshed) {
          logger.success(req, 'object_store_put_content_addressed', startTime, { key, written: false });
          return false;
        }
      }

      await backend.putObject(key, { body, contentType, cacheControl, metadata });
      logger.success(req, 'object_store_put_content_addressed', startTime, { key, written: true, metadata_refreshed: refreshed });
      return true;
    } catch (error) {
      // WARN, not ERROR: this idempotent write is a best-effort primitive whose
      // failures are recoverable by design — its consumer (the shared Marketing
      // OS agent-artifact persistence layer, used by every agent that persists a
      // document) catches and degrades gracefully, per the graceful-degradation
      // rule in logging-patterns.md. The recovering caller owns the operational
      // WARN; an unrecovered rethrow still reaches the centralized
      // apiErrorHandler, which logs at ERROR. Logging ERROR here as well would
      // page on every transient outage of a path that returns a successful
      // response.
      logger.warning(req, 'object_store_put_content_addressed', 'Object HEAD/PUT failed — rethrowing for the caller to handle', {
        purpose,
        key,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * List the objects under a key prefix in a purpose-keyed bucket (key +
   * last-modified only — enough for callers to pick a latest object without
   * fetching bodies). The backend walks every page or folder; the consuming
   * partitions (content-addressed artifact prefixes) stay small, so no cap is
   * needed.
   *
   * No ensureBucket first: reads never create buckets, and a missing bucket
   * surfaces as an S3 error the caller handles like any other read failure
   * (the shared agent-artifact stored-document read degrades it to "none stored").
   * The file backend lists a missing folder as empty for the same outcome.
   */
  public async listObjects(req: Request, purpose: ObjectStorePurpose, prefix: string): Promise<ObjectStoreListEntry[]> {
    const backend = this.getBackend(purpose);
    const startTime = logger.startOperation(req, 'object_store_list_objects', { purpose, prefix });

    try {
      const objects = await backend.listObjects(prefix);
      logger.success(req, 'object_store_list_objects', startTime, { prefix, count: objects.length });
      return objects;
    } catch (error) {
      // WARN, not ERROR: same graceful-degradation rationale as putContentAddressedObject —
      // the consumer of this read primitive (the shared agent-artifact stored
      // lookup) catches and degrades to "none stored"; an unrecovered rethrow
      // still reaches the
      // centralized apiErrorHandler, which logs at ERROR.
      logger.warning(req, 'object_store_list_objects', 'Object list failed — rethrowing for the caller to handle', {
        purpose,
        prefix,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Fetch one object's UTF-8 body and user metadata from a purpose-keyed
   * bucket. Returns null only on a CONFIRMED missing object (404/NoSuchKey, or
   * no such file) — anything else (403, timeout, 5xx) rethrows, never
   * masquerades as absent.
   */
  public async getObject(req: Request, purpose: ObjectStorePurpose, key: string): Promise<ObjectStoreReadResult | null> {
    const backend = this.getBackend(purpose);
    const startTime = logger.startOperation(req, 'object_store_get_object', { purpose, key });

    try {
      const object = await backend.getObject(key);
      if (object === null) {
        logger.success(req, 'object_store_get_object', startTime, { key, found: false });
        return null;
      }
      logger.success(req, 'object_store_get_object', startTime, { key, size: object.body.length });
      return object;
    } catch (error) {
      // WARN, not ERROR — same graceful-degradation contract as listObjects.
      logger.warning(req, 'object_store_get_object', 'Object GET failed — rethrowing for the caller to handle', {
        purpose,
        key,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** Metadata-only revision summaries; no bundle download. */
  public async headObject(req: Request, purpose: ObjectStorePurpose, key: string): Promise<Record<string, string> | null> {
    logger.debug(req, 'object_store_head', 'Reading object metadata', { purpose, key });
    return this.getBackend(purpose).headObject(key);
  }

  /** Atomic create/replace. A false result is contention, never an outage or denial. */
  public async putConditionalObject(req: Request, purpose: ObjectStorePurpose, key: string, input: ObjectStorePutInput): Promise<boolean> {
    if ((!input.ifMatch && !input.ifNoneMatch) || (input.ifMatch && input.ifNoneMatch)) {
      throw ServiceValidationError.forField('precondition', 'A conditional write requires exactly one precondition');
    }
    await this.ensureBucket(purpose, { degradable: true });
    try {
      await this.getBackend(purpose).putObject(key, input);
      logger.debug(req, 'object_store_conditional_put', 'Conditional write committed', { purpose, key });
      return true;
    } catch (error) {
      if (error instanceof PreconditionFailedError) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Upload a user's profile picture. Keyed stably per user (`avatars/<username>`) so a
   * re-upload overwrites the same object. Returns the CDN-fronted public URL with a
   * cache-busting query param when CDN_URL_PREFIX is configured, else null. A null url
   * means no absolute URL exists to persist — this service doesn't treat that as an
   * error itself, but callers that require a public URL (e.g. ProfileController) must.
   */
  public async uploadProfilePicture(req: Request, username: string, buffer: Buffer, contentType: string): Promise<{ url: string | null }> {
    const sanitizedUsername = username.trim().toLowerCase();
    const keySegment = toAvatarKeySegment(sanitizedUsername);

    await this.ensureBucket();

    const key = `avatars/${keySegment}`;
    const startTime = logger.startOperation(req, 'object_store_upload_profile_picture', {
      key,
      content_type: contentType,
      size: buffer.length,
    });

    try {
      await this.getBackend('avatars').putObject(key, {
        body: buffer,
        contentType,
        // Short TTL, not long-lived/immutable: the `?v=` query param below is a cache-busting
        // hint, not a content-addressed version. A stale copy of the URL persisted elsewhere
        // (e.g. Auth0 user_metadata, a denormalized search-index field) must converge back to
        // current bytes within this window on its own — a long max-age defeats that and pins
        // any such copy to stale bytes indefinitely. See lfx-skills PR #67.
        cacheControl: 'public, max-age=86400',
      });

      const cdnPrefix = getAvatarCdnPrefix();
      const versionHint = Math.floor(Date.now() / 1000);
      const url = cdnPrefix ? `${buildAvatarUrl(cdnPrefix, keySegment)}?v=${versionHint}` : null;

      logger.success(req, 'object_store_upload_profile_picture', startTime, { key, has_cdn_url: !!url });

      return { url };
    } catch (error) {
      logger.error(req, 'object_store_upload_profile_picture', startTime, error, { key });
      throw error;
    }
  }

  /**
   * Upload a public image into the CDN-fronted bucket under a caller-supplied key. `CDN_URL_PREFIX`
   * fronts the whole bucket, not just the `avatars/` prefix, so a caller that owns its own key
   * namespace (e.g. `mentorship-logos/`) shares the same bucket and CDN.
   *
   * The key is expected to be content-addressed, which makes the object immutable and lets it carry
   * an immutable Cache-Control — unlike `uploadProfilePicture`, whose key is stable per user and so
   * needs a short TTL plus a cache-busting hint. Returns null when `CDN_URL_PREFIX` is unset, the
   * same degraded-mode contract as `uploadProfilePicture`; callers that require a public URL must
   * treat null as an error.
   */
  public async putPublicImage(req: Request, key: string, buffer: Buffer, contentType: string): Promise<{ url: string | null }> {
    await this.ensureBucket();

    const startTime = logger.startOperation(req, 'object_store_put_public_image', { key, content_type: contentType, size: buffer.length });

    try {
      await this.getBackend('avatars').putObject(key, {
        body: buffer,
        contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      });

      const cdnPrefix = getAvatarCdnPrefix();
      // Every segment of a content-addressed key is already URL-safe, so the key is
      // concatenated as-is rather than percent-encoded (which would escape the separators).
      const url = cdnPrefix ? `${cdnPrefix}/${key}` : null;

      logger.success(req, 'object_store_put_public_image', startTime, { key, has_cdn_url: !!url });

      return { url };
    } catch (error) {
      logger.error(req, 'object_store_put_public_image', startTime, error, { key });
      throw error;
    }
  }

  /**
   * The backend serving a purpose (lazy, memoized per purpose): S3 when its
   * bucket env var is set; the file-backed folder when it is not, for a
   * purpose `OBJECT_STORE_PURPOSE_FILE_FALLBACK` allows (private documents
   * only — a public, CDN-fronted purpose would store a URL pointing at
   * nothing) and never under NODE_ENV=production, so a deployed environment
   * never quietly writes documents to its own ephemeral disk. Every other
   * unset var is a configuration error.
   */
  private getBackend(purpose: ObjectStorePurpose): ObjectStoreBackend {
    const existing = this.backends[purpose];
    if (existing) {
      return existing;
    }

    const envVar = OBJECT_STORE_PURPOSE_BUCKET_ENV[purpose];
    const bucket = process.env[envVar];
    const mayFallBack = OBJECT_STORE_PURPOSE_FILE_FALLBACK[purpose] && process.env['NODE_ENV'] !== 'production';
    let backend: ObjectStoreBackend;
    if (bucket) {
      // Region before client: a missing AWS_REGION must fail here, before any client exists.
      const region = this.getRegion();
      backend = new S3ObjectStoreBackend(bucket, this.getClient(), region);
    } else if (!mayFallBack) {
      throw new Error(`${envVar} environment variable is required`);
    } else {
      const directory = resolve(process.env[OBJECT_STORE_LOCAL_DIR_ENV] || OBJECT_STORE_LOCAL_DEFAULT_DIR, purpose);
      backend = new FileObjectStoreBackend(directory);
      // Infrastructure INFO, once per purpose: tells a hand-tester where the documents landed.
      logger.info(undefined, 'object_store_backend', 'No bucket configured — using the file-backed object store', {
        purpose,
        bucket_env: envVar,
        directory,
      });
    }

    this.backends[purpose] = backend;
    return backend;
  }

  private getClient(): S3Client {
    if (!this.client) {
      const endpoint = process.env['S3_ENDPOINT_URL'] || undefined;
      this.client = new S3Client({
        region: this.getRegion(),
        ...(endpoint && { endpoint }),
        forcePathStyle: true,
      });
    }
    return this.client;
  }

  // No fallback: every provisioned bucket is us-west-2, so defaulting to another region (e.g.
  // us-east-1) would sign requests against the wrong region and surface as an opaque
  // PermanentRedirect instead of a clear config error if this var is ever missing.
  private getRegion(): string {
    const region = process.env['AWS_REGION'];
    if (!region) {
      throw new Error('AWS_REGION environment variable is required');
    }
    return region;
  }

  private async doEnsureBucket(purpose: ObjectStorePurpose, degradable: boolean): Promise<void> {
    const backend = this.getBackend(purpose);
    // `bucket` is the backend's location (bucket name, or folder for the file backend) — the
    // field name is kept stable for dashboards and alerts built on it.
    const bucket = backend.location();
    const startTime = logger.startOperation(undefined, 'object_store_ensure_bucket', { bucket, backend: backend.kind });

    try {
      const { created } = await backend.ensureBucket();
      logger.success(undefined, 'object_store_ensure_bucket', startTime, { bucket, created });
    } catch (error) {
      if (degradable) {
        // WARN, not ERROR: the caller declared it catches this rejection and degrades
        // gracefully (graceful-degradation rule in logging-patterns.md) — the recovering
        // caller owns the operational WARN, and an unrecovered rethrow still reaches the
        // centralized apiErrorHandler, which logs at ERROR.
        logger.warning(undefined, 'object_store_ensure_bucket', 'Bucket readiness check failed — rethrowing for the caller to handle', {
          bucket,
          duration: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        logger.error(undefined, 'object_store_ensure_bucket', startTime, error, { bucket });
      }
      throw error;
    }
  }
}
