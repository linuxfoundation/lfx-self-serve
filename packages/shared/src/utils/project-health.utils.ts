// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FoundationHealthScoreDistributionResponse } from '../interfaces';

export type HealthScoreDistribution = Pick<FoundationHealthScoreDistributionResponse, 'excellent' | 'healthy' | 'stable' | 'unsteady' | 'critical'>;

export function computeScoredCount(d: HealthScoreDistribution): number {
  return d.excellent + d.healthy + d.stable + d.unsteady + d.critical;
}

export function computeHealthyOrBetterCount(d: Pick<HealthScoreDistribution, 'excellent' | 'healthy'>): number {
  return d.excellent + d.healthy;
}

export function computeHealthyOrBetterPct(d: HealthScoreDistribution): number {
  const scored = computeScoredCount(d);
  return scored > 0 ? Math.round((computeHealthyOrBetterCount(d) / scored) * 100) : 0;
}
