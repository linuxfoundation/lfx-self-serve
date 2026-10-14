// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { KeywordMetricsResponse } from '@lfx-one/shared/interfaces';
import { CAMPAIGN_ACT_FOUNDATION_CHANGED_MESSAGE } from '@lfx-one/shared/constants';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject } from 'rxjs';
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
            getLinkedInAccounts: vi.fn().mockReturnValue(of([])),
            getRedditAccounts: vi.fn().mockReturnValue(of([])),
            getMetaAccounts: vi.fn().mockReturnValue(of([])),
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
    expect(text(`${platform}-totals-note`)).toBe('Totals cover 1 of 2 campaigns.');
  });

  it('notes a conversions total that covers only some campaigns', () => {
    render([campaign({ campaignId: '1', conversionsMeasured: true }), campaign({ campaignId: '2', conversions: 0, conversionsMeasured: false })], {
      conversionsMeasured: true,
    });

    expect(text(`${platform}-totals-note`)).toBe('conversions cover 1 of 2 campaigns.');
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
            getLinkedInAccounts: vi.fn().mockReturnValue(of([])),
            getRedditAccounts: vi.fn().mockReturnValue(of([])),
            getMetaAccounts: vi.fn().mockReturnValue(of([])),
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
