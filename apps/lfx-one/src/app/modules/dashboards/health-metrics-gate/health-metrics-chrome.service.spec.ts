// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BreakpointObserver } from '@angular/cdk/layout';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavbarCollapseService } from '@services/navbar-collapse.service';
import { UserService } from '@services/user.service';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from './health-metrics-chrome.service';

describe('HealthMetricsChromeService', () => {
  const impersonating = signal(false);
  const railAtAnyWidth = signal(false);

  afterEach(() => {
    vi.useRealTimers();
    impersonating.set(false);
    railAtAnyWidth.set(false);
  });

  function create(belowLg = false): HealthMetricsChromeService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating } },
        { provide: NavbarCollapseService, useValue: { railAtAnyWidth } },
        { provide: BreakpointObserver, useValue: { observe: () => of({ matches: belowLg, breakpoints: {} }) } },
      ],
    });
    const service = TestBed.inject(HealthMetricsChromeService);
    // Flushes the viewport signal's `afterNextRender`, which is when it starts following the media query.
    TestBed.tick();
    return service;
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

    expect(service.headerHeightPx()).toBe(136);
    expect(service.stickyTopPx()).toBe(152);

    service.headerHeightPx.set(120);
    expect(service.stickyTopPx()).toBe(136);
  });

  // The header shifts down by the fixed impersonation banner while impersonating; anything
  // pinning below it must add the same amount.
  it('adds the impersonation banner height to the sticky offset while impersonating', () => {
    const service = create();
    service.headerHeightPx.set(120);

    impersonating.set(true);

    expect(service.headerTopPx()).toBe(36);
    expect(service.stickyTopPx()).toBe(172);
  });

  // Below `lg` a touch device gets the layout's sticky top bar, which the header and everything under it pin below.
  it('pins under the mobile top bar below lg on a touch device, but not where the navbar rail stays', () => {
    const service = create(true);
    service.headerHeightPx.set(120);

    expect(service.headerTopPx()).toBe(57);
    expect(service.stickyTopPx()).toBe(193);

    impersonating.set(true);
    expect(service.headerTopPx()).toBe(93);

    railAtAnyWidth.set(true);
    expect(service.headerTopPx()).toBe(36);
  });

  it('pins at the top from lg up', () => {
    const service = create(false);

    expect(service.headerTopPx()).toBe(0);
  });

  it('selects the range off the clicked period, so every tab reads the same one', () => {
    const service = create();

    service.setPeriod(service.periods[2]);

    expect(service.selectedRange()).toBe(service.periods[2].range);
  });
});
