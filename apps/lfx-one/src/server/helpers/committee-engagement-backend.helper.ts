// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * `ENGAGEMENT_BACKEND` gates `GET /api/committees/:uid/engagement` (LFXV2-1705) between the
 * deterministic mock generator and the real (not-yet-deployed) Snowflake read: unset or anything
 * other than `'live'` selects mock; `'live'` selects the real path, which degrades to
 * `data_available: false` until the dbt model ships. Defaulting to mock (not live) means local/dev
 * work and integration validation see varied fixtures without any env setup, while an explicit
 * opt-in is required to exercise the real (currently always-degrading) path.
 */
export function isEngagementMockBackend(): boolean {
  return process.env['ENGAGEMENT_BACKEND'] !== 'live';
}
