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
 * - `confirmedUnresolved`: NATS explicitly answered "no mapping" — an **empty** response. Per the
 *   `lfx-v1-sync-helper` responder's own contract, empty is returned both for a genuine
 *   not-found key and for a tombstoned (deleted) mapping — both real, confirmed "no mapping"
 *   states, safe to negative-cache.
 * - Neither: indeterminate — the request itself threw (timeout, connection issue), the id was never
 *   attempted because the wall-clock budget broke the loop first, the response was an
 *   `error:`-prefixed one (the responder's KV read itself failed — an infrastructure fault, not a
 *   "no mapping" answer), or `parseResponse` rejected a non-empty, non-error response (a shape
 *   mismatch, or — for a caller like the member helper whose `parseResponse` also screens out a
 *   transient/poisoned upstream value — a state that may resolve correctly on a later attempt). A
 *   caller must NOT treat any of these the same as `confirmedUnresolved` for caching purposes:
 *   negative-caching an infra blip or a parse failure would mask the exact signal (repeated
 *   warnings) that reveals the underlying issue, and could lock in a transient-but-fixable state for
 *   the full negative-cache TTL.
 */
export interface V1MappingBatchResult {
  resolved: Map<string, string>;
  confirmedUnresolved: Set<string>;
}

/** Named-parameter bag for `resolveV1MappingBatch` — folds what were previously trailing positional
 * arguments (`buildLookupKey`, `parseResponse`, `logOperation`, `entityLabel`) into one object so two
 * adjacent same-typed strings (`logOperation`/`entityLabel`) can't be silently transposed at a call
 * site; a swap there would compile cleanly but produce plausible-looking-but-wrong log output. */
export interface V1MappingBatchOptions {
  buildLookupKey: (id: string) => string;
  parseResponse: (responseText: string) => string | null;
  logOperation: string;
  entityLabel: string;
  concurrency?: number;
  budgetMs?: number;
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
  options: V1MappingBatchOptions
): Promise<V1MappingBatchResult> {
  const { buildLookupKey, parseResponse, logOperation, entityLabel } = options;
  const concurrency = options.concurrency ?? NATS_CONFIG.LOOKUP_BATCH_CONCURRENCY;
  const budgetMs = options.budgetMs ?? NATS_CONFIG.LOOKUP_BATCH_BUDGET_MS;

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

      // Only an explicit empty response is a *confirmed* "no mapping" answer, universal across every
      // consumer of this subject — the responder returns empty for both a genuine not-found key and
      // a tombstoned mapping (verified against the real lookup handler).
      if (!responseText) {
        logger.warning(req, logOperation, 'NATS lookup returned no mapping', {
          v2_uid: v2Uid,
          response: '(empty)',
        });
        return { status: 'confirmed-unresolved', id: v2Uid };
      }

      // `error:` means the responder's own KV read failed (JetStream unavailable, bucket
      // unreachable, deadline exceeded) — an infrastructure fault, not proof no mapping exists.
      // Indeterminate, not confirmed-unresolved: caching this as "no mapping" would turn a transient
      // NATS-side blip into an hour of false negatives for every affected id.
      if (responseText.startsWith('error:')) {
        logger.warning(req, logOperation, 'NATS lookup responder returned an error; treating as indeterminate', {
          v2_uid: v2Uid,
          response: responseText,
        });
        return null;
      }

      const v1Id = parseResponse(responseText);
      if (!v1Id) {
        // Indeterminate, NOT confirmed-unresolved: NATS answered with *something*, but this
        // consumer's parser couldn't extract a usable id from it — a shape mismatch (this entity's
        // response format is wrong) or a value `parseResponse` itself rejected as unusable-for-now
        // (e.g. the member helper's transient/poisoned-record screen). Either way it's not proof no
        // mapping exists, so it must not be cached as one.
        logger.warning(req, logOperation, 'Unexpected NATS response format', {
          v2_uid: v2Uid,
          response: responseText,
        });
        return null;
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
