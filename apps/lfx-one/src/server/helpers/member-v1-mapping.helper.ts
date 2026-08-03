// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import type { Request } from 'express';

import type { NatsService } from '../services/nats.service';
import { buildMemberV1MappingCacheKey, valkeyService } from '../services/valkey.service';
import { resolveV1MappingBatch } from './v1-mapping-batch.helper';

/** Shape stored under a member's cache entry — wrapped (never a bare `v1Id`/`null`) so a confirmed
 * "no mapping" entry (`v1Id: null`) is distinguishable from a cache miss, which `getJson` itself
 * already represents as `null`. Without the wrapper, a negative-cached entry and an absent one would
 * be indistinguishable, defeating the whole point of the negative cache (skipping NATS on a known-unmapped member). */
interface MemberV1MappingCacheEntry {
  v1Id: string | null;
}

function isMemberV1MappingCacheEntry(value: unknown): value is MemberV1MappingCacheEntry {
  if (!value || typeof value !== 'object') return false;
  const v1Id = (value as { v1Id?: unknown }).v1Id;
  return v1Id === null || typeof v1Id === 'string';
}

/**
 * Resolves LFX v2 committee-member UUIDs to the v1 member SFID via the same
 * `lfx.lookup_v1_mapping` NATS bridge `committee-v1-mapping.helper.ts` uses for committees
 * (`committee_member.uid.<v2Uid>` key, response `"{project_sfid}:{committee_sfid}:{member_sfid}"` —
 * the member SFID is the third segment). TODO(LFXV2-2973): this whole bridge is temporary — remove
 * it once the warehouse model carries v2 keys directly (LFXV2-2968).
 *
 * The exact response shape here is the one open assumption in this bridge: it comes from the
 * `lfx-v1-sync-helper` repo's documented NATS contract, not from any in-repo evidence or a live
 * round-trip test in this codebase. If the real shape differs, every uid degrades to unresolved
 * (never throws) — the one line to change is `parseResponse` below.
 *
 * Fronted by a long-TTL (`MEMBER_V1_MAPPING_TTL_SECONDS`, 7d) Valkey cache — a person's legacy
 * identity is stable, so once resolved there's no reason to re-hit NATS for the same member on
 * every request. A confirmed "no mapping" answer is negative-cached at a much shorter TTL
 * (`MEMBER_V1_MAPPING_DEGRADE_TTL_SECONDS`, 1h) so a roster of genuinely-unmapped members doesn't
 * hammer NATS on every page load, while a mapping added later (e.g. after a backfill) still shows
 * up within the hour. Critically, this negative cache is only ever written for a *confirmed*
 * "no mapping" NATS response (`resolveV1MappingBatch`'s `confirmedUnresolved`) — never for an
 * indeterminate one (a timed-out request, or a uid the wall-clock budget never got to). Caching the
 * latter would silently convert a transient NATS hiccup into "this member has no mapping" for a full
 * hour, for every consumer of that member across every committee they're on.
 *
 * The cache-check phase deliberately does NOT reuse `NATS_CONFIG.LOOKUP_BATCH_CONCURRENCY`'s
 * chunking — that constant protects a remote NATS responder from a request burst, which doesn't
 * apply to a Valkey `GET` (a single multiplexed command over one already-open connection). All
 * cache reads fire in one unchunked `Promise.all` instead.
 *
 * Cache read/write failures never throw or fail this call — `ValkeyService.getJson`/`setJson`
 * already degrade to `null`/`false` internally on any Valkey outage, so a fully-down cache just
 * means every uid falls through to NATS, still bounded by the NATS batch's own budget.
 *
 * Returns a `Map<v2Uid, v1Id>` containing only entries that resolved (via cache or NATS) — an
 * unmapped, unresolved, or budget-cut-off uid is simply absent, matching
 * `resolveCommitteeV2UidsToV1Ids`'s existing "map membership = did it resolve" contract.
 */
export async function resolveMemberV2UidsToV1Ids(req: Request, natsService: NatsService, memberUids: string[]): Promise<Map<string, string>> {
  const uniqueUids = [...new Set(memberUids)];
  const result = new Map<string, string>();
  if (uniqueUids.length === 0) return result;

  const uncached: string[] = [];

  await Promise.all(
    uniqueUids.map(async (uid) => {
      const key = buildMemberV1MappingCacheKey(uid);
      const cached = key ? await valkeyService.getJson<MemberV1MappingCacheEntry>(key, isMemberV1MappingCacheEntry) : null;
      if (cached === null) {
        uncached.push(uid);
        return;
      }
      if (cached.v1Id !== null) result.set(uid, cached.v1Id);
      // else: confirmed-negative cache hit — leave unresolved, don't re-ask NATS.
    })
  );

  if (uncached.length === 0) return result;

  const { resolved, confirmedUnresolved } = await resolveV1MappingBatch(
    req,
    natsService,
    uncached,
    (v2Uid) => `committee_member.uid.${v2Uid}`,
    (responseText) => {
      const parts = responseText.split(':');
      return parts.length >= 3 && parts[2] ? parts[2] : null;
    },
    'resolve_member_v1_mapping',
    'committee-member'
  );

  await Promise.all(
    uncached.map(async (uid) => {
      const v1Id = resolved.get(uid);
      if (v1Id) result.set(uid, v1Id);

      // A `null` key (unsafe uid) bypasses the cache entirely — still resolved above via NATS, just
      // never persisted — matching `buildCommitteeCacheKey`'s existing fail-closed convention.
      const key = buildMemberV1MappingCacheKey(uid);
      if (!key) return;

      if (v1Id) {
        await valkeyService.setJson(key, { v1Id }, VALKEY_CACHE.MEMBER_V1_MAPPING_TTL_SECONDS);
      } else if (confirmedUnresolved.has(uid)) {
        await valkeyService.setJson(key, { v1Id: null }, VALKEY_CACHE.MEMBER_V1_MAPPING_DEGRADE_TTL_SECONDS);
      }
      // Indeterminate (neither resolved nor confirmedUnresolved): no cache write — retry next time.
    })
  );

  return result;
}
