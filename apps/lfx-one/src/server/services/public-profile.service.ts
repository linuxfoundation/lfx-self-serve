// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PublicProfile } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import {
  PUBLIC_PROFILE_FETCH_TIMEOUT_MS,
  PUBLIC_PROFILE_SERVICE_NAME,
  PUBLIC_PROFILE_USERNAME_PATTERN,
  PUBLIC_PROFILES_BUCKET_URL_ENV,
  UPSTREAM_ERROR_BODY_LIMIT,
} from '../constants';
import { MicroserviceError } from '../errors';
import { logger } from './logger.service';

/**
 * Resolves the configured S3 bucket base URL that hosts public profile artifacts from
 * `PUBLIC_PROFILES_BUCKET_URL`, trimming any trailing slashes so the object key can be
 * appended directly. Returns an empty string when the var is unset or blank — there is no
 * baked-in default (see the env constant's doc comment); the caller treats an empty result as
 * "not configured" and fails the request loudly rather than reading the wrong bucket.
 */
export function getPublicProfilesBucketUrl(): string {
  return (process.env[PUBLIC_PROFILES_BUCKET_URL_ENV] || '').trim().replace(/\/+$/, '');
}

/**
 * Normalizes the artifact's public flag into a single boolean. The upstream flow only
 * publishes a file when the profile is public, so an absent flag is treated as public;
 * only an explicit `false` (in either the PascalCase `IsPublic` or camelCase `isPublic`
 * form some artifacts use) marks the profile private.
 */
export function resolvePublicFlag(parsed: Record<string, unknown>): boolean {
  const raw = parsed['IsPublic'] ?? parsed['isPublic'];
  return raw !== false;
}

/**
 * Fetches a user's public profile artifact from S3 (no authentication). Returns `null` when
 * the username is malformed or the artifact does not exist (S3 404) — both surface to the
 * caller as "not found". Any other failure (network, timeout, non-404 upstream status,
 * empty/invalid body) throws a MicroserviceError.
 *
 * The parsed payload is returned verbatim with a normalized `isPublic` flag attached; the
 * controller is responsible for withholding the body when the profile is private.
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

    // Validate the operator-supplied bucket URL is well-formed and http(s) before fetching. The
    // host is fixed by config (not user input), so this guards against a misconfigured bucket
    // value (malformed URL, or a non-http scheme like file:) rather than user-driven SSRF — a
    // clear 503 beats an opaque network 502 when the environment is set up wrong.
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
      const body = (await upstream.text().catch(() => '')).slice(0, UPSTREAM_ERROR_BODY_LIMIT);
      logger.warning(req, operation, 'Public profile fetch returned non-OK response', {
        status: upstream.status,
        status_text: upstream.statusText,
        body,
        username,
      });
      throw new MicroserviceError(`Public profile fetch failed: ${upstream.status} ${upstream.statusText}`, upstream.status, 'PUBLIC_PROFILE_FETCH_FAILED', {
        operation,
        service: PUBLIC_PROFILE_SERVICE_NAME,
        errorBody: body,
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

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch (error: unknown) {
      const truncatedBody = rawBody.slice(0, UPSTREAM_ERROR_BODY_LIMIT);
      logger.warning(req, operation, 'Public profile artifact was invalid JSON', { err: error, body: truncatedBody, username });
      throw new MicroserviceError('Public profile fetch failed: invalid JSON response from upstream', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation,
        service: PUBLIC_PROFILE_SERVICE_NAME,
        errorBody: truncatedBody,
      });
    }

    return { ...parsed, isPublic: resolvePublicFlag(parsed) } as PublicProfile;
  }
}
