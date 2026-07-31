// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * `ENGAGEMENT_BACKEND` gates `GET /api/committees/:uid/engagement` (LFXV2-1705) between the
 * deterministic mock generator and the real (not-yet-finalized) Snowflake read. Defaults to
 * `live` — mock is explicit opt-in (`ENGAGEMENT_BACKEND=mock`) and additionally hard-blocked
 * whenever `NODE_ENV=production`, so an unconfigured or production environment fails to
 * `data_available:false` ("no data yet"), never to fabricated-looking data attached to real,
 * named committee members. Matches the equivalent gate on the sibling LFXV2-1711 branch
 * (`groups-engagement-stats.service.ts`). See `CommitteeEngagementResponse.data_available`'s
 * doc for exactly which cases the live path yields `true`/`false` today.
 */
export function isEngagementMockBackend(): boolean {
  return process.env['ENGAGEMENT_BACKEND'] === 'mock' && process.env['NODE_ENV'] !== 'production';
}
