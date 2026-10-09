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
import { ObjectStoreBackend, ObjectStoreListEntry, ObjectStorePutInput, ObjectStoreReadResult } from '@lfx-one/shared/interfaces';

/**
 * The S3 backend of the object store — one instance per purpose-keyed bucket,
 * sharing the service's single `S3Client`. Holds every S3-specific concern
 * (command shapes, pagination, 404 detection, the bucket-creation policy) so
 * the service orchestrates and logs the same way whichever backend serves a
 * purpose. Deployed environments always run on this backend.
 */
export class S3ObjectStoreBackend implements ObjectStoreBackend {
  public readonly kind = 's3' as const;

  public constructor(
    private readonly bucket: string,
    private readonly client: S3Client,
    private readonly region: string
  ) {}

  public location(): string {
    return this.bucket;
  }

  public async readiness(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * HeadBucket, then CreateBucket only when the bucket is CONFIRMED missing
   * (404) AND `S3_CREATE_MISSING_BUCKET` is explicitly 'true' (a local
   * S3-compatible store) — never gated on `S3_ENDPOINT_URL`, since that
   * override is also used for non-local S3-compatible backends where the app
   * must never create buckets. A 403, timeout or 5xx rethrows rather than
   * being treated as missing, or a permissions/outage error gets masked as
   * "not ready yet" and silently attempted as a create; a 404 without the flag
   * rethrows so a missing bucket in deployed envs surfaces as a
   * permissions/config error, not a silently masked "not ready yet".
   */
  public async ensureBucket(): Promise<{ created: boolean }> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { created: false };
    } catch (error) {
      if (!isConfirmedNotFound(error) || process.env['S3_CREATE_MISSING_BUCKET'] !== 'true') {
        throw error;
      }
    }

    // us-east-1 is the one region S3 rejects an explicit LocationConstraint for (it must be
    // omitted, not set to 'us-east-1') — every other region needs it or CreateBucket defaults
    // to us-east-1 regardless of the client's configured region.
    await this.client.send(
      new CreateBucketCommand({
        Bucket: this.bucket,
        ...(this.region !== 'us-east-1' && { CreateBucketConfiguration: { LocationConstraint: this.region as BucketLocationConstraint } }),
      })
    );
    return { created: true };
  }

  public async headObject(key: string): Promise<Record<string, string> | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return head.Metadata ?? {};
    } catch (error) {
      // Only a confirmed 404/NotFound means "object is missing" — anything else
      // (403, timeout, 5xx) must rethrow, never be treated as absent.
      if (isConfirmedNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  public async putObject(key: string, input: ObjectStorePutInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.body,
        ContentType: input.contentType,
        CacheControl: input.cacheControl,
        ...(input.metadata && { Metadata: input.metadata }),
      })
    );
  }

  public async getObject(key: string): Promise<ObjectStoreReadResult | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = (await response.Body?.transformToString('utf-8')) ?? '';
      return { body, metadata: response.Metadata ?? {} };
    } catch (error) {
      if (error instanceof NoSuchKey || isConfirmedNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Paginates through every ListObjectsV2 page; the consuming partitions
   * (content-addressed artifact prefixes) stay small, so no page cap is needed.
   */
  public async listObjects(prefix: string): Promise<ObjectStoreListEntry[]> {
    const objects: ObjectStoreListEntry[] = [];
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ...(continuationToken && { ContinuationToken: continuationToken }) })
      );
      for (const entry of page.Contents ?? []) {
        if (entry.Key) {
          objects.push({ key: entry.Key, lastModified: entry.LastModified });
        }
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
    return objects;
  }
}

/** True only for a CONFIRMED 404/NotFound — the one S3 failure that means "missing". */
function isConfirmedNotFound(error: unknown): boolean {
  return error instanceof NotFound || (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404;
}
