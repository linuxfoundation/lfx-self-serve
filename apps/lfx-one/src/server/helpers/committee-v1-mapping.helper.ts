// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';

import type { NatsService } from '../services/nats.service';
import { resolveV1MappingBatch } from './v1-mapping-batch.helper';
import type { V1MappingBatchResult } from './v1-mapping-batch.helper';

/**
 * Resolves LFX v2 committee UUIDs to the v1 committee SFID via the platform's
 * `lfx.lookup_v1_mapping` NATS request/reply subject (`NatsSubjects.LOOKUP_V1_MAPPING`).
 *
 * The v2 committee-service mints its own UUIDs — what `/api/committees/...` and the app's own
 * URLs expose — while Snowflake/`silver_dim_committee`/the platinum attendance model still carry
 * the v1 committee SFID (the platform-collaboration source predates v2). Both are correct in
 * their own system; they're simply two different ID spaces for the same committee (confirmed with
 * Jordan Evans, data owner, LFXV2-2968). This is the sanctioned platform bridge for that split —
 * the same one `meeting.controller.ts` already uses for the identical v1/v2 split on the
 * meetings/registrants path, and the same one `member-v1-mapping.helper.ts` now uses for the
 * analogous committee-*member* split (LFXV2-1705) — both share `v1-mapping-batch.helper.ts`'s
 * batching/budget engine rather than forking a copy of it.
 *
 * Returns a `Map<v2Uid, v1Sfid>` containing only entries that resolved — a v2 uid with no mapping
 * (not yet migrated, or a NATS/parse failure) is simply absent from the map rather than a thrown
 * error, so a caller can treat "did this uid resolve" as a map-membership check and degrade
 * whatever it was about to do with an unresolved uid, rather than fail the whole request.
 *
 * Batched at `NATS_CONFIG.LOOKUP_BATCH_CONCURRENCY` in-flight requests at a time rather than firing
 * one per uid unconditionally — a caller resolving a large N (e.g. LF staff visible on hundreds of
 * committees) shouldn't burst hundreds of concurrent NATS round trips in one call. That batching
 * trades an unbounded burst for a worst case of `ceil(N / LOOKUP_BATCH_CONCURRENCY)` sequential
 * timeouts if the responder is down, which for a large N is minutes, not seconds — so the whole
 * call is also capped at `NATS_CONFIG.LOOKUP_BATCH_BUDGET_MS` wall-clock: once exceeded, no further
 * batches are issued and whatever resolved so far is returned. A partial map still degrades
 * correctly through the same "did this uid resolve" contract above — the caller doesn't need to
 * know the batch was cut short. See `v1-mapping-batch.helper.ts` for the shared implementation.
 */
export async function resolveCommitteeV2UidsToV1Ids(req: Request, natsService: NatsService, v2CommitteeUids: string[]): Promise<Map<string, string>> {
  const { resolved } = await resolveCommitteeV2UidMappings(req, natsService, v2CommitteeUids);
  return resolved;
}

/**
 * The same lookup, keeping the `confirmedUnresolved` half of the batch result.
 *
 * `resolveCommitteeV2UidsToV1Ids` above collapses "this committee has no v1 counterpart" and "the
 * lookup didn't answer" into the same absence, which is the right contract for a caller that
 * degrades either way. A caller that *writes* needs them apart: a confirmed absence is permanent, so
 * failing on it would leave the organizer with no way to save at all, while an indeterminate answer
 * is a transient fault a retry can clear — and downgrading on it persists a wrong row that no later
 * request can repair (`UpdateMeetingRegistrantRequest` carries no `committee_uid` by design).
 *
 * See `V1MappingBatchResult` for exactly which outcomes land in which bucket.
 */
export async function resolveCommitteeV2UidMappings(req: Request, natsService: NatsService, v2CommitteeUids: string[]): Promise<V1MappingBatchResult> {
  return resolveV1MappingBatch(req, natsService, v2CommitteeUids, {
    buildLookupKey: (v2Uid) => `committee.uid.${v2Uid}`,
    parseResponse: (responseText) => {
      // Response format: "{project_sfid}:{committee_sfid}" — the committee SFID is the second segment.
      const parts = responseText.split(':');
      return parts.length >= 2 && parts[1] ? parts[1] : null;
    },
    logOperation: 'resolve_committee_v1_mapping',
    entityLabel: 'committee',
  });
}
