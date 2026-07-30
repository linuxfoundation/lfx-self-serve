// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * `ENGAGEMENT_BACKEND` gates `GET /api/committees/:uid/engagement` (LFXV2-1705) between the
 * deterministic mock generator and the real (not-yet-finalized) Snowflake read: unset or anything
 * other than `'live'` selects mock; `'live'` selects the real path. That path can't yet produce
 * real data (the live SQL still targets a legacy placeholder shape — see `CommitteeEngagementResponse.data_available`'s
 * doc for the exact `true`/`false` cases this yields today), so it degrades to
 * `data_available: false` whenever the model isn't deployed or readable in that shape. Defaulting
 * to mock (not live) means local/dev work and integration validation see varied fixtures without
 * any env setup, while an explicit opt-in is required to exercise the real path.
 */
export function isEngagementMockBackend(): boolean {
  return process.env['ENGAGEMENT_BACKEND'] !== 'live';
}
