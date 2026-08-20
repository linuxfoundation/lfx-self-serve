// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  BucketLocationConstraint,
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Request } from 'express';

import { buildAvatarUrl, getAvatarCdnPrefix, toAvatarKeySegment } from '../utils/avatar-url.util';
import { logger } from './logger.service';

/**
 * Storage purposes and their bucket env vars (purpose-keyed buckets —
 * lfx-one is multi-bucket per the LFX object-store design):
 * - `avatars`: public profile pictures (S3_BUCKET, CDN-fronted).
 * - `marketing-os-artifacts`: private marketing artifacts, key-prefix
 *   namespaced per artifact type (MARKETING_OS_ARTIFACTS_S3_BUCKET,
 *   dec-brand-kit-storage-v2).
 */
export type ObjectStorePurpose = 'avatars' | 'marketing-os-artifacts';

const PURPOSE_BUCKET_ENV: Record<ObjectStorePurpose, string> = {
  avatars: 'S3_BUCKET',
  'marketing-os-artifacts': 'MARKETING_OS_ARTIFACTS_S3_BUCKET',
};

/**
 * Generic S3-compatible object-store service for managing bucket readiness and uploads.
 * This service handles only infrastructure concerns, not business logic.
 */
export class ObjectStoreService {
  private client: S3Client | null = null;
  private ensureBucketPromises: Partial<Record<ObjectStorePurpose, Promise<void>>> = {};

  /**
   * Ensure the configured bucket exists (lazy, memoized). Only creates it when
   * S3_CREATE_MISSING_BUCKET is explicitly 'true' (local dev) — never gated on whether
   * S3_ENDPOINT_URL is set, since that override is also used for non-local S3-compatible
   * backends where the app must never create buckets. Otherwise a HeadBucket-only check,
   * so a missing bucket in deployed envs surfaces as a permissions/config error, not a
   * silently masked "not ready yet".
   *
   * `options.degradable` controls the failure log level: callers that catch and degrade
   * gracefully (e.g. `putObjectIfAbsent` consumers like Brand Kit persistence) pass true so a
   * readiness outage logs WARN instead of ERROR — the request still succeeds, so an ERROR here
   * would page on a recovered path. Non-degradable callers (avatar upload) keep ERROR. The
   * severity is captured when the memoized check is created; concurrent callers of the same
   * purpose share that promise and its single log line, which is exact today because each
   * purpose has a single caller class (avatars → uploadProfilePicture, marketing-os-artifacts →
   * putObjectIfAbsent).
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
   * Store readiness check (HeadBucket) for health/readiness endpoints.
   */
  public async readiness(purpose: ObjectStorePurpose = 'avatars'): Promise<boolean> {
    try {
      await this.getClient().send(new HeadBucketCommand({ Bucket: this.getBucket(purpose) }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Idempotent, content-addressed write into a purpose-keyed bucket. When the
   * key already exists (same content by construction for content-addressed
   * keys), the write is skipped and reported as a no-op success.
   *
   * Note: HEAD-then-PUT is racy under concurrency, but the race is benign for
   * content-addressed keys — concurrent writers PUT identical bytes and the
   * last write is indistinguishable from the first.
   *
   * @returns true when a new object was written, false when it already existed.
   */
  public async putObjectIfAbsent(
    req: Request,
    purpose: ObjectStorePurpose,
    key: string,
    body: Buffer,
    contentType: string,
    cacheControl: string,
    metadata?: Record<string, string>
  ): Promise<boolean> {
    // degradable: a readiness failure here rethrows to consumers that catch and degrade
    // gracefully (same rationale as the WARN in the catch below), so it must log WARN — not
    // ERROR — or a transient S3 outage on a successfully-degraded request would still page.
    await this.ensureBucket(purpose, { degradable: true });

    const bucket = this.getBucket(purpose);
    const client = this.getClient();
    const startTime = logger.startOperation(req, 'object_store_put_if_absent', { purpose, key, content_type: contentType, size: body.length });

    try {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        logger.success(req, 'object_store_put_if_absent', startTime, { key, written: false });
        return false;
      } catch (error) {
        // Only a confirmed 404/NotFound means "object is missing" — anything else
        // (403, timeout, 5xx) must rethrow, never be treated as absent.
        const isConfirmedNotFound = error instanceof NotFound || (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404;
        if (!isConfirmedNotFound) {
          throw error;
        }
      }

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: cacheControl,
          ...(metadata && { Metadata: metadata }),
        })
      );
      logger.success(req, 'object_store_put_if_absent', startTime, { key, written: true });
      return true;
    } catch (error) {
      // WARN, not ERROR: this idempotent write is a best-effort primitive whose
      // failures are recoverable by design — its consumers (Brand Kit
      // persistence) catch and degrade gracefully, per the graceful-degradation
      // rule in logging-patterns.md. The recovering caller owns the operational
      // WARN; an unrecovered rethrow still reaches the centralized
      // apiErrorHandler, which logs at ERROR. Logging ERROR here as well would
      // page on every transient outage of a path that returns a successful
      // response.
      logger.warning(req, 'object_store_put_if_absent', 'Object HEAD/PUT failed — rethrowing for the caller to handle', {
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
   * fetching bodies). Paginates through every ListObjectsV2 page; the
   * consuming partitions (content-addressed artifact prefixes) stay small,
   * so no page cap is needed.
   *
   * No ensureBucket first: reads never create buckets, and a missing bucket
   * surfaces as an S3 error the caller handles like any other read failure
   * (the Brand Kit stored-document consumer degrades it to "none stored").
   */
  public async listObjects(req: Request, purpose: ObjectStorePurpose, prefix: string): Promise<{ key: string; lastModified?: Date }[]> {
    const bucket = this.getBucket(purpose);
    const client = this.getClient();
    const startTime = logger.startOperation(req, 'object_store_list_objects', { purpose, prefix });

    try {
      const objects: { key: string; lastModified?: Date }[] = [];
      let continuationToken: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ...(continuationToken && { ContinuationToken: continuationToken }) })
        );
        for (const entry of page.Contents ?? []) {
          if (entry.Key) {
            objects.push({ key: entry.Key, lastModified: entry.LastModified });
          }
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);

      logger.success(req, 'object_store_list_objects', startTime, { prefix, count: objects.length });
      return objects;
    } catch (error) {
      // WARN, not ERROR: same graceful-degradation rationale as putObjectIfAbsent —
      // the consumers of this read primitive (Brand Kit stored lookup) catch and
      // degrade to "none stored"; an unrecovered rethrow still reaches the
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
   * bucket. Returns null only on a CONFIRMED missing object (404/NoSuchKey) —
   * anything else (403, timeout, 5xx) rethrows, never masquerades as absent.
   */
  public async getObject(req: Request, purpose: ObjectStorePurpose, key: string): Promise<{ body: string; metadata: Record<string, string> } | null> {
    const bucket = this.getBucket(purpose);
    const client = this.getClient();
    const startTime = logger.startOperation(req, 'object_store_get_object', { purpose, key });

    try {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = (await response.Body?.transformToString('utf-8')) ?? '';
      logger.success(req, 'object_store_get_object', startTime, { key, size: body.length });
      return { body, metadata: response.Metadata ?? {} };
    } catch (error) {
      const isConfirmedNotFound =
        error instanceof NoSuchKey || error instanceof NotFound || (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404;
      if (isConfirmedNotFound) {
        logger.success(req, 'object_store_get_object', startTime, { key, found: false });
        return null;
      }
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
      await this.getClient().send(
        new PutObjectCommand({
          Bucket: this.getBucket(),
          Key: key,
          Body: buffer,
          ContentType: contentType,
          // Short TTL, not long-lived/immutable: the `?v=` query param below is a cache-busting
          // hint, not a content-addressed version. A stale copy of the URL persisted elsewhere
          // (e.g. Auth0 user_metadata, a denormalized search-index field) must converge back to
          // current bytes within this window on its own — a long max-age defeats that and pins
          // any such copy to stale bytes indefinitely. See lfx-skills PR #67.
          CacheControl: 'public, max-age=86400',
        })
      );

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

  private getBucket(purpose: ObjectStorePurpose = 'avatars'): string {
    const envVar = PURPOSE_BUCKET_ENV[purpose];
    const bucket = process.env[envVar];
    if (!bucket) {
      throw new Error(`${envVar} environment variable is required`);
    }
    return bucket;
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
    const bucket = this.getBucket(purpose);
    const client = this.getClient();
    const startTime = logger.startOperation(undefined, 'object_store_ensure_bucket', { bucket });

    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      logger.success(undefined, 'object_store_ensure_bucket', startTime, { bucket, created: false });
    } catch (error) {
      // Only a confirmed 404/NotFound means "bucket is missing" — a 403, timeout, or 5xx must
      // rethrow rather than be treated as missing, or a permissions/outage error gets masked as
      // "not ready yet" and silently attempted as a create.
      const isConfirmedNotFound = error instanceof NotFound || (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404;

      if (!isConfirmedNotFound || process.env['S3_CREATE_MISSING_BUCKET'] !== 'true') {
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

      // us-east-1 is the one region S3 rejects an explicit LocationConstraint for (it must be
      // omitted, not set to 'us-east-1') — every other region needs it or CreateBucket defaults
      // to us-east-1 regardless of the client's configured region.
      const region = this.getRegion();
      await client.send(
        new CreateBucketCommand({
          Bucket: bucket,
          ...(region !== 'us-east-1' && { CreateBucketConfiguration: { LocationConstraint: region as BucketLocationConstraint } }),
        })
      );
      logger.success(undefined, 'object_store_ensure_bucket', startTime, { bucket, created: true });
    }
  }
}
