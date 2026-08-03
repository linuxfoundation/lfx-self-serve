// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import type { Request } from 'express';

import { logger } from '../services/logger.service';
import type { NatsService } from '../services/nats.service';

/**
 * Result of a batched `lfx.lookup_v1_mapping` resolution — three-way, not two-way, because a
 * caller that wants to cache "no mapping exists" (e.g. `member-v1-mapping.helper.ts`'s negative
 * cache) needs to tell that apart from "we don't actually know yet":
 * - `resolved`: the id mapped successfully.
 * - `confirmedUnresolved`: NATS answered and the answer was a valid "no mapping" (empty response,
 *   an `error:`-prefixed response, or a response that didn't parse) — safe to negative-cache.
 * - Neither: indeterminate — the request itself threw (timeout, connection issue), or the id was
 *   never attempted because the wall-clock budget broke the loop first. A caller must NOT treat
 *   this the same as `confirmedUnresolved` for caching purposes — retry it next time instead of
 *   locking in "no mapping" for an id that was never actually asked about.
 */
export interface V1MappingBatchResult {
  resolved: Map<string, string>;
  confirmedUnresolved: Set<string>;
}

/**
 * Generic engine behind every `lfx.lookup_v1_mapping` consumer in this app (committee, and now
 * committee-member) — extracted from what was originally `committee-v1-mapping.helper.ts`'s only
 * function so a second consumer doesn't fork a copy of the batching/budget/degrade logic.
 * `resolveCommitteeV2UidsToV1Ids` is now a thin wrapper over this with the committee-specific
 * lookup-key and response-parse callbacks; its own doc comment covers the v1/v2 split rationale.
 * `entityLabel` (e.g. `'committee'`, `'committee-member'`) is folded into the one log message that
 * originally named the entity type explicitly, so the committee wrapper's log output is
 * byte-for-byte unchanged after the extraction (verified by re-running its existing spec unmodified).
 *
 * Batched at `concurrency` in-flight requests at a time (default `NATS_CONFIG.LOOKUP_BATCH_CONCURRENCY`)
 * rather than firing one per id unconditionally — a caller resolving a large N (e.g. LF staff visible
 * on hundreds of committees, or a large committee roster) shouldn't burst hundreds of concurrent NATS
 * round trips in one call. That batching trades an unbounded burst for a worst case of
 * `ceil(N / concurrency)` sequential timeouts if the responder is down, which for a large N is
 * minutes, not seconds — so the whole call is also capped at `budgetMs` wall-clock (default
 * `NATS_CONFIG.LOOKUP_BATCH_BUDGET_MS`): once exceeded, no further batches are issued and whatever
 * resolved so far is returned. `concurrency`/`budgetMs` are overridable per call (not just per
 * committee-scale defaults) since a future consumer's fan-out characteristics may differ enough to
 * warrant its own tuning without touching this shared engine's defaults or the committee path's
 * already-pinned test expectations.
 */
export async function resolveV1MappingBatch(
  req: Request,
  natsService: NatsService,
  ids: string[],
  buildLookupKey: (id: string) => string,
  parseResponse: (responseText: string) => string | null,
  logOperation: string,
  entityLabel: string,
  options?: { concurrency?: number; budgetMs?: number }
): Promise<V1MappingBatchResult> {
  const concurrency = options?.concurrency ?? NATS_CONFIG.LOOKUP_BATCH_CONCURRENCY;
  const budgetMs = options?.budgetMs ?? NATS_CONFIG.LOOKUP_BATCH_BUDGET_MS;

  const codec = natsService.getCodec();
  const resolved = new Map<string, string>();
  const confirmedUnresolved = new Set<string>();
  const deadline = Date.now() + budgetMs;

  type ResolveOneResult = { status: 'resolved'; id: string; v1Id: string } | { status: 'confirmed-unresolved'; id: string };

  const resolveOne = async (v2Uid: string): Promise<ResolveOneResult | null> => {
    try {
      const lookupKey = buildLookupKey(v2Uid);
      const response = await natsService.request(NatsSubjects.LOOKUP_V1_MAPPING, codec.encode(lookupKey), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const responseText = codec.decode(response.data);

      // Response format is entity-specific (parsed via `parseResponse`), but empty/`error:` is universal.
      if (!responseText || responseText.startsWith('error:')) {
        logger.warning(req, logOperation, 'NATS lookup returned no mapping', {
          v2_uid: v2Uid,
          response: responseText || '(empty)',
        });
        return { status: 'confirmed-unresolved', id: v2Uid };
      }

      const v1Id = parseResponse(responseText);
      if (!v1Id) {
        logger.warning(req, logOperation, 'Unexpected NATS response format', {
          v2_uid: v2Uid,
          response: responseText,
        });
        return { status: 'confirmed-unresolved', id: v2Uid };
      }

      return { status: 'resolved', id: v2Uid, v1Id };
    } catch (error) {
      // Indeterminate — the request itself failed, not a "no mapping" answer. Returning `null`
      // (rather than `confirmed-unresolved`) keeps this id out of both result buckets so a caller
      // like the member-mapping cache never locks in a negative-cache entry for a transient NATS
      // hiccup.
      logger.warning(req, logOperation, `Failed to resolve v2->v1 ${entityLabel} mapping`, {
        v2_uid: v2Uid,
        err: error,
      });
      return null;
    }
  };

  for (let i = 0; i < ids.length; i += concurrency) {
    if (Date.now() > deadline) {
      logger.warning(req, logOperation, 'Lookup batch budget exceeded; returning the partial map resolved so far', {
        resolved_count: resolved.size,
        requested_count: ids.length,
      });
      break;
    }
    const batch = ids.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(resolveOne));
    for (const result of batchResults) {
      if (!result) continue;
      if (result.status === 'resolved') resolved.set(result.id, result.v1Id);
      else confirmedUnresolved.add(result.id);
    }
  }

  return { resolved, confirmedUnresolved };
}
