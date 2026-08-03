// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import type { Request } from 'express';

import { logger } from '../services/logger.service';
import type { NatsService } from '../services/nats.service';

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
 * meetings/registrants path (extracted here so committee-engagement/groups-engagement-stats don't
 * fork a second copy of this exact lookup).
 *
 * Returns a `Map<v2Uid, v1Sfid>` containing only entries that resolved — a v2 uid with no mapping
 * (not yet migrated, or a NATS/parse failure) is simply absent from the map rather than a thrown
 * error, so a caller can treat "did this uid resolve" as a map-membership check and degrade
 * whatever it was about to do with an unresolved uid, rather than fail the whole request.
 *
 * Batched at `NATS_CONFIG.LOOKUP_BATCH_CONCURRENCY` in-flight requests at a time rather than firing
 * one per uid unconditionally — a caller resolving a large N (e.g. LF staff visible on hundreds of
 * committees) shouldn't burst hundreds of concurrent NATS round trips in one call.
 */
export async function resolveCommitteeV2UidsToV1Ids(req: Request, natsService: NatsService, v2CommitteeUids: string[]): Promise<Map<string, string>> {
  const codec = natsService.getCodec();
  const v2ToV1Map = new Map<string, string>();

  const resolveOne = async (v2Uid: string): Promise<{ v2Uid: string; v1Sfid: string } | null> => {
    try {
      const lookupKey = `committee.uid.${v2Uid}`;
      const response = await natsService.request(NatsSubjects.LOOKUP_V1_MAPPING, codec.encode(lookupKey), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const responseText = codec.decode(response.data);

      // Response format: "{project_sfid}:{committee_sfid}" or empty/error.
      if (!responseText || responseText.startsWith('error:')) {
        logger.warning(req, 'resolve_committee_v1_mapping', 'NATS lookup returned no mapping', {
          v2_uid: v2Uid,
          response: responseText || '(empty)',
        });
        return null;
      }

      // Extract the committee SFID (second segment after the colon).
      const parts = responseText.split(':');
      if (parts.length < 2 || !parts[1]) {
        logger.warning(req, 'resolve_committee_v1_mapping', 'Unexpected NATS response format', {
          v2_uid: v2Uid,
          response: responseText,
        });
        return null;
      }

      return { v2Uid, v1Sfid: parts[1] };
    } catch (error) {
      logger.warning(req, 'resolve_committee_v1_mapping', 'Failed to resolve v2->v1 committee mapping', {
        v2_uid: v2Uid,
        err: error,
      });
      return null;
    }
  };

  for (let i = 0; i < v2CommitteeUids.length; i += NATS_CONFIG.LOOKUP_BATCH_CONCURRENCY) {
    const batch = v2CommitteeUids.slice(i, i + NATS_CONFIG.LOOKUP_BATCH_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(resolveOne));
    for (const result of batchResults) {
      if (result) v2ToV1Map.set(result.v2Uid, result.v1Sfid);
    }
  }

  return v2ToV1Map;
}
