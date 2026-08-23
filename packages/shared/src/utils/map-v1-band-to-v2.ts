// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FoundationHealthScore, FoundationHealthScoreDistributionResponse, HealthScore } from '../interfaces';

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
export function mapV1DistributionToV2(distribution: FoundationHealthScoreDistributionResponse | Record<string, number>): Record<string, number> {
  const mapped: Record<string, number> = {
    excellent: 0,
    healthy: 0,
    fair: 0,
    concerning: 0,
    critical: 0,
    unscored: 0,
  };

  for (const [key, value] of Object.entries(distribution)) {
    const mappedKey = mapV1BandToV2(key) as string;
    if (mappedKey in mapped) {
      mapped[mappedKey] = (mapped[mappedKey] || 0) + value;
    }
  }

  return mapped;
}
