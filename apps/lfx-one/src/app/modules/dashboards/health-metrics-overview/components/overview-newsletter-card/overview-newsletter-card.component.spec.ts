// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { OverviewNewsletterCardComponent } from './overview-newsletter-card.component';

import type { HealthMetricsOverviewNewsletterPeriod, HealthMetricsOverviewNewsletters } from '@lfx-one/shared/interfaces';

/** Stands in for the browser's observer, so a spec can set an observed element's width. */
class FakeResizeObserver {
  public static instances: FakeResizeObserver[] = [];
  public readonly targets: Element[] = [];
  public constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  public observe(target: Element): void {
    this.targets.push(target);
  }
  public disconnect(): void {
    /* no-op */
  }
  public resize(width: number): void {
    this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

const YEAR = new Date().getFullYear();
const PERIOD: HealthMetricsOverviewNewsletterPeriod = {
  subscribers: 1458,
  subscribersGrowth: 0.39,
  growthBaselineDate: `${YEAR}-01-05`,
  newslettersSent: 10,
  avgOpenRate: 0.43,
  avgClickToOpenRate: 0.09,
  highEngagement: 175,
  mediumEngagement: 496,
  lowEngagement: 787,
  highEngagementShare: 0.12,
  mediumEngagementShare: 0.34,
  lowEngagementShare: 0.54,
  newslettersConsidered: 10,
  mostEngagingName: 'Monthly: Protocol ships',
  mostEngagingClickToOpenRate: 0.12,
};
const NEWSLETTERS: HealthMetricsOverviewNewsletters = {
  measured: true,
  periods: { YTD: PERIOD, COMPLETED_YEAR: PERIOD, COMPLETED_YEAR_2: null, COMPLETED_YEAR_3: null },
  newsletters: [
    { key: 'n2', name: 'Monthly: Protocol ships', sentDate: `${YEAR}-09-21`, openRate: 0.5, clickRate: 0.06 },
    { key: 'n1', name: 'Monthly: Hello', sentDate: `${YEAR}-08-24`, openRate: 0.37, clickRate: 0.0185 },
  ],
};

describe('OverviewNewsletterCardComponent', () => {
  let fixture: ComponentFixture<OverviewNewsletterCardComponent>;

  async function render(payload: HealthMetricsOverviewNewsletters = NEWSLETTERS): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [OverviewNewsletterCardComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getOverviewNewsletters: vi.fn().mockReturnValue(of(payload)) } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }) } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OverviewNewsletterCardComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function text(testId: string): string {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('shows the KPIs, a point per newsletter and the subscriber engagement split', async () => {
    await render();

    expect(text('overview-newsletter-kpis-subscribers-value')).toBe('1,458');
    expect(text('overview-newsletter-kpis-cto-value')).toBe('9%');
    expect(query('overview-newsletter-chart')).not.toBeNull();
    expect(text('overview-newsletter-kpis-subscribers-delta-suffix')).toBe('since Jan');
    // Each newsletter's column takes focus and names its rates; the latest one's points are larger.
    const column = query('overview-newsletter-column-n1');
    expect(column?.getAttribute('tabindex')).toBe('0');
    expect(column?.getAttribute('aria-label')).toBe(`Monthly: Hello, Aug 24, ${YEAR}: open rate 37%, click rate 2%`);
    expect(query('overview-newsletter-open-n1')?.className).toContain('h-[8px]');
    expect(query('overview-newsletter-open-n2')?.className).toContain('h-[10px]');
    expect([...(query('overview-newsletter-labels')?.children ?? [])].map((label) => label.textContent?.trim())).toEqual(['Aug', 'Sep']);
    expect(query('overview-newsletter-engagement-basis')?.className).toContain('text-gray-400');
    const high = [...(query('overview-newsletter-engagement-high')?.children ?? [])].map((cell) => cell.textContent?.trim());
    expect(high).toEqual(['HighOpened 7+ newsletters and clicked a link', '175', '12%']);
    const mostEngaging = [...(query('overview-newsletter-most-engaging')?.children ?? [])].map((cell) => cell.textContent?.trim());
    expect(mostEngaging).toEqual(['Most engaging newsletter · 12% click-to-open', 'Monthly: Protocol ships']);
    const explore = query('overview-newsletter-explore') as HTMLAnchorElement;
    expect(explore.textContent?.trim()).toBe('Explore Newsletters');
    expect(explore.getAttribute('href')).toBe('/foundation/health-metrics/engagement#newsletters');
  });

  it('shows a newsletter’s popover on focus or hover, and hides it on blur, leave or Escape', async () => {
    await render();
    const column = query('overview-newsletter-column-n1') as HTMLElement;

    column.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(text('health-metrics-chart-tip-title')).toBe(`Monthly: Hello · Aug 24, ${YEAR}`);
    expect(
      [...fixture.nativeElement.querySelectorAll('[data-testid="health-metrics-chart-tip-row"]')].map((row: Element) =>
        row.textContent?.replace(/\s+/g, ' ').trim()
      )
    ).toEqual(['Open rate: 37%', 'Click rate: 2%']);
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-chart-tip-row"] strong')?.className).toContain('font-semibold');
    expect(column.className).toContain('z-20');

    column.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(query('overview-newsletter-tip-n1')).toBeNull();

    column.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();
    expect(query('overview-newsletter-tip-n1')).not.toBeNull();
    column.dispatchEvent(new Event('mouseleave'));
    fixture.detectChanges();
    expect(query('overview-newsletter-tip-n1')).toBeNull();
  });

  // Hovering doesn't move focus, so Escape reaches the page rather than the column.
  it('closes a mouse-opened popover on Escape pressed anywhere', async () => {
    await render();

    query('overview-newsletter-column-n1')?.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(query('overview-newsletter-tip-n1')).toBeNull();
  });

  it('opens the popover beside the points on whichever side has room, and shifts it onto a screen with room on neither', async () => {
    await render();
    // n1 is the first newsletter, so its column is cut off at the plot's left edge with its points at 0%.
    const column = query('overview-newsletter-column-n1') as HTMLElement;
    const open = (viewport: number, point: number): HTMLElement => {
      Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: viewport });
      column.getBoundingClientRect = () => ({ left: point, width: 40 }) as DOMRect;
      column.dispatchEvent(new Event('mouseenter'));
      fixture.detectChanges();
      return query('overview-newsletter-tip-n1') as HTMLElement;
    };

    try {
      expect(open(1200, 300).style.left).toBe('calc(0% + 12px)');
      expect(open(1200, 1000).style.right).toBe('calc(100% + 12px)');
      // 375px wide with the points at 187px: the popover's left edge lands at 375 − 8 − 280 = 87px.
      const shifted = open(375, 187);
      expect(shifted.style.left).toBe('calc(0% - 100px)');
      expect(shifted.style.right).toBe('');
    } finally {
      Reflect.deleteProperty(document.documentElement, 'clientWidth');
    }
  });

  it('cuts the end columns off at the plot, keeping the hairline and points on the newsletter', async () => {
    await render();

    expect(query('overview-newsletter-column-n1')?.style.left).toBe('0%');
    expect(query('overview-newsletter-column-n1')?.style.width).toBe('25%');
    expect(query('overview-newsletter-hairline-n1')?.style.left).toBe('0%');
    expect(query('overview-newsletter-open-n2')?.style.left).toBe('100%');
  });

  // Hover and focus are separate triggers, so the popover stays until both have gone (WCAG 1.4.13).
  it('keeps a focused column’s popover through a hover that comes and goes, and the reverse', async () => {
    await render();
    const column = query('overview-newsletter-column-n1') as HTMLElement;
    const fire = (type: string) => {
      column.dispatchEvent(new Event(type));
      fixture.detectChanges();
    };

    fire('focus');
    fire('mouseenter');
    fire('mouseleave');
    expect(query('overview-newsletter-tip-n1')).not.toBeNull();
    fire('blur');
    expect(query('overview-newsletter-tip-n1')).toBeNull();

    fire('mouseenter');
    fire('focus');
    fire('blur');
    expect(query('overview-newsletter-tip-n1')).not.toBeNull();
    fire('mouseleave');
    expect(query('overview-newsletter-tip-n1')).toBeNull();
  });

  it('draws no click point and a dash in the popover for a newsletter without a click rate', async () => {
    await render({ ...NEWSLETTERS, newsletters: [{ ...NEWSLETTERS.newsletters[1], clickRate: null }] });

    expect(query('overview-newsletter-click-n1')).toBeNull();
    query('overview-newsletter-column-n1')?.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(text('overview-newsletter-tip-n1')).toContain('Click rate: —');
  });

  it('says so in place of the chart when no newsletter in the period carries engagement data', async () => {
    await render({ ...NEWSLETTERS, newsletters: [] });

    expect(query('overview-newsletter-chart')).toBeNull();
    expect(query('overview-newsletter-chart-empty')).not.toBeNull();
  });

  it('offers to create a newsletter, for the foundation, when nothing has gone out this year', async () => {
    await render({ ...NEWSLETTERS, periods: { ...NEWSLETTERS.periods, YTD: { ...PERIOD, newslettersSent: 0 } } });

    expect(text('overview-newsletter-empty-title')).toBe('No newsletters sent');
    const create = query('overview-newsletter-empty-create') as HTMLAnchorElement;
    expect(create.textContent?.trim()).toBe('Create Newsletter');
    expect(create.getAttribute('href')).toBe('/foundation/newsletters/create?project=acme');
  });

  it('words a past year’s empty state for that year, with no offer to create one', async () => {
    await render();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR_2');
    fixture.detectChanges();

    expect(text('overview-newsletter-empty-title')).toBe(`No newsletters in ${YEAR - 2}`);
    expect(query('overview-newsletter-empty-create')).toBeNull();
  });

  describe('labels', () => {
    const SENDS: HealthMetricsOverviewNewsletters = {
      ...NEWSLETTERS,
      newsletters: [
        { key: 'n3', name: 'Monthly: Ships', sentDate: `${YEAR}-09-21`, openRate: 0.5, clickRate: 0.06 },
        { key: 'n2', name: 'Monthly: Late August', sentDate: `${YEAR}-08-24`, openRate: 0.4, clickRate: 0.02 },
        { key: 'n1', name: 'Monthly: Hello', sentDate: `${YEAR}-08-03`, openRate: 0.37, clickRate: 0.0185 },
      ],
    };
    const labels = (): string[] => [...(query('overview-newsletter-labels')?.children ?? [])].map((label) => label.textContent?.trim() ?? '');
    // The KPI strip observes its own width too, so the plot's observer is picked out by what it watches.
    const resize = (width: number): void => {
      const plot = query('overview-newsletter-plot');
      FakeResizeObserver.instances.find((observer) => plot && observer.targets.includes(plot))?.resize(width);
      fixture.detectChanges();
    };

    afterEach(() => {
      vi.unstubAllGlobals();
      FakeResizeObserver.instances = [];
    });

    it('keeps to the month labels until the plot is measured, then labels every newsletter that has room', async () => {
      vi.stubGlobal('ResizeObserver', FakeResizeObserver);
      await render(SENDS);
      expect(labels()).toEqual(['Aug', 'Sep']);

      // Three points over 600px are 300px apart.
      resize(600);
      expect(labels()).toEqual(['Aug', 'Aug', 'Sep']);
    });

    it('falls back to the first of each month when the points crowd, skipping one that would land on the last', async () => {
      vi.stubGlobal('ResizeObserver', FakeResizeObserver);
      await render(SENDS);

      // 40px wide: points 20px apart, so month labels, with August's at 0px and September's 40px on.
      resize(40);
      expect(labels()).toEqual(['Aug', 'Sep']);

      // 20px wide: September's label would sit 20px from August's, so it goes.
      resize(20);
      expect(labels()).toEqual(['Aug']);
    });
  });
});
