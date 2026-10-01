// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

vi.mock('./snowflake.service', () => ({
  SnowflakeService: class {
    public static getInstance() {
      return { execute: vi.fn() };
    }
  },
}));
// `validation.helper` reaches the `@lfx-one/shared/utils` barrel, which cannot load in this server-only runtime.
vi.mock('@lfx-one/shared/utils', () => ({}));

import { HEALTH_METRICS_L2_RANGES } from '@lfx-one/shared/constants';

import { isSupportedNonMembersRange } from './health-metrics-non-members.service';

describe('isSupportedNonMembersRange', () => {
  it('accepts the periods the views carry and rejects anything else', () => {
    expect(HEALTH_METRICS_L2_RANGES.every(isSupportedNonMembersRange)).toBe(true);
    expect(isSupportedNonMembersRange('COMPLETED_YEAR_4')).toBe(false);
    expect(isSupportedNonMembersRange('toString')).toBe(false);
  });
});
