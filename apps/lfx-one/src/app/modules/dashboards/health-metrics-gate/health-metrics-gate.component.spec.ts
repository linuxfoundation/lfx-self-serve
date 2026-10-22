// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgClass } from '@angular/common';
import { FeatureFlagService } from '@services/feature-flag.service';
import { UserService } from '@services/user.service';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from './health-metrics-chrome.service';
import { HealthMetricsGateComponent } from './health-metrics-gate.component';

// Stand-in for the real legacy page, matched by selector — keeps this spec from dragging in that
// page's full dependency tree; only the @if branching and the tab shell matter here.
@Component({ selector: 'lfx-health-metrics', template: '<div data-testid="legacy-stub"></div>' })
class LegacyStubComponent {}

@Component({ selector: 'lfx-route-stub', template: '' })
class RouteStubComponent {}

describe('HealthMetricsGateComponent', () => {
  let fixture: ComponentFixture<HealthMetricsGateComponent>;
  const impersonating = signal(false);

  async function render(overviewEnabled: WritableSignal<boolean>, url = '/'): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [HealthMetricsGateComponent],
      providers: [
        provideRouter([{ path: '**', component: RouteStubComponent }]),
        provideNoopAnimations(),
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => overviewEnabled } },
        { provide: UserService, useValue: { impersonating } },
      ],
    })
      .overrideComponent(HealthMetricsGateComponent, {
        set: { imports: [NgClass, RouterLink, RouterLinkActive, RouterOutlet, LegacyStubComponent] },
      })
      .compileComponents();

    await TestBed.inject(Router).navigateByUrl(url);
    fixture = TestBed.createComponent(HealthMetricsGateComponent);
    fixture.detectChanges();
    // Flushes the component's `afterNextRender` hydration latch — before it fires, `overviewEnabled`
    // is forced false regardless of the flag signal, matching the SSR-safe behavior under test.
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    impersonating.set(false);
  });

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.ownerDocument.querySelector(`[data-testid="${testId}"]`);
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function currentUrl(): string {
    return TestBed.inject(Router).url;
  }

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

  it('renders every tab, each linking to its Level 2 page', async () => {
    await render(signal(true));

    // The first span is the label; the second is its hidden width-reserving copy.
    const labels = Array.from<Element>(fixture.nativeElement.querySelectorAll('[data-testid^="health-metrics-tab-"]')).map((el) =>
      el.querySelector('span > span')?.textContent?.trim()
    );
    expect(labels).toEqual(['Overview', 'Engagement', 'Events', 'Members', 'Non-Members', 'Training']);

    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tab-overview"]').getAttribute('href')).toBe('/foundation/health-metrics');
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tab-engagement"]').getAttribute('href')).toBe(
      '/foundation/health-metrics/engagement'
    );
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tab-events"]').getAttribute('href')).toBe('/foundation/health-metrics/events');
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tab-members"]').getAttribute('href')).toBe('/foundation/health-metrics/members');
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tab-non-members"]').getAttribute('href')).toBe(
      '/foundation/health-metrics/non-members'
    );
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tab-training"]').getAttribute('href')).toBe('/foundation/health-metrics/training');
  });

  // The design's own title type rather than the shared page header's.
  it('titles the page in light Roboto Slab at 24px over the refresh note', async () => {
    await render(signal(true));

    expect(query('health-metrics-page')?.classList).toContain('max-w-[1384px]');
    for (const cls of ['font-display', 'font-light', 'text-[24px]', 'text-gray-900']) expect(query('health-metrics-title')?.classList).toContain(cls);
    for (const cls of ['text-[13px]', 'text-gray-500']) expect(query('health-metrics-subtitle')?.classList).toContain(cls);
    expect(query('health-metrics-subtitle')?.textContent?.trim()).toBe('Operational health across your foundation. Data updated every 24-48 hours.');
  });

  // The design's `.tab.on`: a dark medium-weight label over a blue underline.
  it('marks the selected tab with a dark label over the accent underline', async () => {
    await render(signal(true), '/foundation/health-metrics');

    const selected = fixture.nativeElement.querySelector('[aria-current="page"]') as HTMLElement;
    expect(selected?.getAttribute('data-testid')).toBe('health-metrics-tab-overview');
    for (const cls of ['!text-gray-900', '!border-blue-500', 'font-medium']) expect(selected.classList).toContain(cls);
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

  it('pins the header below the fixed impersonation banner while impersonating', async () => {
    impersonating.set(true);
    await render(signal(true));

    const header = query('health-metrics-sticky-header');
    expect(header?.className).toContain('lg:top-[36px]');
    expect(header?.className).not.toContain('lg:top-0');
  });

  describe('period', () => {
    it('offers the four periods as a pill and as the narrow-width dropdown, with YTD selected', async () => {
      await render(signal(true));

      const pills = Array.from(query('health-metrics-overview-period-selector')?.querySelectorAll('button') ?? []);
      const chrome = fixture.debugElement.injector.get(HealthMetricsChromeService);
      expect(pills.map((pill) => pill.textContent?.trim())).toEqual(chrome.periods.map((period) => period.label));
      expect(pills).toHaveLength(4);
      expect(pills.find((pill) => pill.getAttribute('aria-pressed') === 'true')?.textContent?.trim()).toBe('YTD');
      expect((query('health-metrics-period-select') as HTMLSelectElement).value).toBe('YTD');
    });

    it('shows the year-to-date span only while YTD is selected', async () => {
      await render(signal(true));
      expect(query('health-metrics-period-range')?.textContent?.trim()).toMatch(/^Jan 1 – [A-Z][a-z]{2} \d{1,2}, \d{4}$/);

      (query('health-metrics-overview-period-selector')?.querySelector('button') as HTMLButtonElement).click();
      await settle();

      expect(query('health-metrics-period-range')).toBeNull();
    });

    it('sets the period from the dropdown', async () => {
      await render(signal(true));
      const select = query('health-metrics-period-select') as HTMLSelectElement;
      const chrome = fixture.debugElement.injector.get(HealthMetricsChromeService);

      select.value = chrome.periods[0].range;
      select.dispatchEvent(new Event('change'));
      await settle();

      expect(chrome.selectedRange()).toBe(chrome.periods[0].range);
    });
  });

  it('carries no project selector or export, and leaves the URL alone', async () => {
    await render(signal(true), '/foundation/health-metrics/engagement?project=acme-foundation');

    expect(query('health-metrics-overview-project-selector')).toBeNull();
    expect(query('health-metrics-overview-export')).toBeNull();
    expect(currentUrl()).toBe('/foundation/health-metrics/engagement?project=acme-foundation');
  });
});
