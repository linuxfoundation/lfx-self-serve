// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgClass } from '@angular/common';
import { FeatureFlagService } from '@services/feature-flag.service';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from './health-metrics-chrome.service';
import { HealthMetricsGateComponent } from './health-metrics-gate.component';

// Stand-in for the real legacy page, matched by selector — keeps this spec from dragging in that
// page's full dependency tree; only the @if branching and the tab shell matter here.
@Component({ selector: 'lfx-health-metrics', template: '<div data-testid="legacy-stub"></div>' })
class LegacyStubComponent {}

describe('HealthMetricsGateComponent', () => {
  let fixture: ComponentFixture<HealthMetricsGateComponent>;

  async function render(overviewEnabled: WritableSignal<boolean>): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [HealthMetricsGateComponent],
      providers: [provideRouter([]), { provide: FeatureFlagService, useValue: { getBooleanFlag: () => overviewEnabled } }],
    })
      .overrideComponent(HealthMetricsGateComponent, {
        set: { imports: [NgClass, RouterLink, RouterLinkActive, RouterOutlet, LegacyStubComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(HealthMetricsGateComponent);
    fixture.detectChanges();
    // Flushes the component's `afterNextRender` hydration latch — before it fires, `overviewEnabled`
    // is forced false regardless of the flag signal, matching the SSR-safe behavior under test.
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the legacy page, and no tab shell at all, when the flag is off', async () => {
    await render(signal(false));

    expect(fixture.nativeElement.querySelector('[data-testid="legacy-stub"]')).not.toBeNull();
    // No outlet while the flag is off is what keeps a direct hit on `…/engagement` on the legacy page.
    expect(fixture.nativeElement.querySelector('router-outlet')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tabs"]')).toBeNull();
  });

  it('renders the tab shell and an outlet when the flag is on', async () => {
    await render(signal(true));

    expect(fixture.nativeElement.querySelector('[data-testid="legacy-stub"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tabs"]')).not.toBeNull();
  });

  it('swaps pages reactively when the flag signal changes after render', async () => {
    const overviewEnabled = signal(false);
    await render(overviewEnabled);

    overviewEnabled.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tabs"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="legacy-stub"]')).toBeNull();
  });

  it('renders every tab, linking only the three whose Level 2 page exists', async () => {
    await render(signal(true));

    const labels = Array.from<Element>(fixture.nativeElement.querySelectorAll('[data-testid^="health-metrics-tab-"]')).map((el) => el.textContent?.trim());
    expect(labels).toEqual(['Overview', 'Engagement', 'Events', 'Members', 'Non-Members', 'Training']);

    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tab-overview"]').getAttribute('href')).toBe('/foundation/health-metrics');
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tab-engagement"]').getAttribute('href')).toBe(
      '/foundation/health-metrics/engagement'
    );
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tab-events"]').getAttribute('href')).toBe('/foundation/health-metrics/events');
    // The three unbuilt tabs hold their place rather than being omitted, so the bar doesn't reshuffle.
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tab-members"]').getAttribute('href')).toBeNull();
  });

  it('measures the sticky header via ResizeObserver and publishes it as the shared sticky offset', async () => {
    let observedCallback: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public constructor(callback: ResizeObserverCallback) {
          observedCallback = callback;
        }
        public observe(): void {
          /* no-op — the fake reports height only via the manually-invoked callback below */
        }
        public disconnect(): void {
          /* no-op */
        }
      }
    );

    await render(signal(true));

    expect(observedCallback).toBeDefined();
    observedCallback?.([{ borderBoxSize: [{ blockSize: 120 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver);

    const chrome = fixture.debugElement.injector.get(HealthMetricsChromeService);
    expect(chrome.headerHeightPx()).toBe(120);
    expect(chrome.stickyTopPx()).toBe(136);
  });

  it('never observes the header while the flag is off, since the header is not rendered', async () => {
    let constructed = 0;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public constructor() {
          constructed += 1;
        }
        public observe(): void {
          /* no-op */
        }
        public disconnect(): void {
          /* no-op */
        }
      }
    );

    await render(signal(false));

    expect(constructed).toBe(0);
  });
});
