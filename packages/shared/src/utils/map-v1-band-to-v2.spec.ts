// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { mapV1BandToV2, mapV1DistributionToV2 } from './map-v1-band-to-v2';

describe('mapV1BandToV2', () => {
  it.each([
    ['stable', 'fair'],
    ['unsteady', 'concerning'],
  ] as const)('maps legacy v1 band %s to v2 band %s', (v1, v2) => {
    expect(mapV1BandToV2(v1)).toBe(v2);
  });

  it.each(['excellent', 'healthy', 'fair', 'concerning', 'critical', 'unavailable'] as const)('passes already-v2 band %s through unchanged', (band) => {
    expect(mapV1BandToV2(band)).toBe(band);
  });
});

describe('mapV1DistributionToV2', () => {
  it('maps v1 keys to v2 keys while preserving values', () => {
    expect(mapV1DistributionToV2({ excellent: 1, stable: 2, unsteady: 3, critical: 4 })).toEqual({
      excellent: 1,
      fair: 2,
      concerning: 3,
      critical: 4,
    });
  });

  it('passes an already-v2 distribution through unchanged', () => {
    const distribution = { excellent: 1, healthy: 2, fair: 3, concerning: 4, critical: 5 };
    expect(mapV1DistributionToV2(distribution)).toEqual(distribution);
  });
});
