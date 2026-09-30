// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { HEALTH_METRICS_MEMBERS_NPS_UNMEASURED, lfxColors } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { isObservable, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { MembersNpsComponent } from './members-nps.component';

import type { ChartDataset } from 'chart.js';
import type { HealthMetricsMembersNps, HealthMetricsMembersNpsAudience, HealthMetricsMembersNpsQuarter } from '@lfx-one/shared/interfaces';

function audience(overrides: Partial<HealthMetricsMembersNpsAudience> = {}): HealthMetricsMembersNpsAudience {
  return {
    audience: 'Board',
    npsScore: 62,
    scoreChangePp: 4,
    recipientsCount: 26,
    responsesCount: 18,
    responseRatePct: 0.692,
    promotersCount: 11,
    passivesCount: 5,
    detractorsCount: 2,
    noResponseCount: 8,
    isSampleTooSmall: false,
    lastUpdatedQuarter: 'Q2 2026',
    ...overrides,
  };
}

function quarter(
  quarterStartDate: string,
  quarterLabel: string,
  npsScore: number | null,
  responseRatePct: number | null,
  isSampleTooSmall = false
): HealthMetricsMembersNpsQuarter {
  return { quarterStartDate, quarterLabel, npsScore, responseRatePct, isSampleTooSmall };
}

function response(overrides: Partial<HealthMetricsMembersNps> = {}): HealthMetricsMembersNps {
  return {
    audiences: [audience(), audience({ audience: 'Committers', npsScore: 40, scoreChangePp: -2 })],
    selectedAudience: 'Board',
    trend: [quarter('2025-10-01', 'Q4 25', 54, 0.71), quarter('2026-04-01', 'Q2 26', 62, 0.69)],
    ...overrides,
  };
}

describe('MembersNpsComponent', () => {
  let fixture: ComponentFixture<MembersNpsComponent>;
  let getMembersNps: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let selectedRange: ReturnType<typeof signal<string>>;
  let lifecycle: string[];

  // `payload` answers the first read; `followUpPayload` (a value or a stream) every read after it.
  async function render(
    payload: HealthMetricsMembersNps = response(),
    queryParams: Record<string, string> = {},
    followUpPayload?: HealthMetricsMembersNps | Observable<HealthMetricsMembersNps>
  ): Promise<void> {
    const followUp = followUpPayload ?? payload;
    getMembersNps = vi
      .fn()
      .mockReturnValue(isObservable(followUp) ? followUp : of(followUp))
      .mockReturnValueOnce(of(payload));
    navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;

    await TestBed.configureTestingModule({
      imports: [MembersNpsComponent],
      providers: [
        provideRouter([]),
        { provide: AnalyticsService, useValue: { getMembersNps } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: HealthMetricsChromeService, useValue: { selectedRange } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MembersNpsComponent);
    fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
    fixture.componentInstance.settled.subscribe(() => lifecycle.push('settled'));
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function text(testId: string): string | undefined {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    selectedRange = signal<string>('YTD');
    lifecycle = [];
  });

  it("reads the period's survey, renders the audience's score with its sample, and settles", async () => {
    await render();

    expect(getMembersNps).toHaveBeenCalledWith({ foundationSlug: 'acme', range: 'YTD', audience: null });
    expect(text('members-nps-audience-pills')).toContain('Committers');
    expect(text('members-nps-updated')).toBe('Last updated Q2 2026');
    expect(text('members-nps-score')).toBe('+62');
    expect(text('members-nps-change')).toBe('+4pp');
    expect(query('members-nps-change')?.classList).toContain('text-emerald-600');
    expect(text('members-nps-caption')).toBe('Net Promoter Score · board audience');
    expect(text('members-nps-responded')).toBe('18 of 26');
    expect(text('members-nps-rate')).toBe('69%');
    expect(query('members-nps-rate')?.classList).toContain('text-gray-900');
    expect(query('members-nps-low-sample')).toBeNull();
    expect(text('members-nps-footer')).toContain('Non-responses are rendered as the grey segment');
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('sizes the distribution against everyone surveyed and leaves out an empty segment', async () => {
    await render(response({ audiences: [audience({ recipientsCount: 20, promotersCount: 10, passivesCount: 4, detractorsCount: 0, noResponseCount: 6 })] }));

    expect(text('members-nps-surveyed')).toBe('out of 20 surveyed');
    expect(query('members-nps-segment-promoters')?.style.width).toBe('50%');
    expect(query('members-nps-segment-noResponse')?.style.width).toBe('30%');
    expect(query('members-nps-segment-detractors')).toBeNull();
    expect(text('members-nps-legend-detractors')).toBe('Detractors 0');
    expect(query('members-nps-bar')?.getAttribute('aria-label')).toBe(
      'Response distribution: Promoters 10, Passives 4, Detractors 0, No response 6, out of 20 surveyed.'
    );
  });

  it('draws the waves as score bars and a rate line, with a screen-reader table and the holding note', async () => {
    await render();

    const rows = [...(query('members-nps-chart-table')?.querySelectorAll('tbody tr') ?? [])].map((row) =>
      [...row.querySelectorAll('th, td')].map((cell) => cell.textContent?.trim())
    );
    expect(rows).toEqual([
      ['Q4 25', '+54', '71%'],
      ['Q2 26', '+62', '69%'],
    ]);
    expect(query('members-nps-chart')?.getAttribute('aria-label')).toContain('over 2 survey waves');
    expect(text('members-nps-trend-note')).toBe('Response rate is holding around 69%, so the movement in the score is meaningful.');
  });

  it('marks a wave below the rate floor in red and warns a rising score on a falling rate is unproven', async () => {
    await render(response({ trend: [quarter('2025-10-01', 'Q4 25', 45, 0.55), quarter('2026-04-01', 'Q2 26', 60, 0.38)] }));

    const [line] = fixture.componentInstance['chartData']().datasets as ChartDataset<'line'>[];
    expect(line.pointBackgroundColor).toEqual([lfxColors.amber[600], lfxColors.red[600]]);
    expect(text('members-nps-trend-note')).toContain('The score is up 15 points while the response rate fell from 55% to 38%.');
  });

  it('leaves out the trend for a single wave', async () => {
    await render(response({ trend: [quarter('2026-04-01', 'Q2 26', 62, 0.69)] }));

    expect(query('members-nps-trend')).toBeNull();
    expect(query('members-nps-hero')).not.toBeNull();
  });

  it('withholds a score on too small a sample, explaining the gap instead of showing the side stats', async () => {
    const flagged = audience({ npsScore: 80, recipientsCount: 24, responsesCount: 5, responseRatePct: 0.208, noResponseCount: 19, isSampleTooSmall: true });
    await render(response({ audiences: [flagged] }));

    expect(text('members-nps-low-sample')).toBe(
      'Only 5 of 24 responded (21%). Below the confidence threshold — the score is suppressed rather than shown as precise.'
    );
    expect(text('members-nps-score')).toBe('—');
    expect(query('members-nps-score')?.classList).toContain('text-gray-400');
    expect(text('members-nps-caption')).toBe('Not enough responses to report a score');
    expect(query('members-nps-side')).toBeNull();
    expect(text('members-nps-footer')).toBe('19 of 24 did not respond. A score computed on 5 replies is not a foundation-wide signal.');
  });

  it('switches audience, re-reading it and writing it to the URL, and clears the URL back on the first audience', async () => {
    await render(response(), {}, response({ selectedAudience: 'Committers' }));
    getMembersNps.mockClear();

    fixture.componentInstance['onAudienceChange']('Committers');
    await settle();

    expect(getMembersNps).toHaveBeenCalledWith(expect.objectContaining({ audience: 'Committers' }));
    expect(text('members-nps-score')).toBe('+40');
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { npsAudience: 'Committers' }, preserveFragment: true, replaceUrl: true })
    );

    fixture.componentInstance['onAudienceChange']('Board');
    await settle();

    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { npsAudience: null } }));
  });

  it('ignores an audience the period did not survey', async () => {
    await render();
    getMembersNps.mockClear();

    fixture.componentInstance['onAudienceChange']('Maintainers');
    await settle();

    expect(getMembersNps).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('starts on the audience the URL carries, trimmed, and lets the read pick for a blank one', async () => {
    await render(response({ selectedAudience: 'Committers' }), { npsAudience: ' Committers ' });
    expect(getMembersNps).toHaveBeenCalledWith(expect.objectContaining({ audience: 'Committers' }));
    expect(text('members-nps-score')).toBe('+40');

    TestBed.resetTestingModule();
    await render(response(), { npsAudience: '   ' });
    expect(getMembersNps).toHaveBeenCalledWith(expect.objectContaining({ audience: null }));
  });

  it('re-reads for a new period, and reads the default for one the views do not carry', async () => {
    await render();
    getMembersNps.mockClear();

    selectedRange.set('COMPLETED_YEAR');
    await settle();
    expect(getMembersNps).toHaveBeenCalledWith(expect.objectContaining({ range: 'COMPLETED_YEAR' }));

    selectedRange.set('LAST_WEEK');
    await settle();
    expect(getMembersNps).toHaveBeenLastCalledWith(expect.objectContaining({ range: 'YTD' }));
  });

  it('holds the skeleton, not the old figures, while a newly selected foundation reads', async () => {
    await render();
    getMembersNps.mockReturnValue(new Subject<HealthMetricsMembersNps>());

    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(query('members-nps-loading')).not.toBeNull();
    expect(query('members-nps-score')).toBeNull();
    expect(text('members-nps-updated')).toBe('—');
  });

  it('shows the empty state when the period holds no survey', async () => {
    await render(HEALTH_METRICS_MEMBERS_NPS_UNMEASURED);

    expect(text('members-nps-empty')).toContain('No survey in this period');
    expect(query('members-nps-controls')).toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('separates a failed read from an empty one, and still settles', async () => {
    await render();
    lifecycle.length = 0;
    getMembersNps.mockReturnValue(throwError(() => new Error('gateway timeout')));

    selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(query('members-nps-error')).not.toBeNull();
    expect(query('members-nps-empty')).toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('holds the loading state and reads nothing while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getMembersNps).not.toHaveBeenCalled();
    expect(lifecycle).not.toContain('settled');
    expect(query('members-nps-loading')).not.toBeNull();
    expect(query('members-nps-empty')).toBeNull();
  });
});
