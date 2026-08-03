// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SALESFORCE_ID_PATTERN, VALKEY_CACHE } from '@lfx-one/shared/constants';
import type { Request } from 'express';

import { logger } from '../services/logger.service';
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
 * Parses a `committee_member.uid.<v2Uid>` response (`"{project_sfid}:{committee_sfid}:{member_sfid}"`)
 * into the usable member id, or `null` if the response can't be trusted yet.
 *
 * Two checks, both driven by `lfx-v1-sync-helper`'s own documented contract for this key (its
 * `parseCommitteeMemberReverseMapping`): the third field is a *discriminated union*, not always a
 * usable person identifier.
 *
 * 1. Requires exactly 3 segments, not "at least 3" — a legacy 4-field `recordSFID:contactSFID` value
 *    (an extra colon from an older mapping generation) would otherwise silently fold its extra
 *    segment into this parser's 3rd field, handing back the wrong id without any error.
 * 2. Requires the 3rd field to look like a valid Salesforce ID (upstream's own `sfid.IsValid` gate,
 *    `SALESFORCE_ID_PATTERN` — exactly 15 or exactly 18 alphanumeric characters, no other length).
 *    This one shape check does double duty for both of upstream's rejection cases: a bare UUID (the
 *    "poisoned" pre-backfill form of this mapping — the `platform-community__c` *record* SFID, a
 *    committee-membership row identifier, not the member's actual contact identity, the exact bug
 *    LFXV2-2673's backfill script exists to repair) — whether the canonical 36-char hyphenated
 *    string form or its 32-char hex-only form — already fails this pattern, so no separate UUID
 *    check is needed to catch it. See `SALESFORCE_ID_PATTERN`'s own doc and this file's spec for
 *    which constraint (length vs. character class) catches which form.
 *
 * Note the two upstream-rejection causes aren't equally transient: a poisoned (UUID) value is
 * genuinely backfill-fixable (LFXV2-2673's script targets exactly that state), but upstream's own
 * backfill script *permanently* skips a malformed (neither UUID- nor SFID-shaped) `contact_name__c`
 * as an unresolvable data-quality issue — it will never repair itself. This function still returns
 * `null` for both today, which routes the uid through `resolveV1MappingBatch`'s indeterminate path
 * (never cached, retried every request) rather than distinguishing them; a malformed value therefore
 * re-issues a NATS round trip and logs a warning on every request indefinitely, not just until a
 * backfill lands. Accepting either shape instead would be worse — reporting a *successful*
 * resolution to a value that can never join `MEMBER_USER_ID`, positive-cached for
 * `MEMBER_V1_MAPPING_TTL_SECONDS` (7 days) — but the retry-forever cost of the malformed case is a
 * known, currently-accepted trade-off, not a solved one; a future improvement would give
 * `resolveV1MappingBatch` a third outcome so a malformed (as opposed to poisoned) value can be
 * negative-cached like a confirmed non-mapping instead.
 */
export function parseMemberMappingResponse(responseText: string): string | null {
  const parts = responseText.split(':');
  if (parts.length !== 3 || !parts[2]) return null;
  if (!SALESFORCE_ID_PATTERN.test(parts[2])) return null;
  return parts[2];
}

/**
 * Resolves LFX v2 committee-member UUIDs to the v1 member SFID via the same
 * `lfx.lookup_v1_mapping` NATS bridge `committee-v1-mapping.helper.ts` uses for committees
 * (`committee_member.uid.<v2Uid>` key — see `parseMemberMappingResponse` for the response shape and
 * its discriminated-union caveat). TODO(LFXV2-2973): this whole bridge is temporary — remove it once
 * the warehouse model carries v2 keys directly (LFXV2-2968).
 *
 * Beyond the response-shape parsing, one open assumption remains unverified: whether the resolved
 * `member_sfid` actually shares an identity space with the warehouse's `MEMBER_USER_ID` column at
 * all (candidates include a Salesforce Contact SFID and a legacy LFID — both appear in live
 * `MEMBER_USER_ID` samples). This resolver can only be as correct as that assumption; live
 * validation must confirm real joins before trusting this bridge's output in production.
 *
 * Fronted by a long-TTL (`MEMBER_V1_MAPPING_TTL_SECONDS`, 7d) Valkey cache — a person's legacy
 * identity is stable, so once resolved there's no reason to re-hit NATS for the same member on
 * every request. A confirmed "no mapping" answer is negative-cached at a much shorter TTL
 * (`MEMBER_V1_MAPPING_DEGRADE_TTL_SECONDS`, 1h) so a roster of genuinely-unmapped members doesn't
 * hammer NATS on every page load, while a mapping added later (e.g. after a backfill) still shows
 * up within the hour. Critically, this negative cache is only ever written for a *confirmed*
 * "no mapping" NATS response (`resolveV1MappingBatch`'s `confirmedUnresolved`) — never for an
 * indeterminate one (a timed-out request, a uid the wall-clock budget never got to, or a response
 * `parseMemberMappingResponse` rejected). Caching any of those would silently convert a transient or
 * fixable state into "this member has no mapping" for a full hour, for every consumer of that member
 * across every committee they're on.
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
  let cacheHits = 0;
  let negativeCacheHits = 0;
  let cacheBypassedUnsafeUids = 0;

  await Promise.all(
    uniqueUids.map(async (uid) => {
      const key = buildMemberV1MappingCacheKey(uid);
      if (!key) {
        cacheBypassedUnsafeUids++;
        uncached.push(uid);
        return;
      }
      const cached = await valkeyService.getJson<MemberV1MappingCacheEntry>(key, isMemberV1MappingCacheEntry);
      if (cached === null) {
        uncached.push(uid);
        return;
      }
      if (cached.v1Id !== null) {
        result.set(uid, cached.v1Id);
        cacheHits++;
      } else {
        // confirmed-negative cache hit — leave unresolved, don't re-ask NATS.
        negativeCacheHits++;
      }
    })
  );

  if (cacheBypassedUnsafeUids > 0) {
    logger.warning(req, 'resolve_member_v1_mapping', 'Member uid failed the cache-key safety check; bypassing cache for it', {
      unsafe_uid_count: cacheBypassedUnsafeUids,
    });
  }

  if (uncached.length === 0) {
    logger.debug(req, 'resolve_member_v1_mapping', 'Member v1-mapping resolution complete (cache-only, no NATS calls)', {
      requested_count: uniqueUids.length,
      cache_hits: cacheHits,
      negative_cache_hits: negativeCacheHits,
      resolved_count: result.size,
    });
    return result;
  }

  const { resolved, confirmedUnresolved } = await resolveV1MappingBatch(req, natsService, uncached, {
    buildLookupKey: (v2Uid) => `committee_member.uid.${v2Uid}`,
    parseResponse: parseMemberMappingResponse,
    logOperation: 'resolve_member_v1_mapping',
    entityLabel: 'committee-member',
  });

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

  logger.debug(req, 'resolve_member_v1_mapping', 'Member v1-mapping resolution complete', {
    requested_count: uniqueUids.length,
    cache_hits: cacheHits,
    negative_cache_hits: negativeCacheHits,
    nats_resolved_count: resolved.size,
    nats_confirmed_unresolved_count: confirmedUnresolved.size,
    resolved_count: result.size,
    unresolved_count: uniqueUids.length - result.size,
  });

  return result;
}
