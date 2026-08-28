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
