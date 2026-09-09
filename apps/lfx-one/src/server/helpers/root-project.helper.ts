// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ROOT_PROJECT_SLUG, ROOT_PROJECT_UID_CACHE_TTL_MS } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import { Request } from 'express';

import { logger } from '../services/logger.service';
import { NatsService } from '../services/nats.service';

/**
 * Single shared cache for the ROOT project's uid, keyed by nothing (there is exactly one ROOT
 * project per environment). This is a deliberate, documented exception to this directory's
 * "keep helpers pure — no shared mutable state" guideline (see `docs/architecture/backend/server-helpers.md`):
 * the state is a pure, TTL-bounded memoization of a single well-known value, losing it costs one
 * extra NATS round-trip rather than any correctness, and the alternative — every caller keeping
 * its own copy of this cache, as `PersonaDetectionService` did before this extraction — is strictly
 * worse (more NATS load, and two places that can disagree about the ROOT uid).
 */
let rootProjectUidCache: { uid: string | null; expiresAt: number } | null = null;

/**
 * Test-only escape hatch for the module-level cache above. Without this, the cache leaks across
 * `it()` blocks in any spec exercising `resolveRootProjectUid` (directly or via
 * `PersonaDetectionService`/`FormationService`): one test's successful resolution silently answers
 * a later test that expects a fresh NATS lookup (e.g. one asserting fail-closed behavior on an
 * empty/erroring response), since the cached value wins before the mock is ever consulted. Call
 * this from `beforeEach` in any spec that mocks the NATS lookup this helper wraps.
 */
export function resetRootProjectUidCacheForTests(): void {
  rootProjectUidCache = null;
}

/**
 * Resolves the tenant's hidden ROOT project to its uid via the `PROJECT_SLUG_TO_UID` NATS lookup,
 * caching the result for `ROOT_PROJECT_UID_CACHE_TTL_MS`. Fails closed to `null` on any lookup
 * failure or empty response — callers that use this to collapse `parent_uid` must treat `null` as
 * "could not resolve, leave the value as-is", never as "no parent". A `null` is never cached, so a
 * transient NATS glitch doesn't disable ROOT resolution for the full TTL.
 *
 * Extracted from `PersonaDetectionService.resolveRootUid` (originally private, per-instance) so
 * every consumer — persona detection's root-writer bypass checks, and the formation BFF's
 * ROOT → `null` parent collapse — shares one resolution point and one cache instead of each
 * keeping a separate copy that could disagree.
 */
export async function resolveRootProjectUid(req: Request, natsService: NatsService): Promise<string | null> {
  if (rootProjectUidCache && Date.now() < rootProjectUidCache.expiresAt) {
    return rootProjectUidCache.uid;
  }

  try {
    const codec = natsService.getCodec();
    const response = await natsService.request(NatsSubjects.PROJECT_SLUG_TO_UID, codec.encode(ROOT_PROJECT_SLUG), { timeout: 5000 });
    const uid = codec.decode(response.data).trim();
    if (!uid) {
      // Don't cache empty responses — a transient glitch would disable bypass for ROOT_PROJECT_UID_CACHE_TTL_MS.
      logger.warning(req, 'resolve_root_project_uid', 'ROOT slug resolved to empty UID', { slug: ROOT_PROJECT_SLUG });
      return null;
    }
    rootProjectUidCache = { uid, expiresAt: Date.now() + ROOT_PROJECT_UID_CACHE_TTL_MS };
    return uid;
  } catch (error) {
    logger.warning(req, 'resolve_root_project_uid', 'ROOT slug→UID NATS lookup failed', { err: error, slug: ROOT_PROJECT_SLUG });
    return null;
  }
}

/**
 * Collapses a formation/project `parent_uid` that points at the hidden ROOT project to `null`,
 * matching `Formation.parent_uid`'s documented contract (`null` for a top-level project) at
 * `formation.interface.ts:61-82`. Upstream never collapses this itself — a top-level project's
 * `parent_uid` is copied verbatim from the project service, which parents it to ROOT — so the BFF
 * is the producer that has to do it.
 *
 * Fail-safe direction: if `rootUid` is `null` (ROOT couldn't be resolved), this returns `parentUid`
 * unchanged rather than guessing. A missed collapse mislabels a row as `child_project`; a wrong
 * collapse would hide real hierarchy, which is worse.
 */
export function collapseRootParentUid(parentUid: string | null | undefined, rootUid: string | null): string | null | undefined {
  if (rootUid && parentUid === rootUid) {
    return null;
  }
  return parentUid;
}
