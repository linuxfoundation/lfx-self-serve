// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_L2_RANGES } from '@lfx-one/shared/constants';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: vi.fn(() => ({ execute: vi.fn() })) } }));

import { isSupportedMembersRange } from './health-metrics-members.service';

describe('isSupportedMembersRange', () => {
  it('accepts the four periods the views carry and rejects the fourth completed year', () => {
    expect(HEALTH_METRICS_L2_RANGES.every(isSupportedMembersRange)).toBe(true);
    expect(isSupportedMembersRange('COMPLETED_YEAR_4')).toBe(false);
    expect(isSupportedMembersRange('toString')).toBe(false);
  });
});
