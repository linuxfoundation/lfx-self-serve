// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LF_FOUNDATION_ROOT_SLUG, ROOT_PROJECT_SLUG, ROOT_PROJECT_UID_CACHE_TTL_MS } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import { Request } from 'express';

import { logger } from '../services/logger.service';
import { NatsService } from '../services/nats.service';

/**
 * Shared cache for well-known project slug→uid resolutions, keyed by slug. This is a deliberate,
 * documented exception to this directory's "keep helpers pure — no shared mutable state" guideline
 * (see `docs/architecture/backend/server-helpers.md`): the state is a pure, TTL-bounded memoization
 * of a small, fixed set of well-known values, losing it costs one extra NATS round-trip rather than
 * any correctness, and the alternative — every caller keeping its own copy, as `PersonaDetectionService`
 * did before this extraction — is strictly worse (more NATS load, and places that can disagree).
 */
const projectUidCache = new Map<string, { uid: string | null; expiresAt: number }>();

/**
 * Test-only escape hatch for the module-level cache above. Without this, the cache leaks across
 * `it()` blocks in any spec exercising `resolveRootProjectUid`/`resolveLfFoundationRootUid`
 * (directly or via `PersonaDetectionService`/`FormationService`): one test's successful resolution
 * silently answers a later test that expects a fresh NATS lookup (e.g. one asserting fail-closed
 * behavior on an empty/erroring response), since the cached value wins before the mock is ever
 * consulted. Call this from `beforeEach` in any spec that mocks the NATS lookup this helper wraps.
 */
export function resetRootProjectUidCacheForTests(): void {
  projectUidCache.clear();
}

async function resolveProjectUidBySlug(req: Request, natsService: NatsService, slug: string, operation: string): Promise<string | null> {
  const cached = projectUidCache.get(slug);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.uid;
  }

  try {
    const codec = natsService.getCodec();
    const response = await natsService.request(NatsSubjects.PROJECT_SLUG_TO_UID, codec.encode(slug), { timeout: 5000 });
    const uid = codec.decode(response.data).trim();
    if (!uid) {
      // Don't cache empty responses — a transient glitch would disable resolution for the full TTL.
      logger.warning(req, operation, 'Slug resolved to empty UID', { slug });
      return null;
    }
    projectUidCache.set(slug, { uid, expiresAt: Date.now() + ROOT_PROJECT_UID_CACHE_TTL_MS });
    return uid;
  } catch (error) {
    logger.warning(req, operation, 'Slug→UID NATS lookup failed', { err: error, slug });
    return null;
  }
}

/**
 * Resolves the tenant's hidden ROOT project to its uid via the `PROJECT_SLUG_TO_UID` NATS lookup,
 * caching the result for `ROOT_PROJECT_UID_CACHE_TTL_MS`. Fails closed to `null` on any lookup
 * failure or empty response — callers that use this to collapse `parent_uid` must treat `null` as
 * "could not resolve, leave the value as-is", never as "no parent". A `null` is never cached, so a
 * transient NATS glitch doesn't disable ROOT resolution for the full TTL.
 *
 * This is the hidden NATS sentinel, distinct from `resolveLfFoundationRootUid` (the `tlf` umbrella
 * foundation the UI actually seeds as the default scope) — see `LF_FOUNDATION_ROOT_SLUG`'s doc
 * comment. Used for persona detection's root-writer bypass checks and the formation BFF's
 * ROOT → `null` parent collapse.
 */
export async function resolveRootProjectUid(req: Request, natsService: NatsService): Promise<string | null> {
  return resolveProjectUidBySlug(req, natsService, ROOT_PROJECT_SLUG, 'resolve_root_project_uid');
}

/**
 * Resolves the LF umbrella foundation (`LF_FOUNDATION_ROOT_SLUG`, slug `tlf`) to its uid, caching
 * the result the same way `resolveRootProjectUid` does. This is the uid the UI actually seeds as
 * the default `foundation_uid` on unscoped landing (e.g. `/foundation/formations`), and is what
 * "root scope" means for aggregation purposes elsewhere in the codebase (`isUmbrella` checks in
 * `project.service.ts`) — do not substitute `resolveRootProjectUid`'s hidden NATS sentinel here.
 */
export async function resolveLfFoundationRootUid(req: Request, natsService: NatsService): Promise<string | null> {
  return resolveProjectUidBySlug(req, natsService, LF_FOUNDATION_ROOT_SLUG, 'resolve_lf_foundation_root_uid');
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
