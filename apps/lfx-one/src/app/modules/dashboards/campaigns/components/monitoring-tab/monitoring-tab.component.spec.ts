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
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
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
        {
          provide: CampaignService,
          useValue: {
            getMonitorData: vi.fn().mockReturnValue(of(null)),
            getKeywords: vi.fn().mockReturnValue(of(null)),
            getAudience: vi.fn().mockReturnValue(of(null)),
            getLinkedInAccounts: vi.fn().mockReturnValue(of([])),
            getRedditAccounts: vi.fn().mockReturnValue(of([])),
            getMetaAccounts: vi.fn().mockReturnValue(of([])),
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
      getLinkedInAccounts: vi.fn().mockReturnValue(of([{ accountId: '512345678', label: 'LF LinkedIn (legacy)', orgId: '1' }])),
      getRedditAccounts: vi.fn().mockReturnValue(of([{ key: 't2_legacy', label: 'LF Reddit (legacy)' }])),
      getMetaAccounts: vi.fn().mockReturnValue(of([{ key: 'act_1', label: 'LF Meta (legacy)' }])),
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
      expect(service['getLinkedInMonitorData']).toHaveBeenCalledWith('cncf', '512345678', 30, false);
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
      expect(service['getLinkedInMonitorData']).toHaveBeenCalledWith('cncf', '700000001', 30, true);

      select('meta');
      expect(options('meta-account-select')).toEqual(['act_700000001|CNCF Meta']);
      expect(service['getMetaMonitorData']).toHaveBeenCalledWith('cncf', 'act_700000001', 30, true);
    });

    it('offers Microsoft Ads and HubSpot, and keeps X hidden while the app disables it', async () => {
      await setup(allConnected);

      expect(el('platform-microsoft')).not.toBeNull();
      expect(el('platform-hubspot')).not.toBeNull();
      expect(el('platform-twitter')).toBeNull();
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

    it('re-reads the connections from the notice', async () => {
      await setup({ ...allConnected, platforms: { ...allConnected.platforms, linkedin: none('unavailable') } });
      select('linkedin');
      expect(text('linkedin-connection-notice-title')).toBe("Couldn't check the LinkedIn Ads connection");

      service['getMonitorConnections'].mockReturnValue(of(allConnected));
      (el('linkedin-connection-notice-retry') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(service['getMonitorConnections']).toHaveBeenCalledTimes(2);
      expect(el('linkedin-connection-notice')).toBeNull();
      expect(service['getLinkedInMonitorData']).toHaveBeenCalledWith('cncf', '700000001', 30, true);
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

    it('marks the monitor read as coming from the connection', async () => {
      await setup(allConnected);
      select('reddit');

      expect(service['getRedditMonitorData']).toHaveBeenCalledWith('cncf', 't2_cncf', 30, true);
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
      expect(service['getLinkedInMonitorData']).toHaveBeenLastCalledWith('cncf', '512345678', 30, false);
      expect(el('linkedin-error')).toBeNull();
      expect(options('linkedin-account-select')).toEqual(['512345678|LF LinkedIn (legacy)']);
    });

    it('falls back to the legacy lists when the connections read fails before the flag is known', async () => {
      await setup(new Error('network'));

      expect(service['getLinkedInAccounts']).toHaveBeenCalledWith('cncf');
      expect(el('platform-microsoft')).toBeNull();
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
      expect(text('microsoft-totals-note')).toBe('Totals cover 0 of 1 campaigns.');
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
      expect(service['getLinkedInMonitorData']).toHaveBeenLastCalledWith('cncf', '700000002', 30, true);

      accountB.next(adPanel('Account B campaign'));
      fixture.detectChanges();
      expect(text('linkedin-campaign-row-0')).toContain('Account B campaign');
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

  describe('platform buttons', () => {
    /** White on #00A4EF / #FF7A59 is under 3:1; gray-900 on them is over 6:1 (WCAG AA needs 4.5:1). */
    it.each(['microsoft', 'hubspot'])('selects %s with dark text, not white', async (platform) => {
      await setup(allConnected);
      select(platform);

      const button = el(`platform-${platform}`) as HTMLElement;
      expect(button.className).toContain('text-gray-900');
      expect(button.className).not.toContain('text-white');
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

    it('says there is no HubSpot connection on a 404', async () => {
      await setup(allConnected);
      service['getHubSpotMonitorData'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404, error: { error: 'Not found' } })));
      select('hubspot');

      expect(el('hubspot-connection-notice')?.getAttribute('data-state')).toBe('no_connection');
      expect(text('hubspot-connection-notice-title')).toBe('No HubSpot connection');
      expect(el('hubspot-error')).toBeNull();
    });
  });
});
