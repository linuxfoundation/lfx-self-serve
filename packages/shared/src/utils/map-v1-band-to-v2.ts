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
 */
export function mapV1BandToV2(band: string | FoundationHealthScore | HealthScore): FoundationHealthScore | HealthScore {
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
 * Returns the same object shape with updated keys for display use.
 */
export function mapV1DistributionToV2(distribution: FoundationHealthScoreDistributionResponse | Record<string, number>): Record<string, number> {
  const mapped: Record<string, number> = {};

  for (const [key, value] of Object.entries(distribution)) {
    const mappedKey = mapV1BandToV2(key);
    mapped[mappedKey] = value;
  }

  return mapped;
}
