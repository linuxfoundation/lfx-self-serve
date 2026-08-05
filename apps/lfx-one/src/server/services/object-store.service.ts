// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HeadObjectCommand, NotFound, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { logger } from './logger.service';

/**
 * Thin S3-compatible object-store client following the LFX object-store
 * design contract (`S3_BUCKET`/`AWS_REGION`/`S3_ENDPOINT_URL` env vars):
 *
 * - AWS SDK default credential chain — static env creds locally (MinIO),
 *   IRSA in deployed environments; no credential-mode branching in code.
 * - `S3_ENDPOINT_URL` set → endpoint override + path-style addressing
 *   (required by MinIO/nats-s3); empty → real AWS S3.
 * - No bucket creation: buckets are provisioned ahead of time.
 */
export class ObjectStoreService {
  private client: S3Client | null = null;

  /**
   * Idempotent, content-addressed write. When the key already exists (same
   * sha-addressed content by construction), the write is skipped and reported
   * as a no-op success per the content-addressing contract.
   *
   * @returns true when a new object was written, false when it already existed.
   */
  public async putObjectIfAbsent(req: Request, key: string, body: Buffer, contentType: string): Promise<boolean> {
    const bucket = this.getBucket();
    const client = this.getClient();

    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      logger.info(req, 'object_store_put', 'Object already exists — content-addressed no-op', { key });
      return false;
    } catch (error) {
      if (!this.isNotFound(error)) {
        throw this.wrap(error, 'object_store_head', key);
      }
    }

    try {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
      logger.info(req, 'object_store_put', 'Object written', { key, bytes: body.length });
      return true;
    } catch (error) {
      throw this.wrap(error, 'object_store_put', key);
    }
  }

  /** Lazily construct the S3 client so env is read at first use, not import time. */
  private getClient(): S3Client {
    if (!this.client) {
      const endpoint = process.env['S3_ENDPOINT_URL'] || '';
      this.client = new S3Client({
        region: process.env['AWS_REGION'] || 'us-east-1',
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      });
    }
    return this.client;
  }

  private getBucket(): string {
    const bucket = process.env['S3_BUCKET'] || '';
    if (!bucket) {
      throw new MicroserviceError('Object storage is not configured. Missing environment variable: S3_BUCKET.', 500, 'object_store_not_configured', {
        service: 'object_store',
        operation: 'object_store_config',
      });
    }
    return bucket;
  }

  private isNotFound(error: unknown): boolean {
    if (error instanceof NotFound) {
      return true;
    }
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    return status === 404;
  }

  private wrap(error: unknown, operation: string, key: string): MicroserviceError {
    return new MicroserviceError('Object storage request failed.', 502, 'object_store_error', {
      service: 'object_store',
      path: key,
      operation,
      originalError: error instanceof Error ? error : undefined,
    });
  }
}
