// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BucketLocationConstraint, CreateBucketCommand, HeadBucketCommand, NotFound, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Request } from 'express';

import { buildAvatarUrl, getAvatarCdnPrefix, toAvatarKeySegment } from '../utils/avatar-url.util';
import { logger } from './logger.service';

/**
 * Generic S3-compatible object-store service for managing bucket readiness and uploads.
 * This service handles only infrastructure concerns, not business logic.
 */
export class ObjectStoreService {
  private client: S3Client | null = null;
  private ensureBucketPromise: Promise<void> | null = null;

  /**
   * Ensure the configured bucket exists (lazy, memoized). Only creates it when
   * S3_CREATE_MISSING_BUCKET is explicitly 'true' (local dev) — never gated on whether
   * S3_ENDPOINT_URL is set, since that override is also used for non-local S3-compatible
   * backends where the app must never create buckets. Otherwise a HeadBucket-only check,
   * so a missing bucket in deployed envs surfaces as a permissions/config error, not a
   * silently masked "not ready yet".
   */
  public async ensureBucket(): Promise<void> {
    if (!this.ensureBucketPromise) {
      // Reset only happens here, inside the settled .catch — so concurrent callers made while a
      // check is in flight all share this same pending promise and see the same outcome, and a
      // retry is only possible on the next call after this one has already rejected.
      this.ensureBucketPromise = this.doEnsureBucket().catch((error) => {
        this.ensureBucketPromise = null;
        throw error;
      });
    }
    return this.ensureBucketPromise;
  }

  /**
   * Store readiness check (HeadBucket) for health/readiness endpoints.
   */
  public async readiness(): Promise<boolean> {
    try {
      await this.getClient().send(new HeadBucketCommand({ Bucket: this.getBucket() }));
      return true;
    } catch {
      return false;
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

  private getBucket(): string {
    const bucket = process.env['S3_BUCKET'];
    if (!bucket) {
      throw new Error('S3_BUCKET environment variable is required');
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

  private async doEnsureBucket(): Promise<void> {
    const bucket = this.getBucket();
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
        logger.error(undefined, 'object_store_ensure_bucket', startTime, error, { bucket });
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
