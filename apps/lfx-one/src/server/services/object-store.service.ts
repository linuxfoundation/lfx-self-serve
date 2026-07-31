// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreateBucketCommand, HeadBucketCommand, NotFound, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Request } from 'express';

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
    await this.ensureBucket();

    const sanitizedUsername = username.trim().toLowerCase();
    const key = `avatars/${sanitizedUsername}`;
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
          CacheControl: 'public, max-age=31536000',
        })
      );

      // Percent-encode only at URL-construction time — the S3 key itself stays unencoded (matches
      // packages/shared/src/utils/avatar.utils.ts's buildMyprofileAvatarUrl convention), since
      // encoding the key would cause the HTTP layer to decode it before it reaches S3, mismatching
      // the literally-encoded stored key.
      const cdnPrefix = process.env['CDN_URL_PREFIX'];
      const url = cdnPrefix ? `${cdnPrefix.replace(/\/+$/, '')}/avatars/${encodeURIComponent(sanitizedUsername)}?v=${Date.now()}` : null;

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
        region: process.env['AWS_REGION'] || 'us-east-1',
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

      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      logger.success(undefined, 'object_store_ensure_bucket', startTime, { bucket, created: true });
    }
  }
}
