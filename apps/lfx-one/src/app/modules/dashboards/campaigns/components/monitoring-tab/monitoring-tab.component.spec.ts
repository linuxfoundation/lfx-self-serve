// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type {
  CampaignMonitorConnections,
  HubSpotEmailMonitorResponse,
  KeywordMetricsResponse,
  MonitorConnectionAccount,
  ReportBackedMonitorResponse,
} from '@lfx-one/shared/interfaces';
import { CAMPAIGN_ACT_FOUNDATION_CHANGED_MESSAGE, MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE } from '@lfx-one/shared/constants';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignActDialogComponent } from '../campaign-act-dialog/campaign-act-dialog.component';
import { CampaignAdoptDialogComponent } from '../campaign-adopt-dialog/campaign-adopt-dialog.component';
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
        { provide: DialogService, useValue: { open: vi.fn() } },
        {
          provide: CampaignService,
          useValue: {
            // The tab loads on init; stub every read so the component constructs without
            // reaching the network.
            getMonitorData: vi.fn().mockReturnValue(of(null)),
            getKeywords: vi.fn().mockReturnValue(of(null)),
            getAudience: vi.fn().mockReturnValue(of(null)),
            getPlatformAudience: vi.fn().mockReturnValue(of({ window: 'last_30_days', bucket_count: 0, buckets: [] })),
            getLinkedInAccounts: vi.fn().mockReturnValue(of([])),
            getRedditAccounts: vi.fn().mockReturnValue(of([])),
            getMetaAccounts: vi.fn().mockReturnValue(of([])),
            getGoogleAdsAccounts: vi.fn().mockReturnValue(of([])),
            getLinkedInMonitor: vi.fn().mockReturnValue(of(null)),
            getRedditMonitor: vi.fn().mockReturnValue(of(null)),
            getMetaMonitor: vi.fn().mockReturnValue(of(null)),
            getMonitorConnections: vi.fn().mockReturnValue(of({ viaCampaignService: false, platforms: {} })),
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

  /** campaign-service reports keyword cost unconverted in the account's own currency and names none (#4807). */
  it("prints a connected account's keyword amounts without a dollar sign, and says so", () => {
    render(keywordsResponse({ amountsInAccountCurrency: true }));
    const row = (fixture.nativeElement.querySelector('[data-testid="keyword-row-0"]') as HTMLElement).textContent ?? '';

    expect(row).toContain('25.00');
    expect(row).not.toContain('$');
    expect(fixture.nativeElement.querySelector('[data-testid="keyword-totals"]')?.textContent).not.toContain('$');
    expect(fixture.nativeElement.querySelector('[data-testid="keyword-currency-note"]')?.textContent?.trim()).toBe(
      "Keyword spend and CPC are in the ad account's own currency."
    );
  });

  it("keeps the legacy read's dollar amounts and no currency note", () => {
    render(keywordsResponse());
    expect((fixture.nativeElement.querySelector('[data-testid="keyword-row-0"]') as HTMLElement).textContent).toContain('$25.00');
    expect(fixture.nativeElement.querySelector('[data-testid="keyword-currency-note"]')).toBeNull();
  });

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

  /**
   * The campaign-service Google read (#4526) can return a row it could not read or pace, with zero
   * placeholders. Those render as the other panels render them, never as a measured 0 or a red 0% bar.
   */
  describe('Google rows from the campaign-service path', () => {
    const base = {
      name: 'C',
      shortName: 'C',
      eventName: 'KubeCon',
      adFormat: 'Search',
      targeting: 'Global',
      status: 'enabled',
      startDate: '2026-08-01',
      endDate: '2026-08-30',
      budgetDay: 100,
      totalBudget: 3000,
      spend: 25,
      impressions: 1000,
      clicks: 40,
      ctr: 4,
      avgCpc: 0.625,
      conversions: 12.5,
      pacingPct: 50,
      pacingLabel: 'normal',
      campaignId: '555',
      googleAdsUrl: '',
    };

    function renderRow(overrides: Record<string, unknown>, totals: Record<string, unknown> = {}): string[] {
      fixture.detectChanges();
      const instance = fixture.componentInstance as unknown as { monitorData: { set(v: unknown): void } };
      instance.monitorData.set({
        pulledAt: '2026-08-30T00:00:00.000Z',
        dateRange: { mode: 'last_30_days' },
        campaigns: [{ ...base, ...overrides }],
        accountTotals: { budgetDay: 100, impressions: 1000, clicks: 40, spend: 25, conversions: 12.5, ...totals },
        actionItems: [],
      });
      fixture.detectChanges();
      const row: HTMLElement = fixture.nativeElement.querySelector('[data-testid="monitoring-campaign-row-0"]');
      return Array.from(row.querySelectorAll('td')).map((cell) => (cell as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '');
    }

    const kpiConversions = (): string => fixture.nativeElement.querySelector('[data-testid="monitoring-kpi-conversions"]')?.textContent?.trim() ?? '';

    it('keeps a measured row exactly as the legacy read renders it', () => {
      const cells = renderRow({ fetchFailed: false, pacingUnknown: false, conversionsMeasured: true });
      expect(cells.slice(2)).toEqual(['$3,000.00', '$25.00', '1,000', '40', '4.0%', '$0.63', '12.5', '50%']);
    });

    it('renders every figure of an unread row as a dash', () => {
      const cells = renderRow({ fetchFailed: true, pacingPct: 0, spend: 0, impressions: 0, clicks: 0, ctr: 0, avgCpc: 0, conversions: 0 });
      expect(cells.slice(2)).toEqual(['—', '—', '—', '—', '—', '—', '—', '—']);
    });

    it('renders unknown pacing as Unknown with an empty grey bar, not a red 0%', () => {
      renderRow({ pacingUnknown: true, pacingPct: 0 });
      const bar: HTMLElement = fixture.nativeElement.querySelector('[data-testid="monitoring-campaign-row-0"] .rounded-full .h-full');
      const text = fixture.nativeElement.querySelector('[data-testid="monitoring-campaign-row-0"] td:last-child span')?.textContent?.trim();
      expect(text).toBe('Unknown');
      expect(bar.className).toContain('bg-gray-300');
      expect(bar.className).not.toContain('bg-red-500');
      expect(bar.style.width).toBe('0%');
    });

    const totalsNote = (): string | null => fixture.nativeElement.querySelector('[data-testid="google-totals-note"]')?.textContent?.trim() ?? null;

    it('says what the totals leave out when a row was not read or did not measure conversions, as the other panels do', () => {
      fixture.detectChanges();
      const instance = fixture.componentInstance as unknown as { monitorData: { set(v: unknown): void } };
      instance.monitorData.set({
        pulledAt: '2026-08-30T00:00:00.000Z',
        dateRange: { mode: 'last_30_days' },
        campaigns: [
          { ...base, campaignId: '1', fetchFailed: false, conversionsMeasured: true },
          { ...base, campaignId: '2', fetchFailed: false, conversionsMeasured: false },
          { ...base, campaignId: '3', fetchFailed: true, conversionsMeasured: false },
        ],
        accountTotals: { budgetDay: 300, impressions: 2000, clicks: 80, spend: 50, conversions: 12.5, conversionsMeasured: true },
        actionItems: [],
      });
      fixture.detectChanges();

      expect(totalsNote()).toBe('Totals may understate: 1 of 3 campaigns could not be fully read; conversions are measured for 1 of 3 campaigns.');
    });

    it('shows no totals note when every row was read and measured', () => {
      renderRow({ fetchFailed: false, conversionsMeasured: true });
      expect(totalsNote()).toBeNull();
      // Paired positive: the strip itself rendered, so the absent note is not an absent panel.
      expect(fixture.nativeElement.querySelector('[data-testid="monitoring-kpis"]')).not.toBeNull();
    });

    it("prints the connected account's amounts without a dollar sign, and says so", () => {
      fixture.detectChanges();
      const instance = fixture.componentInstance as unknown as { monitorData: { set(v: unknown): void } };
      instance.monitorData.set({
        pulledAt: '2026-08-30T00:00:00.000Z',
        dateRange: { mode: 'last_30_days' },
        campaigns: [{ ...base, fetchFailed: false, pacingUnknown: false, conversionsMeasured: true }],
        accountTotals: { budgetDay: 100, impressions: 1000, clicks: 40, spend: 25, conversions: 12.5, conversionsMeasured: true },
        actionItems: [],
        amountsInAccountCurrency: true,
      });
      fixture.detectChanges();
      const row: HTMLElement = fixture.nativeElement.querySelector('[data-testid="monitoring-campaign-row-0"]');
      const cells = Array.from(row.querySelectorAll('td')).map((cell) => (cell as HTMLElement).textContent?.trim() ?? '');

      expect(cells.slice(2, 4)).toEqual(['3,000.00', '25.00']);
      expect(cells[7]).toBe('0.63');
      expect(fixture.nativeElement.querySelector('[data-testid="google-currency-note"]')?.textContent?.trim()).toBe(
        "Spend, budgets and CPC are in the ad account's own currency."
      );
    });

    it('keeps the dollar sign and no currency note on the legacy read', () => {
      renderRow({});
      expect(fixture.nativeElement.querySelector('[data-testid="google-currency-note"]')).toBeNull();
    });

    it('renders unmeasured conversions as Not measured on the row and in the KPI strip', () => {
      const cells = renderRow({ conversionsMeasured: false, conversions: 0 }, { conversions: 0, conversionsMeasured: false });
      expect(cells[cells.length - 2]).toBe('Not measured');
      expect(kpiConversions()).toBe('Not measured');
    });
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
    // The FALSE arm of keywordTotalsUnverified: a known-complete set gets NEITHER caption. An
    // assertion that the unknown caption appears proves nothing about when it must not, so this
    // is what stops it rendering on every response.
    expect(fixture.nativeElement.querySelector('[data-testid="keyword-totals-unverified"]')).toBeNull();
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

    // Not captioned as truncated -- that would be a false statement about every legacy response.
    expect(partialCaption()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="keyword-totals"]')).not.toBeNull();
    // But it does say WHICH keywords the numbers cover, without claiming they are all of them.
    const unverified = fixture.nativeElement.querySelector('[data-testid="keyword-totals-unverified"]');
    expect(unverified, 'unknown completeness rendered no caption at all').not.toBeNull();
    // Must NOT claim project scope: an absent `truncated` identifies the legacy read, whose
    // query has no project filter and spans every foundation on the shared ad account.
    expect(unverified?.textContent).toContain('returned by the ad account');
    expect(unverified?.textContent).not.toContain('this project');
  });
});

/**
 * The LinkedIn, Reddit and Meta campaign tables, and whether a value campaign-service could not measure is
 * shown as such.
 *
 * With `LFX_CUTOVER_CAMPAIGN_SERVICE_MONITOR` on, a row can carry `conversionsMeasured: false`,
 * `pacingUnknown: true` or `fetchFailed: true`, each qualifying a 0 placeholder. Rendering those
 * placeholders as "0" or "0% normal" states a measurement nobody took. The flag-off (legacy) rows
 * carry none of the flags and must render exactly as before — asserted first, below.
 */
describe.each(['linkedin', 'reddit', 'meta'] as const)('MonitoringTabComponent — %s unmeasured values', (platform) => {
  let fixture: ComponentFixture<MonitoringTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MonitoringTabComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: ProjectContextService, useValue: { activeContext: signal({ slug: 'tlf' }) } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        {
          provide: CampaignService,
          useValue: {
            getMonitorData: vi.fn().mockReturnValue(of(null)),
            getKeywords: vi.fn().mockReturnValue(of(null)),
            getAudience: vi.fn().mockReturnValue(of(null)),
            getPlatformAudience: vi.fn().mockReturnValue(of({ window: 'last_30_days', bucket_count: 0, buckets: [] })),
            getLinkedInAccounts: vi.fn().mockReturnValue(of([])),
            getRedditAccounts: vi.fn().mockReturnValue(of([])),
            getMetaAccounts: vi.fn().mockReturnValue(of([])),
            getGoogleAdsAccounts: vi.fn().mockReturnValue(of([])),
            getMonitorConnections: vi.fn().mockReturnValue(of({ viaCampaignService: false, platforms: {} })),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MonitoringTabComponent);
  });

  function campaign(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      campaignId: '1',
      campaignName: 'KubeCon NA 2026',
      eventName: 'KubeCon NA 2026',
      creatives: [],
      status: 'ACTIVE',
      totalBudget: 1000,
      dailyBudget: 0,
      spend: 412.5,
      impressions: 52000,
      clicks: 610,
      ctr: 1.17,
      conversions: 14,
      pacingPct: 88,
      pacingLabel: 'normal',
      startDate: '2026-09-01',
      endDate: '2026-11-30',
      ...over,
    };
  }

  function render(campaigns: Record<string, unknown>[], totalsOver: Record<string, unknown> = {}): void {
    fixture.detectChanges();
    const instance = fixture.componentInstance as unknown as {
      selectedPlatform: { set(v: string): void };
      linkedInData: { set(v: unknown): void };
      redditData: { set(v: unknown): void };
      metaData: { set(v: unknown): void };
    };
    instance.selectedPlatform.set(platform);
    const data = {
      accountLabel: 'LF',
      pulledAt: '2026-10-13T00:00:00.000Z',
      dateRange: { mode: 'last_30_days' },
      campaigns,
      accountTotals: { spend: 412.5, impressions: 52000, clicks: 610, conversions: 14, campaignCount: campaigns.length, ...totalsOver },
      actionItems: [],
    };
    const target = { linkedin: instance.linkedInData, reddit: instance.redditData, meta: instance.metaData }[platform];
    target.set(data);
    fixture.detectChanges();
  }

  const text = (testId: string): string => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const el = (testId: string): Element | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it('renders a legacy (flag-off) row exactly as before: measured number, pacing with its label, no note', () => {
    render([campaign()]);

    expect(text(`${platform}-campaign-conversions`)).toBe('14');
    expect(text(`${platform}-campaign-pacing`)).toBe('88% normal');
    expect(text(`${platform}-kpi-conversions`)).toBe('14');
    expect(el(`${platform}-campaign-fetch-failed`)).toBeNull();
    expect(el(`${platform}-totals-note`)).toBeNull();
  });

  it.runIf(platform === 'linkedin')('shows the creative count as "Not read" when campaign-service did not read creatives', () => {
    render([campaign({ creativesMeasured: false })]);
    expect(text('linkedin-campaign-creatives')).toBe('Not read');
  });

  it.runIf(platform === 'linkedin')('keeps the legacy (flag-off) creative count', () => {
    render([campaign({ creatives: [{}, {}] })]);
    expect(text('linkedin-campaign-creatives')).toBe('2');
  });

  it('renders a measured row from campaign-service the same way', () => {
    render([campaign({ conversionsMeasured: true, pacingUnknown: false, fetchFailed: false })], { conversionsMeasured: true });

    expect(text(`${platform}-campaign-conversions`)).toBe('14');
    expect(text(`${platform}-campaign-pacing`)).toBe('88% normal');
    expect(el(`${platform}-totals-note`)).toBeNull();
  });

  it('shows unmeasured conversions as "Not measured", in the row and the KPI tile', () => {
    render([campaign({ conversions: 0, conversionsMeasured: false })], { conversions: 0, conversionsMeasured: false });

    expect(text(`${platform}-campaign-conversions`)).toBe('Not measured');
    expect(text(`${platform}-kpi-conversions`)).toBe('Not measured');
  });

  it('shows unknown pacing as "Unknown", with no percentage and no label', () => {
    render([campaign({ pacingPct: 0, pacingLabel: undefined, pacingUnknown: true })]);

    expect(text(`${platform}-campaign-pacing`)).toBe('Unknown');
  });

  it('marks a row it could not read, dashes its metrics, and notes the totals are partial', () => {
    render([
      campaign({ campaignId: '1', fetchFailed: true, pacingUnknown: false, pacingLabel: undefined, spend: 0, conversions: 0, conversionsMeasured: true }),
      campaign({ campaignId: '2', conversionsMeasured: true }),
    ]);

    expect(text(`${platform}-campaign-fetch-failed`)).toBe("Couldn't read");
    expect(text(`${platform}-campaign-conversions`)).toBe('—');
    expect(text(`${platform}-campaign-pacing`)).toBe('—');
    expect(text(`${platform}-totals-note`)).toBe('Totals may understate: 1 of 2 campaigns could not be fully read.');
  });

  it('notes a conversions total that covers only some campaigns', () => {
    render([campaign({ campaignId: '1', conversionsMeasured: true }), campaign({ campaignId: '2', conversions: 0, conversionsMeasured: false })], {
      conversionsMeasured: true,
    });

    expect(text(`${platform}-totals-note`)).toBe('Conversions are measured for 1 of 2 campaigns.');
  });
});

/**
 * The monitor cutover (#2519): which account each picker offers, the empty states when there is
 * none, and the campaign-service-only Microsoft / X / HubSpot sections.
 *
 * Flag OFF is asserted first and must be the tab exactly as it was: legacy account lists, the four
 * original buttons, no notices.
 */
describe('MonitoringTabComponent — campaign-service monitor cutover', () => {
  let fixture: ComponentFixture<MonitoringTabComponent>;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  const connected = (accountId: string, label = accountId): MonitorConnectionAccount => ({ state: 'connected', accountId, label });
  const none = (state: MonitorConnectionAccount['state']): MonitorConnectionAccount => ({ state, accountId: null, label: null });

  function reportBacked(over: Partial<ReportBackedMonitorResponse> = {}): ReportBackedMonitorResponse {
    return {
      accountId: '187654321',
      pulledAt: '2026-10-13T00:00:00.000Z',
      dateRange: { mode: 'last_30_days' },
      campaigns: [
        {
          campaignId: '1',
          campaignName: 'KubeCon NA 2026 - Search',
          status: 'Active',
          totalBudget: 0,
          dailyBudget: 100,
          spend: 412.5,
          impressions: 52000,
          clicks: 610,
          ctr: 1.17,
          conversions: 0,
          pacingPct: 88,
          pacingLabel: 'normal',
          startDate: '2026-09-01',
          endDate: '',
          pacingUnknown: false,
          fetchFailed: false,
          conversionsMeasured: false,
        },
      ],
      accountTotals: { spend: 412.5, impressions: 52000, clicks: 610, conversions: 0, campaignCount: 1, conversionsMeasured: false },
      actionItems: [],
      metricsAsOf: '2026-10-12T10:00:00Z',
      metricsWindowStart: '2026-09-13',
      metricsWindowEnd: '2026-10-12',
      metricsPending: false,
      ...over,
    };
  }

  function hubspot(over: Partial<HubSpotEmailMonitorResponse> = {}): HubSpotEmailMonitorResponse {
    return {
      pulledAt: '2026-10-13T00:00:00.000Z',
      days: 30,
      emails: [
        {
          campaignId: 'c1',
          emailId: 'e1',
          name: 'KubeCon NA 2026 — registration open',
          abVariant: false,
          deleted: false,
          sent: 5000,
          delivered: 4850,
          opens: 1455,
          clicks: 194,
          bounces: 150,
          unsubscribes: 24,
          spamReports: 1,
          openRate: 0.3,
          clickRate: 0.04,
          bounceRate: 0.03,
          unsubscribeRate: 0.0049,
          spamRate: 0.0002,
        },
        {
          campaignId: 'c2',
          emailId: 'e2',
          name: 'Staged draft',
          abVariant: true,
          deleted: false,
          sent: 10,
          delivered: 0,
          opens: 0,
          clicks: 0,
          bounces: 10,
          unsubscribes: 0,
          spamReports: 0,
          openRate: null,
          clickRate: null,
          bounceRate: 1,
          unsubscribeRate: null,
          spamRate: null,
        },
      ],
      totals: {
        emailCount: 2,
        sent: 5010,
        delivered: 4850,
        opens: 1455,
        clicks: 194,
        bounces: 160,
        unsubscribes: 24,
        spamReports: 1,
        openRate: 0.3,
        clickRate: 0.04,
        bounceRate: 0.0319,
        unsubscribeRate: 0.0049,
        spamRate: 0.0002,
      },
      actionItems: [{ priority: 'HIGH', emailId: 'e2', emailName: 'Staged draft', issue: 'Sent but nothing delivered', action: 'Check the list' }],
      metricsAsOf: '2026-10-12T10:00:00Z',
      metricsWindowStart: '2026-09-13',
      metricsWindowEnd: '2026-10-12',
      emailsChecked: 3,
      emailsNotSentInWindow: 1,
      emailsUnattributable: 0,
      emailsTruncated: false,
      ...over,
    };
  }

  async function setup(connections: CampaignMonitorConnections | Error): Promise<void> {
    service = {
      getMonitorData: vi.fn().mockReturnValue(of(null)),
      getKeywords: vi.fn().mockReturnValue(of(null)),
      getAudience: vi.fn().mockReturnValue(of(null)),
      getPlatformAudience: vi.fn().mockReturnValue(of({ window: 'last_30_days', bucket_count: 0, buckets: [] })),
      getLinkedInAccounts: vi.fn().mockReturnValue(of([{ accountId: '512345678', label: 'LF LinkedIn (legacy)', orgId: '1' }])),
      getRedditAccounts: vi.fn().mockReturnValue(of([{ key: 't2_legacy', label: 'LF Reddit (legacy)' }])),
      getMetaAccounts: vi.fn().mockReturnValue(of([{ key: 'act_1', label: 'LF Meta (legacy)' }])),
      getGoogleAdsAccounts: vi.fn().mockReturnValue(of([])),
      getLinkedInMonitorData: vi.fn().mockReturnValue(of(null)),
      getRedditMonitorData: vi.fn().mockReturnValue(of(null)),
      getMetaMonitorData: vi.fn().mockReturnValue(of(null)),
      getMicrosoftMonitorData: vi.fn().mockReturnValue(of(reportBacked())),
      getTwitterMonitorData: vi.fn().mockReturnValue(of(reportBacked())),
      getHubSpotMonitorData: vi.fn().mockReturnValue(of(hubspot())),
      getMonitorConnections: vi.fn().mockReturnValue(connections instanceof Error ? throwError(() => connections) : of(connections)),
    };
    await TestBed.configureTestingModule({
      imports: [MonitoringTabComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: ProjectContextService, useValue: { activeContext: signal({ slug: 'cncf' }) } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: CampaignService, useValue: service },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MonitoringTabComponent);
    fixture.detectChanges();
  }

  const el = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => el(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const options = (testId: string): string[] =>
    Array.from((el(testId) as HTMLSelectElement | null)?.options ?? []).map((o) => `${o.value}|${o.textContent?.trim()}`);

  function select(platform: string): void {
    (el(`platform-${platform}`) as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  const allConnected: CampaignMonitorConnections = {
    viaCampaignService: true,
    platforms: {
      linkedin: connected('700000001', 'CNCF LinkedIn'),
      reddit: connected('t2_cncf'),
      meta: connected('act_700000001', 'CNCF Meta'),
      microsoft: connected('187654321', 'CNCF Microsoft'),
      twitter: connected('18ce54d4x5t'),
    },
  };

  describe('flag off', () => {
    beforeEach(async () => setup({ viaCampaignService: false, platforms: {} }));

    it('loads the legacy account lists and offers only the four original platforms', () => {
      expect(service['getLinkedInAccounts']).toHaveBeenCalledWith('cncf');
      expect(service['getRedditAccounts']).toHaveBeenCalledWith('cncf');
      expect(service['getMetaAccounts']).toHaveBeenCalledWith('cncf');
      expect(el('platform-microsoft')).toBeNull();
      expect(el('platform-twitter')).toBeNull();
      expect(el('platform-hubspot')).toBeNull();
      expect(el('platform-meta')).not.toBeNull();
    });

    it('fills the picker from the legacy list and reads that account, with no notice', () => {
      select('linkedin');

      expect(options('linkedin-account-select')).toEqual(['512345678|LF LinkedIn (legacy)']);
      expect(service['getLinkedInMonitorData']).toHaveBeenCalledWith('cncf', '512345678', 30, 'legacy');
      expect(el('linkedin-connection-notice')).toBeNull();
    });
  });

  describe('flag on', () => {
    it("fills each picker with the project's connection account, never the legacy lists", async () => {
      await setup(allConnected);
      select('linkedin');

      expect(service['getLinkedInAccounts']).not.toHaveBeenCalled();
      expect(service['getRedditAccounts']).not.toHaveBeenCalled();
      expect(service['getMetaAccounts']).not.toHaveBeenCalled();
      expect(options('linkedin-account-select')).toEqual(['700000001|CNCF LinkedIn']);
      expect(service['getLinkedInMonitorData']).toHaveBeenCalledWith('cncf', '700000001', 30, 'connection');

      select('meta');
      expect(options('meta-account-select')).toEqual(['act_700000001|CNCF Meta']);
      expect(service['getMetaMonitorData']).toHaveBeenCalledWith('cncf', 'act_700000001', 30, 'connection');
    });

    it('offers Microsoft Ads, X and HubSpot, X because it is monitorable although its create is disabled', async () => {
      await setup(allConnected);

      expect(el('platform-microsoft')).not.toBeNull();
      expect(el('platform-hubspot')).not.toBeNull();
      expect(el('platform-twitter')).not.toBeNull();
      expect(el('platform-twitter')?.textContent?.trim()).toBe('X Ads');
    });

    it("reads the X connection's account from the X button", async () => {
      await setup(allConnected);
      select('twitter');

      expect(service['getTwitterMonitorData']).toHaveBeenCalledWith('cncf', '18ce54d4x5t', 30);
      expect(el('twitter-monitor-panel')).not.toBeNull();
      expect(el('twitter-error')).toBeNull();
    });

    it('shows "metrics not enabled" for X instead of an error while campaign-service does not read X metrics', async () => {
      await setup(allConnected);
      service['getTwitterMonitorData'].mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'not enabled', upstreamCode: 'metrics_not_enabled' } }))
      );
      select('twitter');

      expect(el('twitter-connection-notice')?.getAttribute('data-state')).toBe('metrics_disabled');
      expect(text('twitter-connection-notice-title')).toBe('X / Twitter Ads metrics are not enabled');
      expect(el('twitter-error')).toBeNull();
    });

    it('says the project has no X connection, with no read', async () => {
      await setup({ ...allConnected, platforms: { ...allConnected.platforms, twitter: none('no_connection') } });
      select('twitter');

      expect(el('twitter-connection-notice')?.getAttribute('data-state')).toBe('no_connection');
      expect(service['getTwitterMonitorData']).not.toHaveBeenCalled();
      expect(el('twitter-error')).toBeNull();
    });

    it('says the project has no connection for a platform, with no picker and no read', async () => {
      await setup({ ...allConnected, platforms: { ...allConnected.platforms, reddit: none('no_connection') } });
      select('reddit');

      expect(el('reddit-connection-notice')?.getAttribute('data-state')).toBe('no_connection');
      expect(text('reddit-connection-notice-title')).toBe('No Reddit Ads connection for this project');
      expect(text('reddit-connection-notice-message')).toContain("Ask an LFX administrator to connect this project's Reddit Ads account");
      expect(el('reddit-account-select')).toBeNull();
      expect(service['getRedditMonitorData']).not.toHaveBeenCalled();
    });

    it('says the connection has no account bound', async () => {
      await setup({ ...allConnected, platforms: { ...allConnected.platforms, meta: none('no_account') } });
      select('meta');

      expect(el('meta-connection-notice')?.getAttribute('data-state')).toBe('no_account');
      expect(text('meta-connection-notice-title')).toBe('No Meta Ads ad account selected');
      expect(text('meta-connection-notice-message')).toContain('choose the ad account on the connection');
      expect(service['getMetaMonitorData']).not.toHaveBeenCalled();
    });

    /** campaign-service refused the read for lack of the project's `campaign_manager` role (#4837): no "refresh" advice. */
    it('names the missing project role when campaign-service refused the connection read', async () => {
      await setup({ ...allConnected, platforms: { ...allConnected.platforms, linkedin: none('forbidden') } });
      select('linkedin');

      expect(el('linkedin-connection-notice')?.getAttribute('data-state')).toBe('forbidden');
      expect(text('linkedin-connection-notice-title')).toBe('LinkedIn Ads monitoring needs the campaign manager role');
      expect(text('linkedin-connection-notice-message')).toContain('Your account needs the campaign manager role on this project');
      expect(text('linkedin-connection-notice-message')).not.toMatch(/refresh/i);
      // Reading again cannot grant the role, so the notice offers no Refresh.
      expect(el('linkedin-connection-notice-retry')).toBeNull();
      expect(service['getLinkedInMonitorData']).not.toHaveBeenCalled();
    });

    it('re-reads the connections from the notice', async () => {
      await setup({ ...allConnected, platforms: { ...allConnected.platforms, linkedin: none('unavailable') } });
      select('linkedin');
      expect(text('linkedin-connection-notice-title')).toBe("Couldn't check the LinkedIn Ads connection");

      service['getMonitorConnections'].mockReturnValue(of(allConnected));
      (el('linkedin-connection-notice-retry') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(service['getMonitorConnections']).toHaveBeenCalledTimes(2);
      expect(el('linkedin-connection-notice')).toBeNull();
      expect(service['getLinkedInMonitorData']).toHaveBeenCalledWith('cncf', '700000001', 30, 'connection');
    });

    it('shows "metrics not enabled" instead of an error for the 400 the BFF marks so', async () => {
      await setup(allConnected);
      service['getMicrosoftMonitorData'].mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'not enabled', upstreamCode: 'metrics_not_enabled' } }))
      );
      select('microsoft');

      expect(el('microsoft-connection-notice')?.getAttribute('data-state')).toBe('metrics_disabled');
      expect(text('microsoft-connection-notice-title')).toBe('Microsoft Ads metrics are not enabled');
      expect(text('microsoft-connection-notice-message')).toContain('Ask the LFX platform team to enable them');
      expect(el('microsoft-error')).toBeNull();
    });

    it('shows any other 400 as an error, not as "not enabled"', async () => {
      await setup(allConnected);
      service['getMicrosoftMonitorData'].mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'connection is not bound to this account' } }))
      );
      select('microsoft');

      expect(el('microsoft-connection-notice')).toBeNull();
      expect(text('microsoft-error')).toContain('connection is not bound to this account');
    });

    // #4837: a role refusal answers 403 again on every retry, so no panel offers Retry for one; any
    // other failure keeps it.
    const panelReads = [
      ['linkedin', 'getLinkedInMonitorData'],
      ['reddit', 'getRedditMonitorData'],
      ['meta', 'getMetaMonitorData'],
      ['microsoft', 'getMicrosoftMonitorData'],
      ['twitter', 'getTwitterMonitorData'],
      ['hubspot', 'getHubSpotMonitorData'],
    ] as const;

    it.each(panelReads)('offers no Retry on the %s panel when its read is refused for the caller role', async (panel, read) => {
      await setup(allConnected);
      service[read].mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 403, error: { error: 'campaign-service refused to read this account.' } }))
      );
      select(panel);

      expect(text(`${panel}-error`)).toContain('campaign-service refused to read this account.');
      expect(el(`${panel}-retry`)).toBeNull();
    });

    it.each(panelReads)('still offers Retry on the %s panel for any other failure', async (panel, read) => {
      await setup(allConnected);
      service[read].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502, error: { error: 'upstream unavailable' } })));
      select(panel);

      expect(el(`${panel}-error`)).not.toBeNull();
      expect(el(`${panel}-retry`)).not.toBeNull();
    });

    it('marks the monitor read as coming from the connection', async () => {
      await setup(allConnected);
      select('reddit');

      expect(service['getRedditMonitorData']).toHaveBeenCalledWith('cncf', 't2_cncf', 30, 'connection');
    });

    /**
     * During a rolling flag change the monitor read can land on a pod with the cutover OFF, which
     * refuses it. The panel says so, and its Retry re-checks the data source before reading again —
     * so if the flag has gone off everywhere, the legacy pickers take over.
     */
    it('shows the cutover-mismatch refusal, and Retry re-checks the data source', async () => {
      await setup(allConnected);
      service['getLinkedInMonitorData'].mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { error: 'The monitor is switching data sources; refresh in a moment.', code: 'MONITOR_CUTOVER_MISMATCH' },
            })
        )
      );
      select('linkedin');
      expect(text('linkedin-error')).toContain('The monitor is switching data sources; refresh in a moment.');

      // The rollout settled with the flag OFF everywhere: the next read succeeds on the legacy path.
      service['getMonitorConnections'].mockReturnValue(of({ viaCampaignService: false, platforms: {} }));
      service['getLinkedInMonitorData'].mockReturnValue(of(null));
      (el('linkedin-error')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(service['getMonitorConnections']).toHaveBeenCalledTimes(2);
      expect(service['getLinkedInAccounts']).toHaveBeenCalledWith('cncf');
      expect(service['getLinkedInMonitorData']).toHaveBeenLastCalledWith('cncf', '512345678', 30, 'legacy');
      expect(el('linkedin-error')).toBeNull();
      expect(options('linkedin-account-select')).toEqual(['512345678|LF LinkedIn (legacy)']);
    });

    it('falls back to the legacy lists when the connections read fails before the flag is known', async () => {
      await setup(new Error('network'));

      expect(service['getLinkedInAccounts']).toHaveBeenCalledWith('cncf');
      expect(el('platform-microsoft')).toBeNull();
    });

    /**
     * A failed discovery is not a confirmed "cutover off" (#3637 review). The legacy account the
     * fallback reads is refused while the flag is on, and Retry must re-run the discovery rather than
     * repeat that read — so once it succeeds the connection's account is read and Microsoft and
     * HubSpot appear, with no reload or foundation switch.
     */
    it('retries a failed connections read from the panel Retry, and recovers onto the connection path', async () => {
      await setup(new Error('network'));
      service['getLinkedInMonitorData'].mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'connection is not bound to this account' } }))
      );
      select('linkedin');
      expect(service['getLinkedInMonitorData']).toHaveBeenCalledWith('cncf', '512345678', 30, 'legacy');
      expect(text('linkedin-error')).toContain('connection is not bound to this account');

      service['getMonitorConnections'].mockReturnValue(of(allConnected));
      service['getLinkedInMonitorData'].mockReturnValue(of(null));
      (el('linkedin-error')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(service['getMonitorConnections']).toHaveBeenCalledTimes(2);
      expect(service['getLinkedInMonitorData']).toHaveBeenLastCalledWith('cncf', '700000001', 30, 'connection');
      expect(el('linkedin-error')).toBeNull();
      expect(options('linkedin-account-select')).toEqual(['700000001|CNCF LinkedIn']);
      expect(el('platform-microsoft')).not.toBeNull();
      expect(el('platform-hubspot')).not.toBeNull();
    });

    it('still re-reads the panel when the retried connections read fails again', async () => {
      await setup(new Error('network'));
      service['getLinkedInMonitorData'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { error: 'boom' } })));
      select('linkedin');

      service['getLinkedInMonitorData'].mockReturnValue(of(null));
      (el('linkedin-error')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(service['getMonitorConnections']).toHaveBeenCalledTimes(2);
      expect(service['getLinkedInMonitorData']).toHaveBeenLastCalledWith('cncf', '512345678', 30, 'legacy');
      expect(el('linkedin-error')).toBeNull();
      expect(el('platform-microsoft')).toBeNull();
    });
  });

  describe('Google Ads account discovery', () => {
    it('reads nothing and lists nothing while the flag is off', async () => {
      await setup({ viaCampaignService: false, platforms: {} });

      expect(service['getGoogleAdsAccounts']).not.toHaveBeenCalled();
      expect(el('monitoring-google-accounts')).toBeNull();
    });

    it("lists the accounts the project's connection can reach on the Google Ads panel", async () => {
      await setup(allConnected);
      service['getGoogleAdsAccounts'].mockReturnValue(
        of([
          { key: '1000000001', label: 'CNCF Search' },
          { key: '1000000002', label: '1000000002' },
        ])
      );
      fixture.componentInstance['loadGoogleAccounts']();
      fixture.detectChanges();

      expect(service['getGoogleAdsAccounts']).toHaveBeenCalledWith('cncf');
      expect(text('monitoring-google-account-1000000001')).toBe('CNCF Search (1000000001)');
      // An account with no label of its own is shown by id once, not as "id (id)".
      expect(text('monitoring-google-account-1000000002')).toBe('1000000002');
    });

    it('says so when the connection reaches no account', async () => {
      await setup(allConnected);

      expect(text('monitoring-google-accounts-empty')).toBe('This connection reaches no Google Ads accounts.');
      expect(el('monitoring-google-accounts-list')).toBeNull();
    });

    it('states a failed read, and retries it', async () => {
      await setup(allConnected);
      service['getGoogleAdsAccounts'].mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 404, error: { error: 'no Google Ads connection configured for this project' } }))
      );
      fixture.componentInstance['loadGoogleAccounts']();
      fixture.detectChanges();

      expect(text('monitoring-google-accounts-error')).toContain('no Google Ads connection configured for this project');

      service['getGoogleAdsAccounts'].mockReturnValue(of([{ key: '1000000001', label: 'CNCF Search' }]));
      (el('monitoring-google-accounts-retry') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(el('monitoring-google-accounts-error')).toBeNull();
      expect(text('monitoring-google-account-1000000001')).toBe('CNCF Search (1000000001)');
    });

    it('re-checks the source on Retry, so a rollback since the tab opened clears the error instead of repeating it', async () => {
      await setup(allConnected);
      service['getGoogleAdsAccounts'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404, error: { error: 'not found' } })));
      fixture.componentInstance['loadGoogleAccounts']();
      fixture.detectChanges();
      const reads = service['getGoogleAdsAccounts'].mock.calls.length;

      service['getMonitorConnections'].mockReturnValue(of({ viaCampaignService: false, platforms: {} }));
      (el('monitoring-google-accounts-retry') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(service['getGoogleAdsAccounts']).toHaveBeenCalledTimes(reads);
      expect(el('monitoring-google-accounts')).toBeNull();
    });

    it('offers no Retry when the account list is refused for the caller role (#4837)', async () => {
      await setup(allConnected);
      service['getGoogleAdsAccounts'].mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 403, error: { error: 'campaign-service refused to read this account.' } }))
      );
      fixture.componentInstance['loadGoogleAccounts']();
      fixture.detectChanges();

      expect(text('monitoring-google-accounts-error')).toContain('campaign-service refused to read this account.');
      expect(el('monitoring-google-accounts-retry')).toBeNull();
    });

    it('shows nothing, not an error, when the read is refused as a shared-account read', async () => {
      await setup(allConnected);
      service['getGoogleAdsAccounts'].mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 403, error: { error: 'shared account', code: MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE } }))
      );
      fixture.componentInstance['loadGoogleAccounts']();
      fixture.detectChanges();

      expect(el('monitoring-google-accounts')).toBeNull();
    });

    it('asks again on a fresh foundation load, since a refusal can come from an outage the root check failed closed on', async () => {
      await setup(allConnected);
      service['getGoogleAdsAccounts'].mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 403, error: { error: 'shared account', code: MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE } }))
      );
      fixture.componentInstance['loadGoogleAccounts']();
      const calls = service['getGoogleAdsAccounts'].mock.calls.length;

      service['getGoogleAdsAccounts'].mockReturnValue(of([{ key: '1000000001', label: 'CNCF Search' }]));
      fixture.componentInstance['loadForActiveFoundation']();
      fixture.detectChanges();

      expect(service['getGoogleAdsAccounts'].mock.calls.length).toBeGreaterThan(calls);
      expect(text('monitoring-google-account-1000000001')).toBe('CNCF Search (1000000001)');
    });

    it('clears a previous error when a load is skipped for a caller known to be restricted', async () => {
      await setup(allConnected);
      service['getGoogleAdsAccounts'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { error: 'boom' } })));
      fixture.componentInstance['loadGoogleAccounts']();
      fixture.detectChanges();
      expect(el('monitoring-google-accounts-error')).not.toBeNull();

      fixture.componentInstance['googleRestricted'].set(true);
      fixture.componentInstance['loadGoogleAccounts']();
      fixture.detectChanges();

      expect(el('monitoring-google-accounts-error')).toBeNull();
    });

    it('does not ask again once the caller is known to be refused, since the refusal is about the caller', async () => {
      await setup(allConnected);
      service['getGoogleAdsAccounts'].mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 403, error: { error: 'shared account', code: MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE } }))
      );
      fixture.componentInstance['loadGoogleAccounts']();
      const calls = service['getGoogleAdsAccounts'].mock.calls.length;

      fixture.componentInstance['loadGoogleAccounts']();
      fixture.detectChanges();

      expect(service['getGoogleAdsAccounts']).toHaveBeenCalledTimes(calls);
      expect(el('monitoring-google-accounts')).toBeNull();
    });

    it('drops the list when the cutover turns off', async () => {
      await setup(allConnected);
      service['getGoogleAdsAccounts'].mockReturnValue(of([{ key: '1000000001', label: 'CNCF Search' }]));
      fixture.componentInstance['loadGoogleAccounts']();
      fixture.detectChanges();
      expect(el('monitoring-google-accounts-list')).not.toBeNull();

      service['getMonitorConnections'].mockReturnValue(of({ viaCampaignService: false, platforms: {} }));
      fixture.componentInstance['loadMonitorConnections']();
      fixture.detectChanges();

      expect(el('monitoring-google-accounts')).toBeNull();
    });
  });

  /**
   * Both directions of a mixed rollout (#3637 review). Discovery can succeed on a pod with the flag
   * OFF while the read lands on one with it ON, which refuses the legacy-picker read with its own
   * typed 409. That discovery SUCCEEDED, so the panel's Retry must still re-run it — every Retry
   * re-checks the source — and then read the connection's account.
   */
  describe('mixed rollout, legacy discovery then a flag-ON backend', () => {
    const legacyMismatch = (): HttpErrorResponse =>
      new HttpErrorResponse({
        status: 409,
        error: { error: 'The monitor is switching data sources; refresh in a moment.', code: 'MONITOR_CUTOVER_LEGACY_MISMATCH' },
      });

    it('marks a legacy-picker read as legacy', async () => {
      await setup({ viaCampaignService: false, platforms: {} });
      select('meta');

      expect(service['getMetaMonitorData']).toHaveBeenCalledWith('cncf', 'act_1', 30, 'legacy');
    });

    it.each([
      ['linkedin', 'getLinkedInMonitorData', '700000001'],
      ['reddit', 'getRedditMonitorData', 't2_cncf'],
      ['meta', 'getMetaMonitorData', 'act_700000001'],
    ] as const)('recovers %s onto the connection path from Retry after a SUCCESSFUL flag-off discovery', async (platform, read, connectionAccount) => {
      await setup({ viaCampaignService: false, platforms: {} });
      service[read].mockReturnValue(throwError(legacyMismatch));
      select(platform);
      expect(text(`${platform}-error`)).toContain('The monitor is switching data sources; refresh in a moment.');

      // The rollout settled with the flag ON: discovery now answers the project's connections.
      service['getMonitorConnections'].mockReturnValue(of(allConnected));
      service[read].mockReturnValue(of(null));
      (el(`${platform}-error`)?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(service['getMonitorConnections']).toHaveBeenCalledTimes(2);
      expect(service[read]).toHaveBeenLastCalledWith('cncf', connectionAccount, 30, 'connection');
      expect(el(`${platform}-error`)).toBeNull();
      expect(el('platform-microsoft')).not.toBeNull();
    });

    it('re-checks the source on Retry even while the flag stays off, then reads the legacy account again', async () => {
      await setup({ viaCampaignService: false, platforms: {} });
      service['getRedditMonitorData'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { error: 'boom' } })));
      select('reddit');
      expect(el('reddit-error')).not.toBeNull();

      service['getRedditMonitorData'].mockReturnValue(of(null));
      (el('reddit-error')?.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(service['getMonitorConnections']).toHaveBeenCalledTimes(2);
      expect(service['getRedditMonitorData']).toHaveBeenLastCalledWith('cncf', 't2_legacy', 30, 'legacy');
      expect(el('reddit-error')).toBeNull();
    });
  });

  /**
   * A "metrics not enabled" answer must not outlive the read that produced it (#3637 review): the
   * next read — a header Refresh, or switching away and back — can fail another way, and a stale
   * notice would hide that error and its Retry.
   */
  describe('metrics-disabled state is per read', () => {
    const disabled = (): HttpErrorResponse => new HttpErrorResponse({ status: 400, error: { error: 'not enabled', upstreamCode: 'metrics_not_enabled' } });
    const unavailable = (): HttpErrorResponse => new HttpErrorResponse({ status: 503, error: { error: 'temporarily unavailable' } });

    it.each([
      ['linkedin', 'getLinkedInMonitorData'],
      ['reddit', 'getRedditMonitorData'],
      ['meta', 'getMetaMonitorData'],
      ['microsoft', 'getMicrosoftMonitorData'],
      ['twitter', 'getTwitterMonitorData'],
    ] as const)('shows %s 503 after a disabled 400 on the panel Refresh, with its Retry', async (platform, read) => {
      await setup(allConnected);
      service[read].mockReturnValue(throwError(disabled));
      select(platform);
      expect(el(`${platform}-connection-notice`)?.getAttribute('data-state')).toBe('metrics_disabled');

      service[read].mockReturnValue(throwError(unavailable));
      (el(`${platform}-refresh`) as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(el(`${platform}-connection-notice`)).toBeNull();
      expect(el(`${platform}-error`)).not.toBeNull();
      expect(el(`${platform}-error`)?.querySelector('button')?.textContent?.trim()).toBe('Retry');
    });

    it('shows the new error after switching away and back', async () => {
      await setup(allConnected);
      service['getMicrosoftMonitorData'].mockReturnValue(throwError(disabled));
      select('microsoft');
      expect(el('microsoft-connection-notice')?.getAttribute('data-state')).toBe('metrics_disabled');

      select('google');
      service['getMicrosoftMonitorData'].mockReturnValue(throwError(unavailable));
      select('microsoft');

      expect(el('microsoft-connection-notice')).toBeNull();
      expect(el('microsoft-error')).not.toBeNull();
    });
  });

  /**
   * The connection's Meta account need not be in USD, and campaign-service passes its amounts
   * unconverted without naming the currency (#3637 review). Those figures carry no `$`, as
   * Microsoft's do; the legacy (allowlisted, USD) Meta panel keeps its `$` exactly as before.
   */
  describe('Meta amounts', () => {
    const euroAccount = {
      accountLabel: 'CNCF Meta',
      pulledAt: '2026-10-13T00:00:00.000Z',
      dateRange: { mode: 'last_30_days' },
      campaigns: [
        {
          campaignId: '1',
          campaignName: 'KubeCon EU 2027 - Awareness',
          status: 'ACTIVE',
          totalBudget: 250,
          dailyBudget: 0,
          spend: 100,
          impressions: 9000,
          clicks: 90,
          ctr: 1,
          conversions: 3,
          pacingPct: 40,
          pacingLabel: 'normal',
          startDate: '2026-09-01',
          endDate: '',
        },
      ],
      accountTotals: { spend: 100, impressions: 9000, clicks: 90, conversions: 3, campaignCount: 1 },
      actionItems: [],
    };

    it("shows a non-USD connection's amounts without a $ and says they are in the account currency", async () => {
      await setup(allConnected);
      service['getMetaMonitorData'].mockReturnValue(of(euroAccount));
      select('meta');

      expect(text('meta-kpi-spend')).toBe('100.00');
      expect(text('meta-campaign-row-0')).toContain('250.00');
      expect(text('meta-campaign-row-0')).not.toContain('$');
      expect(text('meta-currency-note')).toBe("Spend and budgets are in the ad account's own currency.");
    });

    it("prints a connection's amounts in the currency campaign-service names, and drops the note", async () => {
      await setup(allConnected);
      service['getMetaMonitorData'].mockReturnValue(of({ ...euroAccount, currency: 'EUR' }));
      select('meta');

      expect(text('meta-kpi-spend')).toBe('€100.00');
      expect(text('meta-campaign-row-0')).toContain('€250.00');
      expect(text('meta-campaign-row-0')).not.toContain('$');
      expect(el('meta-currency-note')).toBeNull();
    });

    it('keeps the legacy Meta panel in dollars, with no currency note', async () => {
      await setup({ viaCampaignService: false, platforms: {} });
      service['getMetaMonitorData'].mockReturnValue(of(euroAccount));
      select('meta');

      expect(text('meta-kpi-spend')).toBe('$100.00');
      expect(text('meta-campaign-row-0')).toContain('$250.00');
      expect(el('meta-currency-note')).toBeNull();
    });

    it('keeps the legacy Meta panel in dollars even if its data names a currency', async () => {
      await setup({ viaCampaignService: false, platforms: {} });
      service['getMetaMonitorData'].mockReturnValue(of({ ...euroAccount, currency: 'EUR' }));
      select('meta');

      expect(text('meta-kpi-spend')).toBe('$100.00');
      expect(el('meta-currency-note')).toBeNull();
    });
  });

  describe('Microsoft Ads (report-backed)', () => {
    it("reads the connection's account and says how fresh the figures are", async () => {
      await setup(allConnected);
      select('microsoft');

      expect(service['getMicrosoftMonitorData']).toHaveBeenCalledWith('cncf', '187654321', 30);
      expect(options('microsoft-account-select')).toEqual(['187654321|CNCF Microsoft']);
      expect(text('microsoft-freshness')).toContain('Metrics as of');
      expect(text('microsoft-freshness')).toContain('covering 2026-09-13 → 2026-10-12');
      expect(text('microsoft-freshness')).not.toContain('newer report');
      expect(text('microsoft-campaign-pacing')).toBe('88% normal');
      expect(text('microsoft-campaign-conversions')).toBe('Not measured');
      expect(text('microsoft-kpi-conversions')).toBe('Not measured');
    });

    it('says a newer report is building when one is', async () => {
      await setup(allConnected);
      service['getMicrosoftMonitorData'].mockReturnValue(of(reportBacked({ metricsPending: true })));
      select('microsoft');

      expect(text('microsoft-freshness')).toContain('A newer report is building');
    });

    it('explains the first report is building, and marks every row "Couldn\'t read" with dashes', async () => {
      await setup(allConnected);
      const unread = reportBacked().campaigns.map((c) => ({ ...c, fetchFailed: true, pacingLabel: undefined, spend: 0 }));
      service['getMicrosoftMonitorData'].mockReturnValue(
        of(reportBacked({ campaigns: unread, metricsAsOf: null, metricsWindowStart: null, metricsWindowEnd: null, metricsPending: true }))
      );
      select('microsoft');

      expect(text('microsoft-freshness')).toContain('The first report for this account is building');
      expect(text('microsoft-campaign-fetch-failed')).toBe("Couldn't read");
      expect(text('microsoft-campaign-pacing')).toBe('—');
      expect(text('microsoft-totals-note')).toBe('Totals may understate: 1 of 1 campaigns could not be fully read.');
    });

    it("shows a dash, not 0.00, for a failed row's unreadable budget", async () => {
      await setup(allConnected);
      const unread = reportBacked().campaigns.map((c) => ({ ...c, fetchFailed: true, pacingLabel: undefined, spend: 0, totalBudget: 0, dailyBudget: 0 }));
      service['getMicrosoftMonitorData'].mockReturnValue(of(reportBacked({ campaigns: unread })));
      select('microsoft');

      expect(text('microsoft-campaign-budget')).toBe('—');
    });

    it("formats a read row's budget in the account's currency", async () => {
      await setup(allConnected);
      select('microsoft');

      expect(text('microsoft-campaign-budget')).toBe('100.00');
    });

    it('shows "Unknown" for pacing it could not compute', async () => {
      await setup(allConnected);
      const unknown = reportBacked().campaigns.map((c) => ({ ...c, pacingUnknown: true, pacingLabel: undefined, pacingPct: 0 }));
      service['getMicrosoftMonitorData'].mockReturnValue(of(reportBacked({ campaigns: unknown })));
      select('microsoft');

      expect(text('microsoft-campaign-pacing')).toBe('Unknown');
    });

    it('says when the project has no Microsoft connection, without reading', async () => {
      await setup({ ...allConnected, platforms: { ...allConnected.platforms, microsoft: none('no_connection') } });
      select('microsoft');

      expect(text('microsoft-connection-notice-title')).toBe('No Microsoft Ads connection for this project');
      expect(service['getMicrosoftMonitorData']).not.toHaveBeenCalled();
    });

    it.each([
      ['monitor-act-toggle-1', 'pause_resume', 'Pause or resume: KubeCon NA 2026 - Search'],
      ['monitor-act-budget-1', 'budget', 'Budget: KubeCon NA 2026 - Search'],
      ['monitor-act-bid-1', 'bid', 'Bid: KubeCon NA 2026 - Search'],
    ])("offers %s on a Microsoft row, opening the act dialog with Microsoft's campaign id", async (testId, lever, header) => {
      await setup(allConnected);
      select('microsoft');

      expect(el('monitor-act-microsoft-ads-1')).not.toBeNull();
      (fixture.nativeElement.querySelector(`[data-testid="${testId}"] button`) as HTMLButtonElement).click();

      expect(TestBed.inject(DialogService).open).toHaveBeenCalledWith(
        CampaignActDialogComponent,
        expect.objectContaining({
          header,
          data: { projectSlug: 'cncf', platform: 'microsoft-ads', platformCampaignId: '1', campaignName: 'KubeCon NA 2026 - Search', lever },
        })
      );
    });

    it.each([
      ['monitor-act-toggle-1a2b3c', 'pause_resume', 'Pause or resume: KubeCon NA 2026 - Search'],
      ['monitor-act-budget-1a2b3c', 'budget', 'Budget: KubeCon NA 2026 - Search'],
      ['monitor-act-bid-1a2b3c', 'bid', 'Bid: KubeCon NA 2026 - Search'],
    ])("offers %s on an X row, opening the act dialog with X's campaign id", async (testId, lever, header) => {
      await setup(allConnected);
      const xRows = reportBacked().campaigns.map((c) => ({ ...c, campaignId: '1a2b3c' }));
      service['getTwitterMonitorData'].mockReturnValue(of(reportBacked({ campaigns: xRows })));
      select('twitter');

      expect(service['getTwitterMonitorData']).toHaveBeenCalled();
      expect(el('monitor-act-twitter-ads-1a2b3c')).not.toBeNull();
      (fixture.nativeElement.querySelector(`[data-testid="${testId}"] button`) as HTMLButtonElement).click();

      expect(TestBed.inject(DialogService).open).toHaveBeenCalledWith(
        CampaignActDialogComponent,
        expect.objectContaining({
          header,
          data: { projectSlug: 'cncf', platform: 'twitter-ads', platformCampaignId: '1a2b3c', campaignName: 'KubeCon NA 2026 - Search', lever },
        })
      );
    });
  });

  /**
   * The date range lives on the Google panel. Changing it there must not leave the Microsoft/X or
   * HubSpot figures of the OLD window on screen when the user switches back: those panels show
   * their loading state until the new window's read lands.
   */
  /**
   * The picker source or the bound account changing (#2519 review). Figures read for the previous
   * account, and reads still running for it, must never show under the new one — on the visible
   * panel or on one switched to later — and a late legacy account list must not replace the
   * connection's accounts.
   */
  describe('source and account changes', () => {
    function adPanel(name: string): Record<string, unknown> {
      return {
        accountLabel: 'LF',
        pulledAt: '2026-10-13T00:00:00.000Z',
        dateRange: { mode: 'last_30_days' },
        campaigns: [
          {
            campaignId: name,
            campaignName: name,
            eventName: name,
            creatives: [],
            status: 'ACTIVE',
            totalBudget: 1000,
            dailyBudget: 0,
            spend: 10,
            impressions: 100,
            clicks: 5,
            ctr: 5,
            conversions: 1,
            pacingPct: 50,
            pacingLabel: 'normal',
            startDate: '2026-09-01',
            endDate: '',
          },
        ],
        accountTotals: { spend: 10, impressions: 100, clicks: 5, conversions: 1, campaignCount: 1 },
        actionItems: [],
      };
    }

    const reloadConnections = (): void => {
      (fixture.componentInstance as unknown as { loadMonitorConnections(): void }).loadMonitorConnections();
      fixture.detectChanges();
    };

    const rebound: CampaignMonitorConnections = {
      ...allConnected,
      platforms: { ...allConnected.platforms, linkedin: connected('700000002', 'CNCF LinkedIn B'), reddit: connected('t2_cncf_b') },
    };

    it("drops account A's figures when the connection is rebound to B, and shows B's loading state", async () => {
      await setup(allConnected);
      service['getLinkedInMonitorData'].mockReturnValue(of(adPanel('Account A campaign')));
      select('linkedin');
      expect(text('linkedin-campaign-row-0')).toContain('Account A campaign');

      const accountB = new Subject<unknown>();
      service['getLinkedInMonitorData'].mockReturnValue(accountB);
      service['getMonitorConnections'].mockReturnValue(of(rebound));
      reloadConnections();

      expect(el('linkedin-campaign-row-0')).toBeNull();
      expect(el('linkedin-loading')).not.toBeNull();
      expect(options('linkedin-account-select')).toEqual(['700000002|CNCF LinkedIn B']);
      expect(service['getLinkedInMonitorData']).toHaveBeenLastCalledWith('cncf', '700000002', 30, 'connection');

      accountB.next(adPanel('Account B campaign'));
      fixture.detectChanges();
      expect(text('linkedin-campaign-row-0')).toContain('Account B campaign');
    });

    /**
     * The audience section is project-scoped (it does not follow the selected ad account) and keeps
     * its own state inside its component, so a rebind leaves it alone: still rendered, not re-read.
     */
    it('leaves the project-scoped audience section alone on a rebind', async () => {
      await setup(allConnected);
      select('linkedin');
      const audienceReads = service['getPlatformAudience'].mock.calls.length;
      expect(el('monitoring-paid-audience')).not.toBeNull();

      service['getMonitorConnections'].mockReturnValue(of(rebound));
      reloadConnections();

      expect(el('monitoring-paid-audience')).not.toBeNull();
      expect(service['getPlatformAudience'].mock.calls.length).toBe(audienceReads);
    });

    it("ignores account A's read when it lands after the rebind to B", async () => {
      await setup(allConnected);
      const accountA = new Subject<unknown>();
      service['getLinkedInMonitorData'].mockReturnValue(accountA);
      select('linkedin');

      const accountB = new Subject<unknown>();
      service['getLinkedInMonitorData'].mockReturnValue(accountB);
      service['getMonitorConnections'].mockReturnValue(of(rebound));
      reloadConnections();
      accountA.next(adPanel('Account A campaign'));
      fixture.detectChanges();

      expect(el('linkedin-campaign-row-0')).toBeNull();
      expect(el('linkedin-loading')).not.toBeNull();
    });

    it("drops an inactive panel's old figures too, so switching to it shows loading, not account A", async () => {
      await setup(allConnected);
      service['getRedditMonitorData'].mockReturnValue(of(adPanel('Reddit account A campaign')));
      select('reddit');
      expect(text('reddit-campaign-row-0')).toContain('Reddit account A campaign');
      select('google');

      service['getMonitorConnections'].mockReturnValue(of(rebound));
      reloadConnections();
      service['getRedditMonitorData'].mockReturnValue(new Subject<unknown>());
      select('reddit');

      expect(el('reddit-campaign-row-0')).toBeNull();
      expect(el('reddit-loading')).not.toBeNull();
    });

    it('clears the figures on a rollback to the legacy path, even when the legacy list is empty', async () => {
      await setup(allConnected);
      service['getLinkedInMonitorData'].mockReturnValue(of(adPanel('Connection account campaign')));
      select('linkedin');
      expect(el('linkedin-campaign-row-0')).not.toBeNull();

      service['getMonitorConnections'].mockReturnValue(of({ viaCampaignService: false, platforms: {} }));
      service['getLinkedInAccounts'].mockReturnValue(of([]));
      reloadConnections();

      expect(el('linkedin-campaign-row-0')).toBeNull();
      expect(el('linkedin-loading')).toBeNull();
      expect(options('linkedin-account-select')).toEqual([]);
    });

    it('ignores a legacy account list that lands after the connection path took over', async () => {
      const lateLinkedIn = new Subject<unknown>();
      const lateReddit = new Subject<unknown>();
      const lateMeta = new Subject<unknown>();
      await setup({ viaCampaignService: false, platforms: {} });
      // The first (flag-off) load already subscribed to the stub's immediate lists; make the next
      // load's lists slow, then switch to the connection path while they are still in flight.
      service['getLinkedInAccounts'].mockReturnValue(lateLinkedIn);
      service['getRedditAccounts'].mockReturnValue(lateReddit);
      service['getMetaAccounts'].mockReturnValue(lateMeta);
      reloadConnections();
      service['getMonitorConnections'].mockReturnValue(of(allConnected));
      reloadConnections();

      lateLinkedIn.next([{ accountId: '512345678', label: 'LF LinkedIn (legacy)', orgId: '1' }]);
      lateReddit.next([{ key: 't2_legacy', label: 'LF Reddit (legacy)' }]);
      lateMeta.next([{ key: 'act_1', label: 'LF Meta (legacy)' }]);
      fixture.detectChanges();

      select('linkedin');
      expect(options('linkedin-account-select')).toEqual(['700000001|CNCF LinkedIn']);
      select('reddit');
      expect(options('reddit-account-select')).toEqual(['t2_cncf|t2_cncf']);
      select('meta');
      expect(options('meta-account-select')).toEqual(['act_700000001|CNCF Meta']);
    });
  });

  describe('Microsoft amounts and timestamps', () => {
    /** campaign-service reports Microsoft/X amounts unconverted and does not name the currency. */
    it('shows spend and budgets without a $ and says they are in the account currency', async () => {
      await setup(allConnected);
      select('microsoft');

      expect(text('microsoft-kpi-strip')).toContain('412.50');
      expect(text('microsoft-kpi-strip')).not.toContain('$');
      expect(text('microsoft-campaign-row-0')).not.toContain('$');
      expect(text('microsoft-campaign-row-0')).toContain('100.00');
      expect(text('microsoft-currency-note')).toBe("Spend and budgets are in the ad account's own currency.");
    });

    it('prints spend and budgets in the currency campaign-service names, and drops the note', async () => {
      await setup(allConnected);
      service['getMicrosoftMonitorData'].mockReturnValue(of(reportBacked({ currency: 'EUR' })));
      select('microsoft');

      expect(text('microsoft-kpi-strip')).toContain('€412.50');
      expect(text('microsoft-campaign-row-0')).toContain('€100.00');
      expect(text('microsoft-kpi-strip')).not.toContain('$');
      expect(el('microsoft-currency-note')).toBeNull();
    });

    it("uses the named currency's own minor units", async () => {
      await setup(allConnected);
      service['getMicrosoftMonitorData'].mockReturnValue(of(reportBacked({ currency: 'JPY' })));
      select('microsoft');

      expect(text('microsoft-kpi-strip')).toContain('¥413');
      expect(text('microsoft-kpi-strip')).not.toContain('¥412.50');
      expect(el('microsoft-currency-note')).toBeNull();
    });

    it('formats the freshness and "Last pulled" times in en-US, whatever the browser locale', async () => {
      const spy = vi.spyOn(Date.prototype, 'toLocaleString');
      try {
        await setup(allConnected);
        select('microsoft');
        select('hubspot');

        expect(spy).toHaveBeenCalled();
        for (const call of spy.mock.calls) {
          expect(call[0]).toBe('en-US');
        }
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('date-range change', () => {
    it.each([
      ['hubspot', 'getHubSpotMonitorData', 'hubspot-email-table', 'hubspot-loading'],
      ['microsoft', 'getMicrosoftMonitorData', 'microsoft-campaign-table', 'microsoft-loading'],
    ])('drops the old window of %s and shows its loading state instead', async (platform, method, table, loading) => {
      await setup(allConnected);
      select(platform);
      expect(el(table)).not.toBeNull();

      select('google');
      (el('monitoring-range-7') as HTMLButtonElement).click();
      fixture.detectChanges();
      const pending = new Subject<unknown>();
      service[method].mockReturnValue(pending);
      select(platform);

      expect(el(table)).toBeNull();
      expect(el(loading)).not.toBeNull();
      expect(service[method]).toHaveBeenLastCalledWith(...(platform === 'hubspot' ? ['cncf', 7] : ['cncf', '187654321', 7]));
    });
  });

  describe('paid panel table headers and Retry names', () => {
    it.each([
      ['linkedin', 'getLinkedInMonitorData', 'LinkedIn Ads'],
      ['reddit', 'getRedditMonitorData', 'Reddit Ads'],
      ['meta', 'getMetaMonitorData', 'Meta Ads'],
      ['microsoft', 'getMicrosoftMonitorData', 'Microsoft Ads'],
    ] as const)('names what the %s Retry retries', async (platform, read, label) => {
      await setup(allConnected);
      service[read].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { error: 'boom' } })));
      select(platform);

      expect(el(`${platform}-retry`)?.getAttribute('aria-label')).toBe(`Retry loading ${label} campaigns`);
    });

    it('scopes every paid table header to its column', async () => {
      await setup(allConnected);
      select('microsoft');

      const headers = Array.from(el('microsoft-campaign-table')?.querySelectorAll('th') ?? []);
      expect(headers.length).toBeGreaterThan(0);
      expect(headers.every((th) => th.getAttribute('scope') === 'col')).toBe(true);
    });
  });

  describe('screen-reader read status', () => {
    const live = (): string => text('monitoring-ad-panel-live');

    it('keeps one persistent polite live region, empty on the Google panel', async () => {
      await setup(allConnected);

      const region = el('monitoring-ad-panel-live');
      expect(region?.getAttribute('role')).toBe('status');
      expect(region?.getAttribute('aria-live')).toBe('polite');
      expect(live()).toBe('');
    });

    it('announces a read in flight, then what the panel shows, in the same region', async () => {
      await setup(allConnected);
      const region = el('monitoring-ad-panel-live');
      const reply = new Subject<ReportBackedMonitorResponse>();
      service['getMicrosoftMonitorData'].mockReturnValue(reply);
      select('microsoft');

      expect(live()).toBe('Loading Microsoft Ads campaigns');

      reply.next(reportBacked());
      reply.complete();
      fixture.detectChanges();

      expect(el('monitoring-ad-panel-live')).toBe(region);
      expect(live()).toBe('Microsoft Ads: 1 campaign shown.');
    });

    it("adds the totals-coverage note when some rows couldn't be read", async () => {
      await setup(allConnected);
      const campaigns = reportBacked().campaigns;
      service['getMicrosoftMonitorData'].mockReturnValue(
        of(reportBacked({ campaigns: [...campaigns, { ...campaigns[0], campaignId: '2', fetchFailed: true, pacingLabel: undefined }] }))
      );
      select('microsoft');

      expect(live()).toBe('Microsoft Ads: 2 campaigns shown. Totals may understate: 1 of 2 campaigns could not be fully read.');
    });

    it('says when the account has no campaigns', async () => {
      await setup(allConnected);
      service['getMicrosoftMonitorData'].mockReturnValue(of(reportBacked({ campaigns: [] })));
      select('microsoft');

      expect(live()).toBe('No Microsoft Ads campaigns found for this account.');
    });

    const legacyPanel = (campaigns: Record<string, unknown>[]): Record<string, unknown> => ({
      accountLabel: 'LF',
      pulledAt: '2026-10-13T00:00:00.000Z',
      dateRange: { mode: 'last_30_days' },
      campaigns,
      accountTotals: { spend: 10, impressions: 100, clicks: 5, conversions: 1, campaignCount: campaigns.length },
      actionItems: [],
    });
    const legacyRow = (name: string): Record<string, unknown> => ({
      campaignId: name,
      campaignName: name,
      eventName: name,
      creatives: [],
      status: 'ACTIVE',
      totalBudget: 1000,
      dailyBudget: 0,
      spend: 10,
      impressions: 100,
      clicks: 5,
      ctr: 5,
      conversions: 1,
      pacingPct: 50,
      pacingLabel: 'normal',
      startDate: '2026-09-01',
      endDate: '',
    });

    it.each([
      ['linkedin', 'getLinkedInMonitorData', 'LinkedIn'],
      ['reddit', 'getRedditMonitorData', 'Reddit'],
      ['meta', 'getMetaMonitorData', 'Meta'],
    ])('announces what the %s panel shows, and its empty state in the visible wording', async (platform, method, label) => {
      await setup(allConnected);
      service[method].mockReturnValue(of(legacyPanel([legacyRow('A'), legacyRow('B')])));
      select(platform);

      expect(live()).toBe(`${label}: 2 campaigns shown.`);

      service[method].mockReturnValue(of(legacyPanel([])));
      (el(`${platform}-refresh`) as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(live()).toBe(`No active ${label} campaigns found for this account.`);
    });

    it('says nothing while the panel shows a connection notice instead of a read', async () => {
      await setup({ ...allConnected, platforms: { ...allConnected.platforms, reddit: none('no_connection') } });
      select('reddit');

      expect(el('reddit-connection-notice')).not.toBeNull();
      expect(live()).toBe('');
    });

    it('leaves a failed read to the role="alert" error block, so it is announced once', async () => {
      await setup(allConnected);
      service['getRedditMonitorData'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
      select('reddit');

      expect(el('reddit-error')?.getAttribute('role')).toBe('alert');
      expect(live()).toBe('');
    });
  });

  describe('platform buttons', () => {
    /**
     * Selected colours come from MONITOR_PLATFORM_BUTTON_COLORS (whose own spec checks every ratio):
     * white fails AA on Google, Reddit, Meta, Microsoft and HubSpot, so those take gray-950; LinkedIn
     * and X keep white.
     */
    it.each([
      ['google', 'text-gray-950'],
      ['linkedin', 'text-white'],
      ['reddit', 'text-gray-950'],
      ['meta', 'text-gray-950'],
      ['microsoft', 'text-gray-950'],
      ['hubspot', 'text-gray-950'],
    ])('selects %s with %s on its brand colour', async (platform, textClass) => {
      await setup(allConnected);
      select(platform);

      const button = el(`platform-${platform}`) as HTMLElement;
      expect(button.className).toContain(textClass);
      expect(button.className).not.toContain(textClass === 'text-white' ? 'text-gray-950' : 'text-white');
      expect(button.style.backgroundColor).not.toBe('');
      expect((el('platform-google') as HTMLElement).style.backgroundColor === '').toBe(platform !== 'google');
    });
  });

  /** The original panels render precomputed view models; these pin that the formatting is unchanged. */
  describe('original panels from view models', () => {
    const googleMonitor = {
      pulledAt: '2026-08-28T00:00:00.000Z',
      dateRange: { mode: 'LAST_30_DAYS' },
      campaigns: [
        {
          name: 'NA | KubeCon | Search',
          shortName: 'Search',
          eventName: 'KubeCon',
          adFormat: 'Search',
          targeting: 'Global',
          status: 'enabled',
          startDate: '2026-08-01',
          endDate: '2026-09-01',
          budgetDay: 100,
          totalBudget: 3000,
          spend: 1234.5,
          impressions: 15000,
          clicks: 400,
          ctr: 2.67,
          avgCpc: 0.42,
          conversions: 12,
          pacingPct: 140,
          pacingLabel: 'overspending',
          campaignId: '555',
          googleAdsUrl: '',
        },
      ],
      accountTotals: { impressions: 15000, clicks: 400, spend: 1234.5, conversions: 12 },
      actionItems: [],
    };
    const keywords = {
      pulledAt: '2026-08-28T00:00:00.000Z',
      days: 30,
      totalKeywords: 1,
      truncated: false,
      totals: { impressions: 1000, clicks: 40, spend: 25, conversions: 3, avgCtr: 4 },
      keywords: [
        {
          keyword: 'kubecon tickets',
          matchType: 'EXACT',
          qualityScore: null,
          status: 'ENABLED',
          adGroup: 'AG',
          adGroupId: '1',
          criterionId: '2',
          campaign: 'NA | KubeCon | Search',
          campaignId: '555',
          googleAdsUrl: '',
          impressions: 1000,
          clicks: 40,
          ctr: 4,
          avgCpc: 0.625,
          spend: 25,
          conversions: 3,
        },
      ],
    };

    it('renders the Google KPIs, campaign row and keyword row as before', async () => {
      await setup({ viaCampaignService: false, platforms: {} });
      service['getMonitorData'].mockReturnValue(of(googleMonitor));
      service['getKeywords'].mockReturnValue(of(keywords));
      (el('monitoring-range-7') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(text('monitoring-kpi-impressions')).toBe('15,000');
      expect(text('monitoring-kpi-ctr')).toBe('2.7%');
      expect(text('monitoring-kpi-spend')).toBe('$1,234.50');
      const row = text('monitoring-campaign-row-0');
      expect(row).toContain('KubeCon');
      expect(row).toContain('Aug 1, 2026');
      expect(row).toContain('$0.42');
      expect(row).toContain('140%');
      const bar = el('monitoring-campaign-row-0')?.querySelector('.h-full') as HTMLElement;
      expect(bar.style.width).toBe('100%');
      expect(bar.className).toContain('bg-red-500');
      const kw = text('keyword-row-0');
      expect(kw).toContain('kubecon tickets');
      expect(kw).toContain('–');
      expect(kw).toContain('$0.63');
      expect(el('keyword-row-0')?.querySelector('.bg-blue-100')?.textContent?.trim()).toBe('EXACT');
      expect(text('keyword-totals')).toContain('$25.00');
    });

    /**
     * Each LinkedIn row's heading, subtitle and creative count come from that row's OWN campaign.
     * The rows are built from the campaigns in one pass, so a reordered list (here a fetch-failed
     * campaign first, then a measured one) cannot pair a row with another campaign's figures.
     */
    it('builds each LinkedIn row from its own campaign, in the order they arrive', async () => {
      await setup(allConnected);
      const base = {
        status: 'ACTIVE',
        totalBudget: 1000,
        dailyBudget: 0,
        spend: 10,
        impressions: 100,
        clicks: 5,
        ctr: 5,
        conversions: 1,
        pacingPct: 50,
        pacingLabel: 'normal',
        startDate: '2026-09-01',
        endDate: '',
      };
      service['getLinkedInMonitorData'].mockReturnValue(
        of({
          accountLabel: 'LF',
          pulledAt: '2026-10-13T00:00:00.000Z',
          dateRange: { mode: 'last_30_days' },
          campaigns: [
            {
              ...base,
              campaignId: '2',
              campaignName: 'B | Event B | Retarget',
              eventName: 'Event B',
              creatives: [],
              creativesMeasured: false,
              fetchFailed: true,
            },
            { ...base, campaignId: '1', campaignName: 'A | Event A | Awareness', eventName: 'Event A', creatives: [{}, {}, {}] },
          ],
          accountTotals: { spend: 20, impressions: 200, clicks: 10, conversions: 2, campaignCount: 2 },
          actionItems: [],
        })
      );
      select('linkedin');

      const first = text('linkedin-campaign-row-0');
      const second = text('linkedin-campaign-row-1');
      expect(first).toContain('Event B');
      expect(first).toContain('B | Event B | Retarget');
      expect(first).toContain('Not read');
      expect(first).toContain("Couldn't read");
      expect(second).toContain('Event A');
      expect(second).toContain('A | Event A | Awareness');
      expect(el('linkedin-campaign-row-1')?.querySelector('[data-testid="linkedin-campaign-creatives"]')?.textContent?.trim()).toBe('3');
    });

    /** The report-backed rows always had a neutral status badge; an uppercase ACTIVE must not turn it green. */
    it('keeps the Microsoft status badge neutral, even for ACTIVE', async () => {
      await setup(allConnected);
      const active = reportBacked().campaigns.map((c) => ({ ...c, status: 'ACTIVE' }));
      service['getMicrosoftMonitorData'].mockReturnValue(of(reportBacked({ campaigns: active })));
      select('microsoft');

      const badge = el('microsoft-campaign-row-0')?.querySelectorAll('td')[1]?.querySelector('span') as HTMLElement;
      expect(badge.textContent?.trim()).toBe('ACTIVE');
      expect(badge.className).toContain('bg-gray-100');
      expect(badge.className).not.toContain('bg-green-50');
    });

    it("keeps LinkedIn's whole units and the other panels' two decimals", async () => {
      await setup(allConnected);
      const legacy = {
        accountLabel: 'LF',
        pulledAt: '2026-10-13T00:00:00.000Z',
        dateRange: { mode: 'last_30_days' },
        campaigns: [
          {
            campaignId: '1',
            campaignName: 'NA | KubeCon NA 2026 | Awareness',
            eventName: 'KubeCon NA 2026',
            creatives: [{}, {}],
            status: 'ACTIVE',
            totalBudget: 1000,
            dailyBudget: 0,
            spend: 412.5,
            impressions: 52000,
            clicks: 610,
            ctr: 1.17,
            conversions: 14,
            pacingPct: 88,
            pacingLabel: 'normal',
            startDate: '2026-09-01',
            endDate: '',
          },
        ],
        accountTotals: { spend: 412.5, impressions: 52000, clicks: 610, conversions: 14, campaignCount: 1 },
        actionItems: [],
      };
      service['getLinkedInMonitorData'].mockReturnValue(of(legacy));
      service['getRedditMonitorData'].mockReturnValue(of(legacy));
      select('linkedin');

      // The connection's LinkedIn account names no currency here: whole units, no `$`, and the note.
      // The note claims no currency: a campaign-service predating its local-currency read sends
      // USD (`costInUsd`) with no `currency` too, so "the account's own currency" could be false.
      expect(text('linkedin-kpi-spend')).toBe('413');
      expect(text('linkedin-campaign-row-0')).not.toContain('$');
      expect(text('linkedin-currency-note')).toBe('The ad account did not report its currency, so amounts are shown without a currency symbol.');
      expect(text('linkedin-currency-note')).not.toContain('own currency');
      const linkedInRow = text('linkedin-campaign-row-0');
      expect(linkedInRow).toContain('KubeCon NA 2026');
      expect(linkedInRow).toContain('NA | KubeCon NA 2026 | Awareness');
      expect(linkedInRow).toContain('2026-09-01 → Ongoing');
      expect(text('linkedin-campaign-creatives')).toBe('2');
      expect(el('linkedin-campaign-row-0')?.querySelector('.bg-green-50')?.textContent?.trim()).toBe('ACTIVE');

      select('reddit');
      expect(text('reddit-kpi-spend')).toBe('$412.50');
      expect(text('reddit-kpi-ctr')).toBe('1.2%');
      expect(el('reddit-campaign-creatives')).toBeNull();
    });

    /** Only campaign-service's path can name a currency; LinkedIn keeps its whole units in it. */
    it('prints LinkedIn and Reddit amounts in the currency campaign-service names', async () => {
      await setup(allConnected);
      const named = {
        accountLabel: 'CNCF',
        pulledAt: '2026-10-13T00:00:00.000Z',
        dateRange: { mode: 'last_30_days' },
        campaigns: [
          {
            campaignId: '1',
            campaignName: 'EU | KubeCon EU 2027 | Awareness',
            eventName: 'KubeCon EU 2027',
            creatives: [],
            creativesMeasured: false,
            status: 'ACTIVE',
            totalBudget: 1000,
            dailyBudget: 0,
            spend: 412.5,
            impressions: 52000,
            clicks: 610,
            ctr: 1.17,
            conversions: 14,
            pacingPct: 88,
            pacingLabel: 'normal',
            startDate: '2026-09-01',
            endDate: '',
          },
        ],
        accountTotals: { spend: 412.5, impressions: 52000, clicks: 610, conversions: 14, campaignCount: 1 },
        actionItems: [],
        currency: 'EUR',
      };
      service['getLinkedInMonitorData'].mockReturnValue(of(named));
      service['getRedditMonitorData'].mockReturnValue(of(named));
      select('linkedin');

      expect(text('linkedin-kpi-spend')).toBe('€413');
      expect(text('linkedin-campaign-row-0')).toContain('€1,000');
      expect(text('linkedin-campaign-row-0')).not.toContain('$');
      expect(el('linkedin-currency-note')).toBeNull();

      select('reddit');
      expect(text('reddit-kpi-spend')).toBe('€412.50');
      expect(text('reddit-campaign-row-0')).toContain('€1,000.00');
    });

    /** The legacy (flag-off) LinkedIn panel reads the allowlisted USD accounts: whole dollars, no note. */
    it('keeps the legacy LinkedIn panel in whole dollars, with no currency note', async () => {
      await setup({ viaCampaignService: false, platforms: {} });
      service['getLinkedInMonitorData'].mockReturnValue(
        of({
          accountLabel: 'LF',
          pulledAt: '2026-10-13T00:00:00.000Z',
          dateRange: { mode: 'last_30_days' },
          campaigns: [
            {
              campaignId: '1',
              campaignName: 'NA | KubeCon NA 2026 | Awareness',
              eventName: 'KubeCon NA 2026',
              creatives: [{}],
              status: 'ACTIVE',
              totalBudget: 1000,
              dailyBudget: 0,
              spend: 412.5,
              impressions: 52000,
              clicks: 610,
              ctr: 1.17,
              conversions: 14,
              pacingPct: 88,
              pacingLabel: 'normal',
              startDate: '2026-09-01',
              endDate: '',
            },
          ],
          accountTotals: { spend: 412.5, impressions: 52000, clicks: 610, conversions: 14, campaignCount: 1 },
          actionItems: [],
        })
      );
      select('linkedin');

      expect(text('linkedin-kpi-spend')).toBe('$413');
      expect(text('linkedin-campaign-row-0')).toContain('$1,000');
      expect(el('linkedin-currency-note')).toBeNull();
    });
  });

  describe('HubSpot email', () => {
    it('renders the counts, the rates, and an unknown rate as a dash', async () => {
      await setup(allConnected);
      select('hubspot');

      expect(service['getHubSpotMonitorData']).toHaveBeenCalledWith('cncf', 30);
      expect(text('hubspot-kpi-emails')).toBe('2');
      expect(text('hubspot-kpi-sent')).toBe('5,010');
      expect(text('hubspot-kpi-open-rate')).toBe('30.0% open rate');
      expect(text('hubspot-email-row-0')).toContain('KubeCon NA 2026 — registration open');
      const rates = fixture.nativeElement.querySelectorAll('[data-testid="hubspot-email-open-rate"]') as NodeListOf<HTMLElement>;
      expect(rates[0].textContent?.trim()).toBe('30.0%');
      expect(rates[1].textContent?.trim()).toBe('—');
      expect(rates[1].className).toContain('text-gray-500');
      expect(el('hubspot-email-ab-variant')).not.toBeNull();
      expect(text('hubspot-freshness')).toContain('Counters as of');
      expect(text('hubspot-coverage-note')).toBe('1 of 3 recorded emails had no send in this window.');
      expect(text('hubspot-action-item-0')).toContain('Staged draft: Sent but nothing delivered');
    });

    it('distinguishes "no emails recorded" from "none sent in the window"', async () => {
      await setup(allConnected);
      service['getHubSpotMonitorData'].mockReturnValue(of(hubspot({ emails: [], actionItems: [], metricsAsOf: null })));
      select('hubspot');
      expect(text('hubspot-empty')).toBe('This project has no HubSpot emails created through campaigns yet.');

      service['getHubSpotMonitorData'].mockReturnValue(of(hubspot({ emails: [], actionItems: [] })));
      (el('hubspot-refresh') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(text('hubspot-empty')).toBe('No HubSpot emails from this project were sent in the last 30 days.');
    });

    /**
     * No rows does not mean no sends when some recorded emails were skipped: an unreadable email,
     * or one beyond the 50-campaign cap, may have been sent in the window. Saying "no emails were
     * sent" there would state a fact nobody checked — and the note that says why must still show.
     */
    it.each([
      ['an unreadable email', { emailsUnattributable: 1, emailsTruncated: false }, '1 could not be read safely'],
      ['the 50-campaign cap', { emailsUnattributable: 0, emailsTruncated: true }, 'Only the 50 most recently recorded campaigns were checked'],
    ])('calls an empty answer incomplete, with the coverage note, after %s', async (_case, coverage, noteFragment) => {
      await setup(allConnected);
      service['getHubSpotMonitorData'].mockReturnValue(of(hubspot({ emails: [], actionItems: [], emailsNotSentInWindow: 0, ...coverage })));
      select('hubspot');

      expect(text('hubspot-empty')).toBe(
        'No sends were found in the last 30 days among the emails that could be checked, but the results are incomplete — see the note above.'
      );
      expect(text('hubspot-empty')).not.toContain('were sent in the last');
      expect(text('hubspot-coverage-note')).toContain(noteFragment);
    });

    it("says there is no HubSpot connection on the BFF's typed missing-connection 404", async () => {
      await setup(allConnected);
      service['getHubSpotMonitorData'].mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 404,
              error: { error: 'This project has no HubSpot connection of its own to read the account with.', upstreamCode: 'connection_not_found' },
            })
        )
      );
      select('hubspot');

      expect(el('hubspot-connection-notice')?.getAttribute('data-state')).toBe('no_connection');
      expect(text('hubspot-connection-notice-title')).toBe('No HubSpot connection');
      expect(el('hubspot-error')).toBeNull();
    });

    /** A gateway or routing 404 says nothing about the connection: a retryable error, never "No HubSpot connection". */
    it('shows any other 404 as a retryable error, without claiming the connection is absent', async () => {
      await setup(allConnected);
      service['getHubSpotMonitorData'].mockReturnValue(
        throwError(
          () => new HttpErrorResponse({ status: 404, error: { error: 'The HubSpot monitor could not be reached just now. Please try again shortly.' } })
        )
      );
      select('hubspot');

      expect(el('hubspot-connection-notice')).toBeNull();
      expect(text('hubspot-error')).toContain('The HubSpot monitor could not be reached just now.');
      expect(el('hubspot-error')?.querySelector('button')).not.toBeNull();
    });
  });
});

/**
 * Act from Monitor (#3299): a LinkedIn, Reddit or Meta row's actions open the act dialog with the
 * row's PLATFORM campaign id (the dialog resolves it before showing any lever), an adopt request
 * opens the adopt dialog, and a confirmed adoption reopens the act dialog on the same lever.
 */
describe.each([
  ['linkedin', 'linkedin-ads'],
  ['reddit', 'reddit-ads'],
  ['meta', 'meta-ads'],
] as const)('MonitoringTabComponent — %s row actions', (platform, platformId) => {
  let fixture: ComponentFixture<MonitoringTabComponent>;
  let open: ReturnType<typeof vi.fn>;
  let closes: Subject<unknown>[];
  let context: ReturnType<typeof signal<{ slug: string }>>;
  let toast: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    closes = [];
    context = signal({ slug: 'tlf' });
    toast = vi.fn();
    open = vi.fn(() => {
      const onClose = new Subject<unknown>();
      closes.push(onClose);
      return { onClose };
    });
    await TestBed.configureTestingModule({
      imports: [MonitoringTabComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: toast } },
        { provide: ProjectContextService, useValue: { activeContext: context } },
        { provide: DialogService, useValue: { open } },
        {
          provide: CampaignService,
          useValue: {
            getMonitorData: vi.fn().mockReturnValue(of(null)),
            getKeywords: vi.fn().mockReturnValue(of(null)),
            getAudience: vi.fn().mockReturnValue(of(null)),
            getPlatformAudience: vi.fn().mockReturnValue(of({ window: 'last_30_days', bucket_count: 0, buckets: [] })),
            getLinkedInAccounts: vi.fn().mockReturnValue(of([])),
            getRedditAccounts: vi.fn().mockReturnValue(of([])),
            getMetaAccounts: vi.fn().mockReturnValue(of([])),
            getGoogleAdsAccounts: vi.fn().mockReturnValue(of([])),
            getMonitorConnections: vi.fn().mockReturnValue(of({ viaCampaignService: false, platforms: {} })),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MonitoringTabComponent);
    fixture.detectChanges();
    const instance = fixture.componentInstance as unknown as Record<string, { set(v: unknown): void }>;
    instance['selectedPlatform'].set(platform);
    const data = {
      accountLabel: 'LF',
      pulledAt: '2026-10-13T00:00:00.000Z',
      dateRange: { mode: 'last_30_days' },
      campaigns: [
        {
          campaignId: '987654',
          campaignName: 'KubeCon NA 2026',
          eventName: 'KubeCon NA 2026',
          creatives: [],
          status: 'ACTIVE',
          totalBudget: 1000,
          dailyBudget: 0,
          spend: 10,
          impressions: 100,
          clicks: 1,
          ctr: 1,
          conversions: 0,
          pacingPct: 10,
          pacingLabel: 'normal',
          startDate: '2026-09-01',
          endDate: '2026-11-30',
        },
      ],
      accountTotals: { spend: 10, impressions: 100, clicks: 1, conversions: 0, campaignCount: 1 },
      actionItems: [],
    };
    ({ linkedin: instance['linkedInData'], reddit: instance['redditData'], meta: instance['metaData'] })[platform].set(data);
    fixture.detectChanges();
  });

  const click = (testId: string): void => {
    (fixture.nativeElement.querySelector(`[data-testid="${testId}"] button`) as HTMLButtonElement).click();
  };

  it.each([
    ['monitor-act-toggle-987654', 'pause_resume', 'Pause or resume: KubeCon NA 2026'],
    ['monitor-act-budget-987654', 'budget', 'Budget: KubeCon NA 2026'],
    ['monitor-act-bid-987654', 'bid', 'Bid: KubeCon NA 2026'],
  ])('%s opens the act dialog with the platform campaign id', (testId, lever, header) => {
    click(testId);

    expect(open).toHaveBeenCalledWith(
      CampaignActDialogComponent,
      expect.objectContaining({
        header,
        data: { projectSlug: 'tlf', platform: platformId, platformCampaignId: '987654', campaignName: 'KubeCon NA 2026', lever },
      })
    );
  });

  it('opens the adopt dialog on request, and reopens the act dialog once adopted', () => {
    click('monitor-act-bid-987654');
    closes[0].next({ adopt: true });

    expect(open).toHaveBeenLastCalledWith(
      CampaignAdoptDialogComponent,
      expect.objectContaining({ data: { projectSlug: 'tlf', platform: platformId, platformCampaignId: '987654', campaignName: 'KubeCon NA 2026' } })
    );

    closes[1].next(true);
    expect(open).toHaveBeenCalledTimes(3);
    expect(open).toHaveBeenLastCalledWith(CampaignActDialogComponent, expect.objectContaining({ data: expect.objectContaining({ lever: 'bid' }) }));
  });

  it('caps both dialogs to the viewport so they fit a phone', () => {
    click('monitor-act-bid-987654');
    closes[0].next({ adopt: true });

    for (const [, config] of open.mock.calls) {
      expect(config).toEqual(expect.objectContaining({ width: '36rem', style: expect.objectContaining({ maxWidth: '90vw' }) }));
    }
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('does nothing more when either dialog is simply closed', () => {
    click('monitor-act-budget-987654');
    closes[0].next(undefined);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('opens nothing when a dialog closes after the tab is destroyed', () => {
    click('monitor-act-bid-987654');
    fixture.destroy();
    closes[0].next({ adopt: true });

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('carries the project the flow started on, and does not reopen after a foundation switch', () => {
    click('monitor-act-budget-987654');
    closes[0].next({ adopt: true });
    expect(open.mock.calls[1][1].data.projectSlug).toBe('tlf');

    // Adopted under 'tlf', but the operator has since switched foundations.
    context.set({ slug: 'cncf' });
    closes[1].next(true);

    expect(open).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ detail: CAMPAIGN_ACT_FOUNDATION_CHANGED_MESSAGE }));
  });

  it('reopens against the captured project when the foundation is unchanged', () => {
    click('monitor-act-budget-987654');
    closes[0].next({ adopt: true });
    closes[1].next(true);

    expect(open).toHaveBeenCalledTimes(3);
    expect(open.mock.calls[2][1].data).toEqual(expect.objectContaining({ projectSlug: 'tlf', lever: 'budget' }));
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('MonitoringTabComponent — campaign-service audience by platform', () => {
  let fixture: ComponentFixture<MonitoringTabComponent>;
  const getPlatformAudience = vi.fn();

  beforeEach(async () => {
    getPlatformAudience.mockReset();
    getPlatformAudience.mockReturnValue(of({ window: 'last_30_days', bucket_count: 0, buckets: [] }));
    await TestBed.configureTestingModule({
      imports: [MonitoringTabComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: ProjectContextService, useValue: { activeContext: signal({ slug: 'tlf' }) } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        {
          provide: CampaignService,
          useValue: {
            getMonitorData: vi.fn().mockReturnValue(of(null)),
            getKeywords: vi.fn().mockReturnValue(of(null)),
            getAudience: vi.fn().mockReturnValue(of(null)),
            getPlatformAudience,
            getLinkedInAccounts: vi.fn().mockReturnValue(of([])),
            getRedditAccounts: vi.fn().mockReturnValue(of([])),
            getMetaAccounts: vi.fn().mockReturnValue(of([])),
            getGoogleAdsAccounts: vi.fn().mockReturnValue(of([])),
            getMonitorConnections: vi.fn().mockReturnValue(of({ viaCampaignService: false, platforms: {} })),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MonitoringTabComponent);
  });

  it.each(['google', 'linkedin', 'reddit', 'meta'] as const)(
    'shows the section, scoped to the active project, whichever monitor platform (%s) is picked',
    (platform) => {
      fixture.detectChanges();
      (fixture.componentInstance as unknown as { selectedPlatform: { set(v: string): void } }).selectedPlatform.set(platform);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="monitoring-paid-audience"]')).not.toBeNull();
      expect(getPlatformAudience).toHaveBeenCalledWith('tlf', 'meta-ads', 'last_30_days');
    }
  );
});

/**
 * lfx-self-serve-ops#54: the BFF refuses a non-root caller the Google, Reddit, Meta and X monitors
 * (and LinkedIn's legacy arm), because those ad accounts are shared by every foundation. The tab
 * shows that as a notice, not an error, and keeps Google's project-scoped keyword section.
 */
describe('MonitoringTabComponent — shared-account restriction', () => {
  let fixture: ComponentFixture<MonitoringTabComponent>;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let context: ReturnType<typeof signal<{ slug: string }>>;

  const restricted = (): HttpErrorResponse =>
    new HttpErrorResponse({ status: 403, error: { error: 'shared account', code: MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE } });
  const failed = (): HttpErrorResponse => new HttpErrorResponse({ status: 500, error: { error: 'boom', code: 'INTERNAL_ERROR' } });

  async function setup(connections: CampaignMonitorConnections): Promise<void> {
    context = signal({ slug: 'cncf' });
    service = {
      getMonitorData: vi.fn().mockReturnValue(of(null)),
      getKeywords: vi.fn().mockReturnValue(of(null)),
      getAudience: vi.fn().mockReturnValue(of(null)),
      getPlatformAudience: vi.fn().mockReturnValue(of({ window: 'last_30_days', bucket_count: 0, buckets: [] })),
      getLinkedInAccounts: vi.fn().mockReturnValue(of([{ accountId: '512345678', label: 'LF LinkedIn (legacy)', orgId: '1' }])),
      getRedditAccounts: vi.fn().mockReturnValue(of([{ key: 't2_legacy', label: 'LF Reddit (legacy)' }])),
      getMetaAccounts: vi.fn().mockReturnValue(of([{ key: 'act_1', label: 'LF Meta (legacy)' }])),
      getGoogleAdsAccounts: vi.fn().mockReturnValue(of([])),
      getLinkedInMonitorData: vi.fn().mockReturnValue(of(null)),
      getRedditMonitorData: vi.fn().mockReturnValue(of(null)),
      getMetaMonitorData: vi.fn().mockReturnValue(of(null)),
      getMicrosoftMonitorData: vi.fn().mockReturnValue(of(null)),
      getTwitterMonitorData: vi.fn().mockReturnValue(of(null)),
      getHubSpotMonitorData: vi.fn().mockReturnValue(of(null)),
      getMonitorConnections: vi.fn().mockReturnValue(of(connections)),
    };
    await TestBed.configureTestingModule({
      imports: [MonitoringTabComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: ProjectContextService, useValue: { activeContext: context } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: CampaignService, useValue: service },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MonitoringTabComponent);
  }

  const el = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  function select(platform: string): void {
    (el(`platform-${platform}`) as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  const flagOff: CampaignMonitorConnections = { viaCampaignService: false, platforms: {} };
  const flagOn: CampaignMonitorConnections = {
    viaCampaignService: true,
    platforms: { reddit: { state: 'connected', accountId: 't2_cncf', label: 't2_cncf' } },
  };

  it("shows Google's restricted notice in place of the error, and keeps the keyword section", async () => {
    await setup(flagOff);
    service['getMonitorData'].mockReturnValue(throwError(restricted));
    fixture.detectChanges();

    expect(el('monitoring-restricted')?.textContent).toContain('Google Ads monitoring is limited to LF administrators');
    expect(el('monitoring-error')).toBeNull();
    expect(el('keyword-performance')).not.toBeNull();
  });

  it('still shows the error block for any other Google failure', async () => {
    await setup(flagOff);
    service['getMonitorData'].mockReturnValue(throwError(failed));
    fixture.detectChanges();

    expect(el('monitoring-error')).not.toBeNull();
    expect(el('monitoring-restricted')).toBeNull();
    expect(el('monitoring-retry')).not.toBeNull();
  });

  // #4837: a role refusal answers 403 again on every retry, so the error offers no Retry.
  it('offers no Retry when the Google read is refused for the caller role', async () => {
    await setup(flagOn);
    service['getMonitorData'].mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 403, error: { error: "campaign-service refused to read this project's Google Ads connection." } }))
    );
    fixture.detectChanges();

    expect(el('monitoring-error')?.textContent).toContain('(HTTP 403)');
    expect(el('monitoring-retry')).toBeNull();
  });

  // #4526: the detail line names the status, so a guard's 403, a Google Ads 5xx and a dropped
  // connection no longer all read as the same generic "Failed to load campaign data".
  it.each([
    ['a 5xx, whose body is not read', failed, 'Failed to load campaign data (HTTP 500)'],
    [
      "a guard's 403, with the server's reason",
      () => new HttpErrorResponse({ status: 403, error: { error: 'campaign_manager access required for this resource', code: 'MARKETING_ACCESS_REQUIRED' } }),
      'campaign_manager access required for this resource (HTTP 403)',
    ],
    [
      'an authored Google Ads advisory',
      () =>
        new HttpErrorResponse({
          status: 502,
          error: { error: 'Google Ads did not return the account data. Google Ads error: QUOTA_EXCEEDED.', code: 'SERVICE_ADVISORY' },
        }),
      'Google Ads did not return the account data. Google Ads error: QUOTA_EXCEEDED. (HTTP 502)',
    ],
  ] as const)('names the HTTP status under the Google error for %s', async (_case, error, detail) => {
    await setup(flagOff);
    service['getMonitorData'].mockReturnValue(throwError(error));
    fixture.detectChanges();

    expect(el('monitoring-error')?.textContent).toContain(detail);
  });

  it.each([
    ['legacy (flag off)', flagOff],
    ['cutover (flag on)', flagOn],
  ] as const)('shows a restricted Reddit read as a notice on the %s path, and its Refresh reads the panel again', async (_path, connections) => {
    await setup(connections);
    service['getRedditMonitorData'].mockReturnValue(throwError(restricted));
    fixture.detectChanges();
    select('reddit');

    const notice = el('reddit-connection-notice');
    expect(notice?.getAttribute('data-state')).toBe('restricted');
    expect(el('reddit-connection-notice-title')?.textContent).toContain('monitoring is limited to LF administrators');
    expect(el('reddit-error')).toBeNull();

    const reads = service['getRedditMonitorData'].mock.calls.length;
    service['getRedditMonitorData'].mockReturnValue(of(null));
    (el('reddit-connection-notice-retry') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(service['getRedditMonitorData'].mock.calls.length).toBe(reads + 1);
    expect(el('reddit-connection-notice')).toBeNull();
  });

  const flagOnShared: CampaignMonitorConnections = {
    viaCampaignService: true,
    platforms: {
      meta: { state: 'connected', accountId: 'act_cncf', label: 'act_cncf' },
      twitter: { state: 'connected', accountId: '18ce54d4x5t', label: '18ce54d4x5t' },
    },
  };

  it.each([
    { panel: 'meta', read: 'getMetaMonitorData', path: 'legacy', connections: flagOff },
    { panel: 'meta', read: 'getMetaMonitorData', path: 'cutover', connections: flagOnShared },
    { panel: 'linkedin', read: 'getLinkedInMonitorData', path: 'legacy', connections: flagOff },
    { panel: 'twitter', read: 'getTwitterMonitorData', path: 'cutover', connections: flagOnShared },
  ] as const)('shows a restricted $panel read on the $path path as a notice, not an error', async ({ panel, read, connections }) => {
    await setup(connections);
    service[read].mockReturnValue(throwError(restricted));
    fixture.detectChanges();
    select(panel);

    expect(service[read]).toHaveBeenCalled();
    expect(el(`${panel}-connection-notice`)?.getAttribute('data-state')).toBe('restricted');
    expect(el(`${panel}-connection-notice-title`)?.textContent).toContain('monitoring is limited to LF administrators');
    expect(el(`${panel}-error`)).toBeNull();
  });

  it('clears the restricted states when the foundation changes', async () => {
    await setup(flagOff);
    service['getMonitorData'].mockReturnValue(throwError(restricted));
    service['getRedditMonitorData'].mockReturnValue(throwError(restricted));
    fixture.detectChanges();
    select('reddit');
    expect(el('reddit-connection-notice')?.getAttribute('data-state')).toBe('restricted');

    service['getMonitorData'].mockReturnValue(of(null));
    service['getRedditMonitorData'].mockReturnValue(of(null));
    context.set({ slug: 'tlf' });
    fixture.detectChanges();

    expect(el('reddit-connection-notice')).toBeNull();
    select('google');
    expect(el('monitoring-restricted')).toBeNull();
  });

  it('clears cached Google monitor data after a refusal so a pending retry cannot render it', async () => {
    await setup(flagOff);
    const payload = { campaigns: [], accountTotals: null, actionItems: [], dateRange: { mode: 'last_30_days' }, pulledAt: '2026-10-01T00:00:00Z' };
    service['getMonitorData'].mockReturnValue(of(payload));
    fixture.detectChanges();
    const instance = fixture.componentInstance as unknown as { refresh(): void; monitorData(): unknown };
    expect(instance.monitorData()).toEqual(payload);

    service['getMonitorData'].mockReturnValue(throwError(restricted));
    instance.refresh();
    fixture.detectChanges();
    expect(el('monitoring-restricted')).not.toBeNull();
    expect(instance.monitorData()).toBeNull();

    service['getMonitorData'].mockReturnValue(new Subject<never>());
    instance.refresh();
    fixture.detectChanges();
    expect(el('monitoring-loading')).not.toBeNull();
    expect(el('monitoring-kpis')).toBeNull();
  });

  it('shows a keyword restriction independently, clears cached keywords, and retries after grants change', async () => {
    await setup(flagOff);
    service['getMonitorData'].mockReturnValue(throwError(restricted));
    const keywords = { keywords: [], totalKeywords: 0, totals: { impressions: 0, clicks: 0, spend: 0, conversions: 0, avgCtr: 0 }, days: 30 };
    service['getKeywords'].mockReturnValue(of(keywords));
    fixture.detectChanges();
    const instance = fixture.componentInstance as unknown as { refresh(): void; keywordsData(): unknown };
    expect(instance.keywordsData()).toEqual(keywords);

    service['getKeywords'].mockReturnValue(throwError(restricted));
    instance.refresh();
    fixture.detectChanges();
    expect(el('keyword-restricted')?.textContent).toContain('keyword insights are limited to LF administrators');
    expect(el('keyword-error')).toBeNull();
    expect(el('keyword-empty')).toBeNull();
    expect(instance.keywordsData()).toBeNull();

    service['getKeywords'].mockReturnValue(new Subject<never>());
    instance.refresh();
    fixture.detectChanges();
    expect(el('keyword-restricted')).toBeNull();
    expect(el('keyword-loading')).not.toBeNull();

    service['getKeywords'].mockReturnValue(of(keywords));
    context.set({ slug: 'acme-foundation' });
    fixture.detectChanges();
    expect(el('keyword-restricted')).toBeNull();
    expect(el('keyword-empty')).not.toBeNull();
    expect(service['getKeywords']).toHaveBeenLastCalledWith('acme-foundation', 30);
  });
});
