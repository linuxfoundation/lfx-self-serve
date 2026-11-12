// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AppService } from '@services/app.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { UserService } from '@services/user.service';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiSwitchOptionComponent } from '@shared/uikit/switch/switch-option.component';
import { UiSwitchComponent } from '@shared/uikit/switch/switch.component';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from './health-metrics-chrome.service';
import { HealthMetricsGateComponent } from './health-metrics-gate.component';

// Stand-in for the real legacy page, matched by selector — keeps this spec from dragging in that
// page's full dependency tree; only the @if branching and the tab shell matter here.
@Component({ selector: 'lfx-health-metrics', template: '<div data-testid="legacy-stub"></div>' })
class LegacyStubComponent {}

@Component({ selector: 'lfx-route-stub', template: '' })
class RouteStubComponent {}

// Stand-in for the app footer, which pulls in the consent manager.
@Component({ selector: 'lfx-app-footer', template: '' })
class FooterStubComponent {}

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
        set: {
          imports: [
            RouterLink,
            RouterLinkActive,
            RouterOutlet,
            FooterStubComponent,
            LegacyStubComponent,
            UiOptionComponent,
            UiSelectComponent,
            UiSwitchComponent,
            UiSwitchOptionComponent,
          ],
        },
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

  function periodSwitch(): UiSwitchComponent {
    return fixture.debugElement.query((el) => el.attributes['data-testid'] === 'health-metrics-period-switch').componentInstance as UiSwitchComponent;
  }

  function select(testId: string): UiSelectComponent {
    return fixture.debugElement.query((el) => el.attributes['data-testid'] === testId).componentInstance as UiSelectComponent;
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
    for (const cls of ['text-[12px]', 'text-gray-500']) expect(query('health-metrics-subtitle')?.classList).toContain(cls);
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

  // The design's `.hm-head` sticks at every width, bled to the page edges, with the fade under it and no rule.
  it('pins the header at every width, bled 40px (20px on phones), with the fade below it', async () => {
    await render(signal(true));

    const header = query('health-metrics-sticky-header') as HTMLElement;
    for (const cls of ['sticky', 'bg-gray-50', '-mx-[40px]', 'px-[40px]', 'max-[640px]:-mx-[20px]', 'max-[640px]:px-[20px]'])
      expect(header.classList).toContain(cls);
    expect(header.className).not.toMatch(/lg:sticky|border-b/);
    expect(header.style.top).toBe('0px');
    expect(query('health-metrics-header-fade')?.className).not.toMatch(/hidden|lg:block/);
  });

  it('pins the header below the fixed impersonation banner while impersonating', async () => {
    impersonating.set(true);
    await render(signal(true));

    expect(query('health-metrics-sticky-header')?.style.top).toBe('36px');
  });

  it('pads the page column 40px, and 20px on phones', async () => {
    await render(signal(true));

    for (const cls of ['max-md:-mx-5', 'max-md:px-[40px]', 'max-[640px]:px-[20px]', 'md:px-[12px]'])
      expect(query('health-metrics-page')?.classList).toContain(cls);
  });

  it('renders the app footer itself while the redesign shows, and hands it back to the layout otherwise', async () => {
    const overviewEnabled = signal(true);
    await render(overviewEnabled);
    const appService = TestBed.inject(AppService);

    expect(appService.pageOwnsFooter()).toBe(true);
    for (const cls of ['px-[32px]', 'max-[640px]:px-[20px]']) expect(query('health-metrics-footer')?.classList).toContain(cls);

    overviewEnabled.set(false);
    await settle();
    expect(appService.pageOwnsFooter()).toBe(false);
    expect(query('health-metrics-footer')).toBeNull();
  });

  describe('period', () => {
    it('offers the four periods as a small switch and as the narrow-width small dropdown, with YTD selected', async () => {
      await render(signal(true));

      const chrome = fixture.debugElement.injector.get(HealthMetricsChromeService);
      const options = Array.from(query('health-metrics-period-switch')?.querySelectorAll('[data-testid^="health-metrics-period-"]') ?? []);
      expect(options.map((option) => option.textContent?.trim())).toEqual(chrome.periods.map((period) => period.label));
      expect(query('health-metrics-period-switch')?.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Period');
      expect(periodSwitch().size()).toBe('small');
      expect(periodSwitch().value()).toBe('YTD');
      expect(select('health-metrics-period-select').size()).toBe('small');
      expect(select('health-metrics-period-select').ariaLabel()).toBe('Period');
      expect(select('health-metrics-period-select').value()).toBe('YTD');
    });

    it('shows the year-to-date span only while YTD is selected', async () => {
      await render(signal(true));
      expect(query('health-metrics-period-range')?.textContent?.trim()).toMatch(/^Jan 1 – [A-Z][a-z]{2} \d{1,2}, \d{4}$/);

      const chrome = fixture.debugElement.injector.get(HealthMetricsChromeService);
      periodSwitch().select(chrome.periods[0].range);
      await settle();

      expect(query('health-metrics-period-range')).toBeNull();
    });

    it('sets the period from either control and keeps the other in step', async () => {
      await render(signal(true));
      const chrome = fixture.debugElement.injector.get(HealthMetricsChromeService);

      select('health-metrics-period-select').value.set(chrome.periods[0].range);
      await settle();
      expect(chrome.selectedRange()).toBe(chrome.periods[0].range);
      expect(periodSwitch().value()).toBe(chrome.periods[0].range);

      periodSwitch().select(chrome.periods[1].range);
      await settle();
      expect(chrome.selectedRange()).toBe(chrome.periods[1].range);
      expect(select('health-metrics-period-select').value()).toBe(chrome.periods[1].range);
    });
  });

  describe('view dropdown', () => {
    it('offers every tab as the narrowest header’s dropdown, on the routed tab', async () => {
      await render(signal(true), '/foundation/health-metrics/events?project=acme');

      const view = select('health-metrics-tabs-select');
      expect(view.ariaLabel()).toBe('Health Metrics view');
      expect(view.size()).toBe('medium');
      expect(view.value()).toBe('events');
      expect(query('health-metrics-tabs-select')?.className).toContain('[&_[role=combobox]]:h-[38px]');
    });

    it('opens the picked tab, keeping the query, and follows later navigations', async () => {
      await render(signal(true), '/foundation/health-metrics?project=acme');

      select('health-metrics-tabs-select').value.set('training');
      await settle();
      expect(currentUrl()).toBe('/foundation/health-metrics/training?project=acme');

      await TestBed.inject(Router).navigateByUrl('/foundation/health-metrics/members?project=acme');
      await settle();
      expect(select('health-metrics-tabs-select').value()).toBe('members');
    });
  });

  it('carries no project selector or export, and leaves the URL alone', async () => {
    await render(signal(true), '/foundation/health-metrics/engagement?project=acme-foundation');

    expect(query('health-metrics-overview-project-selector')).toBeNull();
    expect(query('health-metrics-overview-export')).toBeNull();
    expect(currentUrl()).toBe('/foundation/health-metrics/engagement?project=acme-foundation');
  });
});
