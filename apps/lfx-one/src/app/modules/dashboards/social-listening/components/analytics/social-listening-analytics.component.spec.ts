// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ANALYTICS_TOP_PROJECTS_LIMIT } from '@lfx-one/shared/constants';
import { SocialListeningService } from '@services/social-listening.service';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SocialListeningAnalyticsComponent } from './social-listening-analytics.component';

import type { MentionFilters, SocialListeningAnalyticsOverview } from '@lfx-one/shared/interfaces';

/**
 * Covers what the sibling specs can't see from the page: the six panel pipelines (request derivation,
 * independent loading/error degradation), the stat-card mapping, and the nonce-triggered PNG export
 * round-trip. Chart.js never renders here — the empty fixtures map to null chart data.
 */
describe('SocialListeningAnalyticsComponent', () => {
  const OVERVIEW: SocialListeningAnalyticsOverview = {
    TOTAL_MENTIONS: 1240,
    TOTAL_MENTIONS_CHANGE_PCT: 12.5,
    CHILD_PROJECTS_COUNT: 3,
    POSITIVE_SENTIMENT_PERCENT: 45,
    NEGATIVE_SENTIMENT_PERCENT: 20,
    POSITIVE_SENTIMENT_CHANGE_PCT: null,
    NEGATIVE_SENTIMENT_CHANGE_PCT: -4.2,
  };

  let fixture: ComponentFixture<SocialListeningAnalyticsComponent>;
  let getAnalyticsOverview: ReturnType<typeof vi.fn>;
  let getAnalyticsOverTime: ReturnType<typeof vi.fn>;
  let getAnalyticsPlatformDistribution: ReturnType<typeof vi.fn>;
  let getMentionsTags: ReturnType<typeof vi.fn>;
  let getAnalyticsSentimentDistribution: ReturnType<typeof vi.fn>;
  let getAnalyticsTopProjects: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;

  async function settle(): Promise<void> {
    // debounceTime(0) on the panel pipelines needs a macrotask turn.
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function create(inputs: { foundationSlug?: string; period?: string; filters?: MentionFilters } = {}): void {
    fixture = TestBed.createComponent(SocialListeningAnalyticsComponent);
    fixture.componentRef.setInput('foundationSlug', inputs.foundationSlug ?? 'cncf');
    fixture.componentRef.setInput('period', inputs.period ?? 'ytd');
    fixture.componentRef.setInput('filters', inputs.filters ?? {});
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();

    getAnalyticsOverview = vi.fn(() => of(OVERVIEW));
    // Empty fixtures map to null/[] panel data, so the chart branches never render in jsdom.
    getAnalyticsOverTime = vi.fn(() => of([]));
    getAnalyticsPlatformDistribution = vi.fn(() => of([]));
    getMentionsTags = vi.fn(() => of([]));
    getAnalyticsSentimentDistribution = vi.fn(() => of([]));
    getAnalyticsTopProjects = vi.fn(() => of([]));
    messageAdd = vi.fn();

    TestBed.configureTestingModule({
      imports: [SocialListeningAnalyticsComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: SocialListeningService,
          useValue: {
            getAnalyticsOverview,
            getAnalyticsOverTime,
            getAnalyticsPlatformDistribution,
            getMentionsTags,
            getAnalyticsSentimentDistribution,
            getAnalyticsTopProjects,
          },
        },
        { provide: MessageService, useValue: { add: messageAdd } },
      ],
    });
  });

  it('fires no requests until the page supplies a foundation and period', async () => {
    create({ foundationSlug: '', period: '' });
    await settle();

    expect(getAnalyticsOverview).not.toHaveBeenCalled();
    expect(getAnalyticsTopProjects).not.toHaveBeenCalled();
    expect(fixture.componentInstance.panelsLoading()).toBe(false);
  });

  it('fetches all six panels off the shared scope + predicate request', async () => {
    create({ filters: { sentiment: 'negative' } });
    await settle();

    const expected = expect.objectContaining({ foundationSlug: 'cncf', period: 'ytd', sentiment: 'negative' });
    expect(getAnalyticsOverview).toHaveBeenCalledWith(expected);
    expect(getAnalyticsOverTime).toHaveBeenCalledWith(expected);
    expect(getAnalyticsPlatformDistribution).toHaveBeenCalledWith(expected);
    expect(getMentionsTags).toHaveBeenCalledWith(expected);
    expect(getAnalyticsSentimentDistribution).toHaveBeenCalledWith(expected);
    // Top projects is the one panel that adds its own row cap.
    expect(getAnalyticsTopProjects).toHaveBeenCalledWith(
      expect.objectContaining({ foundationSlug: 'cncf', period: 'ytd', limit: ANALYTICS_TOP_PROJECTS_LIMIT })
    );
  });

  it('refetches every panel when the scope or feed predicate changes', async () => {
    create();
    await settle();

    fixture.componentRef.setInput('period', '2026-07');
    await settle();
    expect(getAnalyticsOverview).toHaveBeenLastCalledWith(expect.objectContaining({ period: '2026-07' }));
    expect(getAnalyticsOverview).toHaveBeenCalledTimes(2);

    fixture.componentRef.setInput('filters', { sentiment: 'negative' });
    await settle();
    expect(getAnalyticsOverview).toHaveBeenLastCalledWith(expect.objectContaining({ sentiment: 'negative' }));
    expect(getAnalyticsOverview).toHaveBeenCalledTimes(3);
  });

  it('degrades panels independently — one failure errors only its own panel', async () => {
    getAnalyticsSentimentDistribution.mockImplementation(() => throwError(() => new Error('boom')));
    create();
    await settle();

    expect(fixture.componentInstance.sentimentError()).toBe('Failed to load this panel');
    expect(fixture.componentInstance.sentimentRows()).toEqual([]);
    expect(fixture.componentInstance.overviewError()).toBeNull();
    expect(fixture.componentInstance.topProjectsError()).toBeNull();
    expect(fixture.componentInstance.statCards()[0].value).toBe('1,240');
  });

  it('maps the overview into stat cards with sub-line pluralization and delta rules', async () => {
    create();
    await settle();

    const cards = fixture.componentInstance.statCards();
    expect(cards.map((card) => card.label)).toEqual(['Total Mentions', 'Negative Sentiment', 'Positive Sentiment']);
    expect(cards[0].value).toBe('1,240');
    expect(cards[0].subLine).toBe('across 3 projects');
    expect(cards[0].delta).toEqual({ label: '+12.5% vs last period', direction: 'up', inverted: false });
    // Negative-sentiment deltas invert (an increase is bad); magnitude-only label, direction carries the sign.
    expect(cards[1].delta).toEqual({ label: '4.2% vs last period', direction: 'down', inverted: true });
    // A null change pct (empty previous window) hides the delta line entirely.
    expect(cards[2].delta).toBeUndefined();
  });

  it('singularizes the project sub-line and zeroes the cards without an overview', async () => {
    getAnalyticsOverview.mockReturnValue(of({ ...OVERVIEW, CHILD_PROJECTS_COUNT: 1 }));
    create();
    await settle();
    expect(fixture.componentInstance.statCards()[0].subLine).toBe('across 1 project');

    getAnalyticsOverview.mockReturnValue(of(null));
    fixture.componentRef.setInput('period', '2026-07');
    await settle();
    const cards = fixture.componentInstance.statCards();
    expect(cards[0].value).toBe('0');
    expect(cards[0].subLine).toBeUndefined();
    expect(cards[1].value).toBe('0%');
  });

  it('ranks the tag rows, drops blank tags, and sizes each bar against the top row', async () => {
    getMentionsTags.mockReturnValue(
      of([
        { TAG: 'cloud_native', TOTAL_COUNT: 5 },
        { TAG: '', TOTAL_COUNT: 99 },
        { TAG: 'ai_agents', TOTAL_COUNT: 10 },
      ])
    );
    create();
    await settle();

    expect(fixture.componentInstance.tagRows()).toEqual([
      { label: 'AI Agents', count: 10, percentOfMax: 100 },
      { label: 'Cloud Native', count: 5, percentOfMax: 50 },
    ]);
    const labels = [...fixture.nativeElement.querySelectorAll('[data-testid="social-listening-analytics-tags-list"] li')].map((li: Element) =>
      (li.textContent || '').trim()
    );
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('AI Agents');
    expect(labels[0]).toContain('10');
  });

  it('emits the normalized platform key when a platform row is clicked', async () => {
    getAnalyticsPlatformDistribution.mockReturnValue(
      of([
        { SOURCE_PLATFORM: 'reddit', SOCIAL_NETWORK: 'Reddit', MENTIONS_COUNT: 40, PERCENT_OF_TOTAL: 80 },
        { SOURCE_PLATFORM: 'X', SOCIAL_NETWORK: 'X', MENTIONS_COUNT: 10, PERCENT_OF_TOTAL: 20 },
      ])
    );
    create();
    await settle();

    const emitted: string[] = [];
    fixture.componentInstance.platformSelected.subscribe((platform) => emitted.push(platform));

    // `X` normalizes to the `twitter` config key, which is what the row carries and emits.
    const row = fixture.nativeElement.querySelector('[data-testid="social-listening-analytics-platform-row-twitter"]') as HTMLButtonElement;
    expect(row).toBeTruthy();
    row.click();

    expect(emitted).toEqual(['twitter']);
  });

  it('keeps the sentiment counts and percentages when the overview errors, omitting only the trend chips', async () => {
    getAnalyticsOverview.mockImplementation(() => throwError(() => new Error('boom')));
    getAnalyticsSentimentDistribution.mockReturnValue(
      of([
        { SENTIMENT: 'positive', MENTION_COUNT: 90, PERCENT_OF_TOTAL: 45 },
        { SENTIMENT: 'negative', MENTION_COUNT: 40, PERCENT_OF_TOTAL: 20 },
      ])
    );
    create();
    await settle();

    expect(fixture.componentInstance.overviewError()).toBe('Failed to load this panel');
    expect(fixture.componentInstance.sentimentTrends()).toEqual({ positive: null, negative: null });

    const panel = fixture.nativeElement.querySelector('[data-testid="social-listening-analytics-sentiment"]');
    expect(panel.textContent).toContain('45%');
    expect(panel.textContent).toContain('90');
    expect(panel.querySelector('[data-testid="social-listening-analytics-sentiment-trend-positive"]')).toBeNull();
    expect(panel.querySelector('[data-testid="social-listening-analytics-sentiment-trend-negative"]')).toBeNull();
  });

  it('renders the sentiment trend chips from the overview panel', async () => {
    getAnalyticsSentimentDistribution.mockReturnValue(
      of([
        { SENTIMENT: 'positive', MENTION_COUNT: 90, PERCENT_OF_TOTAL: 45 },
        { SENTIMENT: 'negative', MENTION_COUNT: 40, PERCENT_OF_TOTAL: 20 },
      ])
    );
    create();
    await settle();

    // A null POSITIVE_SENTIMENT_CHANGE_PCT (thin previous window) hides that chip; the negative one inverts.
    expect(fixture.componentInstance.sentimentTrends().positive).toBeNull();
    expect(fixture.componentInstance.sentimentTrends().negative).toEqual({ label: '4.2% vs last period', direction: 'down', inverted: true });

    const panel = fixture.nativeElement.querySelector('[data-testid="social-listening-analytics-sentiment"]');
    expect(panel.querySelector('[data-testid="social-listening-analytics-sentiment-trend-positive"]')).toBeNull();
    expect(panel.querySelector('[data-testid="social-listening-analytics-sentiment-trend-negative"]').className).toContain('text-emerald-700');
  });

  it('reports panelsLoading while any panel is in flight and clears it once all settle', async () => {
    const overview$ = new Subject<SocialListeningAnalyticsOverview>();
    getAnalyticsOverview.mockReturnValue(overview$.asObservable());
    create();
    await settle();

    expect(fixture.componentInstance.panelsLoading()).toBe(true);

    overview$.next(OVERVIEW);
    await settle();
    expect(fixture.componentInstance.panelsLoading()).toBe(false);
  });

  describe('export', () => {
    beforeEach(() => {
      // The component yields a frame before html-to-image blocks the main thread — keep that off the
      // synchronous scheduler path (a synchronous stub re-enters Angular's watch flush in zoneless tests).
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
      // The real downloadCardAsImage runs; jsdom has no canvas, so capture always fails here.
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('does not export on the initial nonce of 0', async () => {
      create();
      await settle();
      await settle();

      expect(fixture.componentInstance.isExporting()).toBe(false);
      expect(messageAdd).not.toHaveBeenCalled();
    });

    it('surfaces the failure toast and resets isExporting when the capture cannot run', async () => {
      create();
      await settle();

      fixture.componentRef.setInput('exportNonce', 1);
      await settle();
      await settle(); // the rAF stub's macrotask, then the export promise chain

      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Export Failed' }));
      expect(fixture.componentInstance.isExporting()).toBe(false);
    });
  });
});
