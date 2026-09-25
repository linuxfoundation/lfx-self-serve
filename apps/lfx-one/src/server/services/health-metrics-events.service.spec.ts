// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_EVENTS_RANGES } from '@lfx-one/shared/constants';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: vi.fn(() => ({ execute: vi.fn() })) } }));

import { isSupportedEventsRange } from './health-metrics-events.service';

describe('isSupportedEventsRange', () => {
  it('accepts the four periods the views carry and rejects the fourth completed year', () => {
    expect(HEALTH_METRICS_EVENTS_RANGES.every(isSupportedEventsRange)).toBe(true);
    expect(isSupportedEventsRange('COMPLETED_YEAR_4')).toBe(false);
    expect(isSupportedEventsRange('toString')).toBe(false);
  });
});
