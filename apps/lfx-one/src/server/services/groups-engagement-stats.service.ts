// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import { GroupsEngagementStats } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { getEffectiveUsername } from '../utils/auth-helper';
import { logger } from './logger.service';
import { withUserCache } from './valkey.service';

function isGroupsEngagementStats(value: unknown): boolean {
  const v = value as Partial<GroupsEngagementStats>;
  return (
    !!value &&
    typeof value === 'object' &&
    (v.active_members === null || typeof v.active_members === 'number') &&
    (v.meetings_this_month === null || typeof v.meetings_this_month === 'number') &&
    typeof v.computed_at === 'string' &&
    (v.source === 'mock' || v.source === 'live')
  );
}

// Per-process guard: the `live` no-dbt-path branch is the *expected steady state* in every
// deployed environment until LFXV2-1705 ships (weeks/months, not an exceptional blip), so logging
// it at WARN on every cache miss (~1/user/minute at the 60s TTL) would be sustained log noise
// rather than an actionable signal. One WARN per process is enough to be discoverable on-call.
let liveModeWarned = false;

/**
 * Groups dashboard engagement rollup (Active Members, Meetings This Month) for the caller's visible
 * set only — mine semantics, no scope param (LFXV2-1711). Backed by the same dbt engagement model as
 * LFXV2-1705, which isn't readable yet, so both stats are mocked behind `ENGAGEMENT_BACKEND` until
 * that read path exists — a deliberate interim shim (flag-gated in the UI, TODO-marked here) pending
 * LFXV2-1705, not a permanent stand-in for the real upstream contract. Defaults to `live` (null
 * fields, never fabricated numbers) unless `ENGAGEMENT_BACKEND=mock` is explicitly set, and `mock` is
 * additionally hard-blocked when `NODE_ENV=production` — an unconfigured or production environment
 * must fail to "no data," never to invented-looking data.
 */
export class GroupsEngagementStatsService {
  /**
   * Returns the caller's engagement rollup, cached ~60s per user (see `withUserCache`) to absorb
   * repeated dashboard refreshes. Never throws — `live` mode returns null fields pre-dbt-deploy
   * rather than failing the request, matching the graceful-degradation precedent used elsewhere for
   * not-yet-available dbt models (LFXV2-2874).
   */
  public async getEngagementStats(req: Request): Promise<GroupsEngagementStats> {
    const username = getEffectiveUsername(req) ?? '';

    return withUserCache(
      VALKEY_CACHE.GROUPS_ENGAGEMENT_NAMESPACE,
      username,
      VALKEY_CACHE.GROUPS_ENGAGEMENT_TTL_SECONDS,
      () => this.computeEngagementStats(req, username),
      isGroupsEngagementStats
    );
  }

  private async computeEngagementStats(req: Request, username: string): Promise<GroupsEngagementStats> {
    // Mock is opt-in and additionally hard-blocked in production, so a stray `ENGAGEMENT_BACKEND=mock`
    // left in a prod-like environment's config can't silently serve fabricated numbers as real data.
    const backend = process.env['ENGAGEMENT_BACKEND'] === 'mock' && process.env['NODE_ENV'] !== 'production' ? 'mock' : 'live';
    const computedAt = new Date().toISOString();

    if (backend === 'live') {
      // TODO(LFXV2-1711): read from the dbt engagement model (same source as LFXV2-1705) once its
      // read path exists. Until then, always return null fields rather than fabricating live-looking
      // data — the client renders an "Unavailable" degraded state for these two cards. WARN once per
      // process (see `liveModeWarned` above), matching the graceful-degradation intent of the
      // LFXV2-2874 precedent without turning the permanent pre-dbt-deploy steady state into
      // sustained per-request log noise.
      if (!liveModeWarned) {
        liveModeWarned = true;
        logger.warning(req, 'get_groups_engagement_stats', 'Engagement dbt model has no read path yet — returning null fields');
      }
      return { active_members: null, meetings_this_month: null, computed_at: computedAt, source: 'live' };
    }

    // WARN, not DEBUG, on every call: unlike the live branch above, mock should essentially never
    // run in a real deployment, so each occurrence is worth surfacing — an on-call engineer needs
    // this the moment someone reports the dashboard numbers look wrong.
    logger.warning(req, 'get_groups_engagement_stats', 'ENGAGEMENT_BACKEND=mock — serving fixture engagement stats, not real data');
    return { ...deterministicMockStats(username), computed_at: computedAt, source: 'mock' };
  }
}

/**
 * Deterministic fixture keyed off the caller's identity — same user always sees the same numbers
 * across requests/instances (no randomness), so the mock behaves predictably in manual testing and
 * screenshots without needing a backing store.
 */
function deterministicMockStats(username: string): Pick<GroupsEngagementStats, 'active_members' | 'meetings_this_month'> {
  const hash = hashString(username || 'anonymous');
  return {
    active_members: 1 + (hash % 50),
    meetings_this_month: hash % 8,
  };
}

/** Simple, stable string hash (djb2 variant) — not cryptographic, only needs to be deterministic. */
function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return Math.abs(hash);
}
