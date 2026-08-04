// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PublicProfile } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { PUBLIC_PROFILE_FETCH_TIMEOUT_MS, PUBLIC_PROFILE_SERVICE_NAME, PUBLIC_PROFILE_USERNAME_PATTERN, PUBLIC_PROFILES_BUCKET_URL_ENV } from '../constants';
import { MicroserviceError } from '../errors';
import { logger } from './logger.service';

/**
 * Resolves the public profiles bucket base URL from env, trimming trailing slashes.
 * Returns '' when unset/blank (no default); the caller treats '' as "not configured".
 */
export function getPublicProfilesBucketUrl(): string {
  return (process.env[PUBLIC_PROFILES_BUCKET_URL_ENV] || '').trim().replace(/\/+$/, '');
}

/**
 * Normalizes the artifact's public flag to a boolean. This is the sole privacy gate for an
 * anonymous endpoint, so it fails closed: the payload is released only when the upstream flag
 * (IsPublic/isPublic) is explicitly boolean `true`. A missing or non-boolean flag resolves to
 * `false` — artifacts exist for private profiles too, so a dropped/malformed flag must not leak.
 */
export function resolvePublicFlag(parsed: Record<string, unknown>): boolean {
  const raw = parsed['IsPublic'] ?? parsed['isPublic'];
  return raw === true;
}

/**
 * Fetches a user's public profile artifact from S3 (no auth). Returns null when the username
 * is malformed or the artifact is missing (404); other failures throw a MicroserviceError.
 */
export class PublicProfileService {
  public async getPublicProfile(req: Request, username: string): Promise<PublicProfile | null> {
    const operation = 'get_public_profile';

    if (!PUBLIC_PROFILE_USERNAME_PATTERN.test(username)) {
      logger.warning(req, operation, 'Rejected malformed username', { username });
      return null;
    }

    const bucketUrl = getPublicProfilesBucketUrl();
    if (!bucketUrl) {
      // No bucket configured for this environment — fail loudly and in isolation rather than
      // reading a wrong/default bucket. The app keeps running; only this endpoint is inert.
      logger.warning(req, operation, `Public profiles bucket not configured (${PUBLIC_PROFILES_BUCKET_URL_ENV} unset)`, { username });
      throw new MicroserviceError(`Public profile fetch failed: ${PUBLIC_PROFILES_BUCKET_URL_ENV} is not configured`, 503, 'PUBLIC_PROFILES_NOT_CONFIGURED', {
        operation,
        service: PUBLIC_PROFILE_SERVICE_NAME,
      });
    }

    const url = `${bucketUrl}/${encodeURIComponent(username)}.json`;

    // Validate the operator-supplied bucket URL is well-formed and http(s) before fetching —
    // guards a misconfigured bucket value (malformed URL / non-http scheme), not user SSRF.
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      logger.warning(req, operation, `Public profiles bucket URL is malformed (${PUBLIC_PROFILES_BUCKET_URL_ENV})`, { bucket_url: bucketUrl, username });
      throw new MicroserviceError(`Public profile fetch failed: ${PUBLIC_PROFILES_BUCKET_URL_ENV} is malformed`, 503, 'PUBLIC_PROFILES_BUCKET_URL_INVALID', {
        operation,
        service: PUBLIC_PROFILE_SERVICE_NAME,
      });
    }
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      logger.warning(req, operation, `Public profiles bucket URL has an unsupported scheme (${PUBLIC_PROFILES_BUCKET_URL_ENV})`, {
        protocol: parsedUrl.protocol,
        username,
      });
      throw new MicroserviceError(
        `Public profile fetch failed: ${PUBLIC_PROFILES_BUCKET_URL_ENV} must use http or https`,
        503,
        'PUBLIC_PROFILES_BUCKET_URL_INVALID',
        {
          operation,
          service: PUBLIC_PROFILE_SERVICE_NAME,
        }
      );
    }

    logger.debug(req, operation, 'Fetching public profile artifact', { username });

    let upstream: Response;
    try {
      upstream = await fetch(url, { signal: AbortSignal.timeout(PUBLIC_PROFILE_FETCH_TIMEOUT_MS) });
    } catch (error: unknown) {
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        logger.warning(req, operation, 'Public profile fetch timed out', { timeout_ms: PUBLIC_PROFILE_FETCH_TIMEOUT_MS, username });
        throw new MicroserviceError(`Public profile fetch failed: request timed out after ${PUBLIC_PROFILE_FETCH_TIMEOUT_MS}ms`, 504, 'UPSTREAM_TIMEOUT', {
          operation,
          service: PUBLIC_PROFILE_SERVICE_NAME,
        });
      }

      const cause = (error as (Error & { cause?: { code?: string } }) | undefined)?.cause;
      const networkCode = cause?.code ?? 'UPSTREAM_UNREACHABLE';
      const message = error instanceof Error ? error.message : String(error);

      logger.warning(req, operation, 'Public profile fetch failed before response', { err: error, error_code: networkCode, username });
      throw new MicroserviceError(`Public profile fetch failed: ${message}`, 502, networkCode, { operation, service: PUBLIC_PROFILE_SERVICE_NAME });
    }

    // A missing artifact is the normal "no public profile" case — surface as not-found, not an error.
    if (upstream.status === 404 || upstream.status === 403) {
      logger.debug(req, operation, 'Public profile artifact not found', { username, status: upstream.status });
      return null;
    }

    if (!upstream.ok) {
      // Log only the body length, never the raw body — this is a public PII-bearing artifact.
      const bodyLength = (await upstream.text().catch(() => '')).length;
      logger.warning(req, operation, 'Public profile fetch returned non-OK response', {
        status: upstream.status,
        status_text: upstream.statusText,
        body_length: bodyLength,
        username,
      });
      throw new MicroserviceError(`Public profile fetch failed: ${upstream.status} ${upstream.statusText}`, upstream.status, 'PUBLIC_PROFILE_FETCH_FAILED', {
        operation,
        service: PUBLIC_PROFILE_SERVICE_NAME,
      });
    }

    const rawBody = await upstream.text();
    if (!rawBody.trim()) {
      logger.warning(req, operation, 'Public profile artifact was empty', { username });
      throw new MicroserviceError('Public profile fetch failed: empty response from upstream', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation,
        service: PUBLIC_PROFILE_SERVICE_NAME,
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch (error: unknown) {
      // Log only the body length, never the raw body — it may hold private profile data.
      logger.warning(req, operation, 'Public profile artifact was invalid JSON', { err: error, body_length: rawBody.length, username });
      throw new MicroserviceError('Public profile fetch failed: invalid JSON response from upstream', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation,
        service: PUBLIC_PROFILE_SERVICE_NAME,
      });
    }

    // Valid JSON can still be the wrong shape (null / array / primitive). Reject anything that
    // isn't a plain object rather than crashing on the flag lookup or spreading a non-object
    // into a "public" payload. Log only the body length, never the raw body.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      logger.warning(req, operation, 'Public profile artifact was not a JSON object', { body_length: rawBody.length, username });
      throw new MicroserviceError('Public profile fetch failed: unexpected response shape from upstream', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation,
        service: PUBLIC_PROFILE_SERVICE_NAME,
      });
    }

    const record = parsed as Record<string, unknown>;
    return { ...record, isPublic: resolvePublicFlag(record) } as PublicProfile;
  }
}
