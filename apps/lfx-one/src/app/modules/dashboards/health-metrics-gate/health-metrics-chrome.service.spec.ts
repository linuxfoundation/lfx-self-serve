// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from './health-metrics-chrome.service';

describe('HealthMetricsChromeService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function create(): HealthMetricsChromeService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [HealthMetricsChromeService] });
    return TestBed.inject(HealthMetricsChromeService);
  }

  // Provided by the gate, not `providedIn: 'root'`, so the selection resets on leaving the page.
  it('is not available without a provider, which is what scopes it to one gate instance', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});

    expect(() => TestBed.inject(HealthMetricsChromeService)).toThrow();
  });

  it('starts on YTD and carries the four most recent periods, oldest first', () => {
    const service = create();

    expect(service.selectedRange()).toBe('YTD');
    expect(service.periods).toHaveLength(4);
    expect(service.periods[0]?.range).toBe('COMPLETED_YEAR_3');
    expect(service.periods.at(-1)?.range).toBe('YTD');
  });

  // Built per instance rather than at module level, so a long-running SSR process does not serve
  // last year's labels after the rollover.
  it('derives the period labels at construction, not at module load', () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
    expect(create().periods[2]?.label).toBe('2025');

    vi.setSystemTime(new Date('2027-01-02T00:00:00.000Z'));
    expect(create().periods[2]?.label).toBe('2026');
  });

  it('offsets the sticky top from the measured header height, with a pre-hydration fallback', () => {
    const service = create();

    expect(service.headerHeightPx()).toBe(72);
    expect(service.stickyTopPx()).toBe(88);

    service.headerHeightPx.set(120);
    expect(service.stickyTopPx()).toBe(136);
  });

  it('selects the range off the clicked period, so every tab reads the same one', () => {
    const service = create();

    service.setPeriod(service.periods[2]);

    expect(service.selectedRange()).toBe(service.periods[2].range);
  });
});
