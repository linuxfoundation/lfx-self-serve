// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FoundationHealthScore, FoundationHealthScoreDistributionResponse, HealthScore, HealthStatusFilterValue } from '../interfaces';

/**
 * Maps v1 health score band names to v2 equivalents.
 * Handles legacy band names from data sources that may still emit v1 terminology
 * while display code has transitioned to v2.
 *
 * v1 → v2 mapping:
 * - 'stable' → 'fair'
 * - 'unsteady' → 'concerning'
 * - All others ('excellent', 'healthy', 'fair', 'concerning', 'critical', 'unavailable') pass through unchanged
 * - null/undefined pass through unchanged
 */
export function mapV1BandToV2(band: string | FoundationHealthScore | HealthScore | null | undefined): FoundationHealthScore | HealthScore | null | undefined {
  if (band === null || band === undefined) {
    return band;
  }
  if (band === 'stable') {
    return 'fair';
  }
  if (band === 'unsteady') {
    return 'concerning';
  }
  return band as FoundationHealthScore | HealthScore;
}

/**
 * Maps v1 band names in a FoundationHealthScoreDistributionResponse.
 * Converts keys from v1 band names (stable/unsteady) to v2 (fair/concerning).
 * Returns an object with v2 band names as keys for display use.
 */
export function mapV1DistributionToV2(
  distribution: FoundationHealthScoreDistributionResponse | Record<string, number>
): Record<HealthStatusFilterValue, number> {
  const mapped: Record<HealthStatusFilterValue, number> = {
    excellent: 0,
    healthy: 0,
    fair: 0,
    concerning: 0,
    critical: 0,
    unscored: 0,
  };

  for (const [key, value] of Object.entries(distribution)) {
    const mappedKey = mapV1BandToV2(key);
    // Type guard: only include keys that match HealthStatusFilterValue
    // (excludes 'unavailable' which can be returned by mapV1BandToV2 but isn't in the result set)
    const validKeys: readonly HealthStatusFilterValue[] = ['excellent', 'healthy', 'fair', 'concerning', 'critical', 'unscored'];
    if (mappedKey && validKeys.includes(mappedKey as HealthStatusFilterValue)) {
      mapped[mappedKey as HealthStatusFilterValue] = (mapped[mappedKey as HealthStatusFilterValue] || 0) + value;
    }
  }

  return mapped;
}
