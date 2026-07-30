// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * `ENGAGEMENT_BACKEND` gates `GET /api/committees/:uid/engagement` (LFXV2-1705) between the
 * deterministic mock generator and the real (not-yet-finalized) Snowflake read: unset or anything
 * other than `'live'` selects mock; `'live'` selects the real path — which can't yet produce real
 * data, since the live SQL still targets a legacy placeholder shape; see
 * `CommitteeEngagementResponse.data_available`'s doc for exactly which cases that path yields
 * `true`/`false` today. Defaulting to mock (not live) means local/dev work and integration
 * validation see varied fixtures without any env setup, while an explicit opt-in is required to
 * exercise the real path.
 */
export function isEngagementMockBackend(): boolean {
  return process.env['ENGAGEMENT_BACKEND'] !== 'live';
}
