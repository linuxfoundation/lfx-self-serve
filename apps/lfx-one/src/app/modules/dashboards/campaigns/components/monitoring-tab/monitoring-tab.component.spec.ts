// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { KeywordMetricsResponse } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MonitoringTabComponent } from './monitoring-tab.component';

/**
 * The keyword totals strip, and specifically whether it says what it is.
 *
 * Upstream caps the keyword set and reports the cap through `truncated`. When it is set, these
 * totals are a subtotal over the returned rows — so rendering "Spend" flat states a project total
 * LOWER than the truth. That is a wrong number, not an incomplete one, and it is the class of
 * defect where an outage or a cap reads as a measurement.
 *
 * These assertions are about what the component decides to SAY. Layout needs a browser and is not
 * covered here.
 */
describe('MonitoringTabComponent — keyword totals completeness', () => {
  let fixture: ComponentFixture<MonitoringTabComponent>;

  const keywordsResponse = (over: Partial<KeywordMetricsResponse> = {}): KeywordMetricsResponse =>
    ({
      pulledAt: '2026-08-28T00:00:00.000Z',
      days: 30,
      totalKeywords: 2,
      totals: { impressions: 1500, clicks: 40, spend: 30, conversions: 12.5, avgCtr: 2.67 },
      keywords: [
        {
          keyword: 'a',
          matchType: 'EXACT',
          qualityScore: 7,
          status: 'ENABLED',
          adGroup: 'AG',
          adGroupId: '1',
          criterionId: '2',
          campaign: 'C',
          campaignId: '555',
          googleAdsUrl: '',
          impressions: 1000,
          clicks: 40,
          ctr: 4,
          avgCpc: 0.625,
          spend: 25,
          conversions: 12.5,
        },
        {
          keyword: 'b',
          matchType: 'PHRASE',
          qualityScore: null,
          status: 'ENABLED',
          adGroup: 'AG',
          adGroupId: '1',
          criterionId: '3',
          campaign: 'C',
          campaignId: '555',
          googleAdsUrl: '',
          impressions: 500,
          clicks: 0,
          ctr: 0,
          avgCpc: 0,
          spend: 5,
          conversions: 0,
        },
      ],
      ...over,
    }) as KeywordMetricsResponse;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MonitoringTabComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: ProjectContextService, useValue: { activeContext: signal({ slug: 'tlf' }) } },
        {
          provide: CampaignService,
          useValue: {
            // The tab loads on init; stub every read so the component constructs without
            // reaching the network.
            getMonitorData: vi.fn().mockReturnValue(of(null)),
            getKeywords: vi.fn().mockReturnValue(of(null)),
            getAudience: vi.fn().mockReturnValue(of(null)),
            getLinkedInAccounts: vi.fn().mockReturnValue(of([])),
            getRedditAccounts: vi.fn().mockReturnValue(of([])),
            getMetaAccounts: vi.fn().mockReturnValue(of([])),
            getLinkedInMonitor: vi.fn().mockReturnValue(of(null)),
            getRedditMonitor: vi.fn().mockReturnValue(of(null)),
            getMetaMonitor: vi.fn().mockReturnValue(of(null)),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MonitoringTabComponent);
  });

  /**
   * Writes the responses the component would have received, then renders.
   *
   * Monitor data is required as well as keyword data: the keyword section sits inside a
   * `!hasCampaigns()` branch, so without at least one campaign the whole block is replaced by the
   * no-campaigns empty state and every assertion below would pass vacuously against an absent
   * strip. That is precisely what the paired positive assertions catch.
   */
  function render(response: KeywordMetricsResponse | null): void {
    fixture.detectChanges();
    const instance = fixture.componentInstance as unknown as {
      keywordsData: { set(v: KeywordMetricsResponse | null): void };
      monitorData: { set(v: unknown): void };
    };
    instance.monitorData.set({
      pulledAt: '2026-08-28T00:00:00.000Z',
      dateRange: { mode: 'LAST_30_DAYS' },
      campaigns: [
        {
          name: 'C',
          shortName: 'C',
          eventName: 'KubeCon',
          adFormat: 'Search',
          targeting: 'Global',
          status: 'enabled',
          startDate: '2026-08-01',
          endDate: '2026-09-01',
          budgetDay: 100,
          totalBudget: 3000,
          spend: 30,
          impressions: 1500,
          clicks: 40,
          ctr: 2.67,
          avgCpc: 0.75,
          conversions: 12.5,
          pacingPct: 50,
          pacingLabel: 'on-track',
          campaignId: '555',
          googleAdsUrl: '',
        },
      ],
      accountTotals: { impressions: 1500, clicks: 40, spend: 30, conversions: 12.5 },
      actionItems: [],
    });
    instance.keywordsData.set(response);
    fixture.detectChanges();
  }

  function partialCaption(): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-testid="keyword-totals-partial"]');
  }

  /**
   * Account CTR must not render a MEASUREMENT when none was taken.
   *
   * `totalCtr` previously returned 0 for three different facts — no totals arrived, zero
   * impressions, and a genuine zero click-through — and the template rendered all three as
   * `0.0%`. An outage therefore displayed as a real measurement. The LinkedIn, Reddit and Meta
   * panels in this same file already rendered an em dash; Google was the odd one out.
   *
   * The measured-zero case is asserted BECAUSE the obvious fix breaks it: `@if (totalCtr(); as
   * ctr)` treats 0 as falsy, so a real 0% would render as "not measured" — the same conflation
   * inverted. The template tests `!== null` explicitly for that reason.
   */
  function renderTotals(accountTotals: unknown): void {
    fixture.detectChanges();
    const instance = fixture.componentInstance as unknown as { monitorData: { set(v: unknown): void } };
    instance.monitorData.set({
      pulledAt: '2026-08-28T00:00:00.000Z',
      dateRange: { mode: 'LAST_30_DAYS' },
      campaigns: [
        {
          name: 'C',
          shortName: 'C',
          eventName: 'KubeCon',
          adFormat: 'Search',
          targeting: 'Global',
          status: 'enabled',
          startDate: '2026-08-01',
          endDate: '2026-09-01',
          budgetDay: 100,
          totalBudget: 3000,
          spend: 25,
          impressions: 1000,
          clicks: 40,
          ctr: 4,
          avgCpc: 0.625,
          conversions: 12.5,
          pacingPct: 50,
          pacingLabel: 'on-track',
          campaignId: '555',
          googleAdsUrl: '',
        },
      ],
      accountTotals,
      actionItems: [],
    });
    fixture.detectChanges();
  }

  const ctrText = (): string => fixture.nativeElement.querySelector('[data-testid="monitoring-kpi-ctr"]')?.textContent?.trim() ?? '';

  /**
   * With NO totals the whole strip is withheld, not filled with dashes.
   *
   * Writing this test is what found the deeper defect: every cell in the strip read
   * `accountTotals()!` with a non-null assertion, so a null — a failed or not-yet-loaded read —
   * threw inside change detection and took the entire tab down, not just the KPI row. Guarding
   * once at the container also keeps the cells honest: four separate `?? 0` fallbacks would have
   * rendered an outage as four measured zeros.
   */
  it('withholds the whole KPI strip when no totals arrived', () => {
    renderTotals(null);

    expect(fixture.nativeElement.querySelector('[data-testid="monitoring-kpis"]')).toBeNull();
    // Paired positive: the replacement state must be present, so this cannot pass merely
    // because the tab failed to render at all.
    expect(fixture.nativeElement.querySelector('[data-testid="monitoring-kpis-unavailable"]')).not.toBeNull();
  });

  it('renders an em dash for CTR when nothing was served', () => {
    // Zero impressions: clicks/0 is undefined, so 0% would state a rate never measured.
    renderTotals({ impressions: 0, clicks: 0, spend: 0, conversions: 0 });

    expect(ctrText()).toBe('—');
  });

  it('renders a MEASURED zero CTR as a percentage, not an em dash', () => {
    // Impressions served, no clicks. This IS a measurement and must show as one — the case a
    // truthiness check would silently hide.
    renderTotals({ impressions: 1000, clicks: 0, spend: 25, conversions: 0 });

    expect(ctrText()).toContain('%');
    expect(ctrText()).not.toBe('—');
  });

  it('renders a computed CTR', () => {
    renderTotals({ impressions: 1000, clicks: 40, spend: 25, conversions: 12.5 });

    expect(ctrText()).toContain('4');
    expect(ctrText()).toContain('%');
  });

  it('qualifies the totals when the keyword set was capped upstream', () => {
    render(keywordsResponse({ truncated: true }));

    const caption = partialCaption();
    expect(caption).not.toBeNull();
    // The count named must be the rows actually present, so the caption cannot claim a cap size
    // the table does not show.
    expect(caption?.textContent).toContain('top 2');
  });

  it('leaves the totals unqualified when the whole keyword set was returned', () => {
    render(keywordsResponse({ truncated: false }));

    expect(partialCaption()).toBeNull();
    // Paired with a positive assertion: the strip must still be on screen, so a missing caption
    // cannot pass merely because the whole block failed to render.
    expect(fixture.nativeElement.querySelector('[data-testid="keyword-totals"]')).not.toBeNull();
  });

  /**
   * The legacy Google Ads path issues a bare `LIMIT 50` with no probe for a further row, so it
   * cannot know whether more exist and omits the field. Absence therefore means UNKNOWN, and
   * captioning it as partial would mark every legacy response as incomplete — a different false
   * statement from the one this guard prevents.
   */
  it('treats an absent truncation flag as unknown rather than partial', () => {
    render(keywordsResponse());

    expect(partialCaption()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="keyword-totals"]')).not.toBeNull();
  });
});
