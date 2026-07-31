// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Freshness label for `CommitteeEngagementResponse.computed_at` (LFXV2-1705). `computed_at` is
 * always `null` today — the real dbt model doesn't expose a freshness column yet (a separate
 * pipeline-freshness follow-up covering Fivetran sync + dbt build timestamps) — so this always
 * returns the daily-refresh fallback in practice. The non-null branch exists so a future caller
 * doesn't need a second helper once the model does expose a real timestamp.
 */
export function formatCommitteeEngagementFreshness(computedAt: string | null): string {
  if (!computedAt) return 'Updated daily';
  const parsed = new Date(computedAt);
  if (Number.isNaN(parsed.getTime())) return 'Updated daily';
  return `Updated ${parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}
