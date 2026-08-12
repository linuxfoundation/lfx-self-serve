// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  PublicProfile,
  PublicProfileBadge,
  PublicProfileBasic,
  PublicProfileCertification,
  PublicProfileTechnicalContribution,
  PublicProfileTraining,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import {
  PUBLIC_PROFILE_CERTIFICATION_STATUS_ALLOWLIST,
  PUBLIC_PROFILE_EPOCH_PLACEHOLDER,
  PUBLIC_PROFILE_FETCH_TIMEOUT_MS,
  PUBLIC_PROFILE_SERVICE_NAME,
  PUBLIC_PROFILE_TRAINING_STATUS_ALLOWLIST,
  PUBLIC_PROFILE_TRAINING_TYPE_ALLOWLIST,
  PUBLIC_PROFILE_TRAINING_TYPE_KNOWN_EXCLUDED,
  PUBLIC_PROFILE_USERNAME_PATTERN,
  PUBLIC_PROFILES_BUCKET_URL_ENV,
} from '../constants';
import { MicroserviceError } from '../errors';
import { deriveAvatarUrl } from '../utils/avatar-url.util';
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
 * anonymous endpoint, so it fails closed: the payload is released only when at least one flag
 * casing (IsPublic/isPublic) is present and every present casing is explicitly boolean `true`.
 * A missing, non-boolean, or conflicting flag (e.g. `{ IsPublic: true, isPublic: false }`)
 * resolves to `false` — artifacts exist for private profiles too, so anything but an unambiguous
 * opt-in must not leak.
 */
export function resolvePublicFlag(parsed: Record<string, unknown>): boolean {
  const keys = ['IsPublic', 'isPublic'] as const;
  const present = keys.filter((key) => Object.prototype.hasOwnProperty.call(parsed, key));
  return present.length > 0 && present.every((key) => parsed[key] === true);
}

/** Narrows an unknown to a string, or undefined when absent/non-string. */
function pickString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Narrows an unknown to a finite number, defaulting contribution counts to 0. */
function pickCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Narrows an unknown to a plain object for further field projection, or undefined. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Narrows an unknown to an array of plain-object records, dropping non-object entries. */
function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== undefined) : [];
}

function projectBasic(value: unknown, username?: string): PublicProfileBasic | undefined {
  const basic = asRecord(value);
  if (!basic) {
    return undefined;
  }
  // The public page renders at most one identity username (the hero's GitHub link picks the first
  // non-empty one), so project only that single username — never the full connected-identity list —
  // to keep this endpoint's render-only PII boundary intact.
  const firstUsername = asRecordArray(basic['Identities'])
    .map((identity) => pickString(identity['Username']))
    .find((identityUsername) => !!identityUsername && !!identityUsername.trim());
  return {
    Name: pickString(basic['Name']),
    LogoURL: pickString(basic['LogoURL']),
    avatarUrl: (username && deriveAvatarUrl(username)) || undefined,
    TwitterID: pickString(basic['TwitterID']),
    LinkedInID: pickString(basic['LinkedInID']),
    GithubID: pickString(basic['GithubID']),
    Title: pickString(basic['Title']),
    Bio: pickString(basic['Bio']),
    AccountName: pickString(basic['AccountName']),
    AccountLogoURL: pickString(basic['AccountLogoURL']),
    Identities: firstUsername ? [{ Username: firstUsername }] : undefined,
  };
}

function projectTechnicalContribution(value: unknown): PublicProfileTechnicalContribution | undefined {
  const contribution = asRecord(value);
  if (!contribution) {
    return undefined;
  }
  const projects = asRecordArray(contribution['projects']).map((project) => ({
    LogoURL: pickString(project['LogoURL']),
    Name: pickString(project['Name']),
    Slug: pickString(project['Slug']),
    commits: pickCount(project['commits']),
    deleted: pickCount(project['deleted']),
    added: pickCount(project['added']),
    prs: pickCount(project['prs']),
    issues: pickCount(project['issues']),
  }));
  return { projects };
}

/**
 * Blanks the epoch-zero placeholder date, passing other values through. Uses `startsWith('1970')`
 * (tighter than myprofile's `includes`) so only a leading epoch year counts as the placeholder.
 */
function scrubEpochDate(value: unknown): string | undefined {
  const date = pickString(value);
  if (date === undefined) {
    return undefined;
  }
  return date.startsWith(PUBLIC_PROFILE_EPOCH_PLACEHOLDER) ? '' : date;
}

// Public trainings, myprofile parity: keep allow-listed statuses + types, blank epoch dates, sort by
// name. Raw `Status` drives the filter only and is never projected to the client.
function projectTrainingActivities(value: unknown, req?: Request): PublicProfileTraining[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  let droppedForUnknownType = 0;
  const kept = asRecordArray(value).filter((activity) => {
    const status = pickString(activity['Status']);
    const type = pickString(activity['Type']);
    const statusAllowed = status !== undefined && PUBLIC_PROFILE_TRAINING_STATUS_ALLOWLIST.has(status);
    const typeAllowed = type !== undefined && PUBLIC_PROFILE_TRAINING_TYPE_ALLOWLIST.has(type);
    // Drift signal: an allow-listed Status with a Type that's neither allow-listed nor a known
    // excluded type (exam/subscription/bundle) means the myprofile vocabulary likely drifted — count it.
    if (statusAllowed && type !== undefined && !typeAllowed && !PUBLIC_PROFILE_TRAINING_TYPE_KNOWN_EXCLUDED.has(type)) {
      droppedForUnknownType++;
    }
    return statusAllowed && typeAllowed;
  });
  if (droppedForUnknownType > 0) {
    logger.warning(req, 'project_public_profile', 'Dropped training rows with an unrecognized Type', {
      dropped_for_unknown_type: droppedForUnknownType,
    });
  }
  return kept
    .map((activity) => ({
      Name: pickString(activity['Name']),
      Type: pickString(activity['Type']),
      StartDate: scrubEpochDate(activity['StartDate']),
      EndDate: scrubEpochDate(activity['EndDate']),
    }))
    .sort((a, b) => (a.Name ?? '').localeCompare(b.Name ?? ''));
}

// Public certifications: completed only, sorted by name. Stricter than myprofile parity — also drops
// an absent StartDate and matches the epoch date with `startsWith`. Raw `Status` is never projected.
function projectCertificationActivities(value: unknown): PublicProfileCertification[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return asRecordArray(value)
    .filter((activity) => {
      const status = pickString(activity['Status']);
      const startDate = pickString(activity['StartDate']);
      return (
        status !== undefined &&
        PUBLIC_PROFILE_CERTIFICATION_STATUS_ALLOWLIST.has(status) &&
        startDate !== undefined &&
        !startDate.startsWith(PUBLIC_PROFILE_EPOCH_PLACEHOLDER)
      );
    })
    .map((activity) => ({
      Name: pickString(activity['Name']),
      Type: pickString(activity['Type']),
      StartDate: pickString(activity['StartDate']),
      EndDate: pickString(activity['EndDate']),
    }))
    .sort((a, b) => (a.Name ?? '').localeCompare(b.Name ?? ''));
}

function projectBadges(value: unknown): PublicProfileBadge[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return asRecordArray(value).map((badge) => ({
    Image: pickString(badge['Image']),
    Url: pickString(badge['Url']),
  }));
}

/**
 * Projects the raw S3 artifact down to the render-only allowlist — fail closed, so any field not
 * listed here never reaches the client. This is the sole PII boundary for the anonymous endpoint.
 */
export function projectPublicProfile(record: Record<string, unknown>, req?: Request, username?: string): PublicProfile {
  return {
    isPublic: resolvePublicFlag(record),
    basic: projectBasic(record['basic'], username),
    About: pickString(record['About']),
    technical_contribution: projectTechnicalContribution(record['technical_contribution']),
    certification_activities: projectCertificationActivities(record['certification_activities']),
    training_activities: projectTrainingActivities(record['training_activities'], req),
    badges: projectBadges(record['badges']),
  };
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

    // Validate the operator-supplied bucket *base* (not the combined key URL) before fetching —
    // guards a misconfigured bucket value (malformed URL / non-http scheme), not user SSRF.
    // Parsing the base rather than the combined URL is what closes the empty-authority hole:
    // a bucket set to just `https://` collapses to `https:`, which `new URL()` rejects here,
    // whereas `new URL('https:/jane.json')` is lenient and would treat the username as the host.
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(bucketUrl);
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

    // Build the object-key URL from the validated base. encodeURIComponent guards the key even
    // though the username pattern above already excludes path/traversal characters.
    const url = `${bucketUrl}/${encodeURIComponent(username)}.json`;

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
      const errorName = error instanceof Error ? error.name : 'UnknownError';

      // Keep the network diagnostics (name + code) in the server log, but throw a stable public
      // message/code: apiErrorHandler serializes MicroserviceError.message/.code into the response,
      // so raw fetch diagnostics (ENOTFOUND, ECONNREFUSED, TLS errors) must not reach anonymous callers.
      logger.warning(req, operation, 'Public profile fetch failed before response', { error_name: errorName, error_code: networkCode, username });
      throw new MicroserviceError('Public profile fetch failed: upstream unreachable', 502, 'UPSTREAM_UNREACHABLE', {
        operation,
        service: PUBLIC_PROFILE_SERVICE_NAME,
      });
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
      // Log only the error name and body length, never the error object — Node's JSON.parse
      // SyntaxError message embeds a snippet of the input, which may hold private profile data.
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      logger.warning(req, operation, 'Public profile artifact was invalid JSON', { error_name: errorName, body_length: rawBody.length, username });
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
    return projectPublicProfile(record, req, username);
  }
}
