// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { HEALTH_METRICS_MEMBERS_NPS_UNMEASURED } from '@lfx-one/shared/constants';
import { parseHealthMetricsMembersNpsAudience } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { isObservable, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { MembersNpsComponent } from './members-nps.component';

import type {
  HealthMetricsMembersNps,
  HealthMetricsMembersNpsAudience,
  HealthMetricsMembersNpsAudienceSwitch,
  HealthMetricsMembersNpsQuarter,
} from '@lfx-one/shared/interfaces';

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
    audiences: [audience({ audience: 'All' }), audience(), audience({ audience: 'Committers', npsScore: 40, scoreChangePp: -2 })],
    selectedAudience: 'All',
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
  let verdicts: boolean[];
  let switches: HealthMetricsMembersNpsAudienceSwitch[];

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
    // The page seeds the audience from the same URL and owns the header switch.
    fixture.componentRef.setInput('audience', parseHealthMetricsMembersNpsAudience(queryParams['npsAudience'] ?? null));
    fixture.componentInstance.audienceSwitch.subscribe((value) => switches.push(value));
    fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
    fixture.componentInstance.settled.subscribe((empty) => {
      lifecycle.push('settled');
      verdicts.push(empty);
    });
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
    verdicts = [];
    switches = [];
  });

  it("reads the period's survey, reports the switch, and renders the score and response rate", async () => {
    await render();

    expect(getMembersNps).toHaveBeenCalledWith({ foundationSlug: 'acme', range: 'YTD', audience: null });
    expect(switches.at(-1)).toEqual({
      options: [
        { id: 'All', label: 'All' },
        { id: 'Board', label: 'Board' },
        { id: 'Committers', label: 'Committers' },
      ],
      selected: 'All',
    });
    expect(text('members-nps-metrics-score-label')).toBe('NPS・All');
    expect(text('members-nps-metrics-score-value')).toBe('+62');
    expect(text('members-nps-metrics-score-description')).toBe('+4 vs Q4 25');
    expect(text('members-nps-metrics-rate-value')).toBe('69%');
    expect(text('members-nps-metrics-rate-description')).toBe('18 of 26 responded');
    expect(query('members-nps-low-response')).toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  it('sizes the distribution against everyone surveyed and leaves out an empty segment', async () => {
    await render(
      response({
        audiences: [audience({ audience: 'All', recipientsCount: 20, promotersCount: 10, passivesCount: 4, detractorsCount: 0, noResponseCount: 6 })],
      })
    );

    expect(query('members-nps-segment-promoters')?.style.flexGrow).toBe('50');
    expect(query('members-nps-segment-noResponse')?.style.flexGrow).toBe('30');
    // The counts cover everyone surveyed, so nothing is left unfilled.
    expect(query('members-nps-segment-unknown')).toBeNull();
    expect(query('members-nps-segment-detractors')).toBeNull();
    const legend = [...(query('members-nps-legend-detractors')?.querySelectorAll('span') ?? [])].map((span) => span.textContent?.trim());
    expect(legend).toEqual(['', 'Detractors', '0']);
    expect(query('members-nps-bar')?.getAttribute('aria-label')).toBe('Response distribution: Promoters 10, Passives 4, Detractors 0, No response 6.');
  });

  it('leaves the share no count covers unfilled, so partial counts never stretch to fill the bar', async () => {
    await render(
      response({
        audiences: [audience({ audience: 'All', recipientsCount: 20, promotersCount: 10, passivesCount: null, detractorsCount: null, noResponseCount: null })],
      })
    );

    expect(query('members-nps-segment-promoters')?.style.flexGrow).toBe('50');
    expect(query('members-nps-segment-unknown')?.style.flexGrow).toBe('50');
  });

  it('charts the quarters as score bars under a dashed response-rate line', async () => {
    await render();

    expect(text('members-nps-trend')).toContain('NPS trend');
    expect([...fixture.nativeElement.querySelectorAll('[data-testid^="members-nps-chart-value-"]')].map((label: Element) => label.textContent?.trim())).toEqual(
      ['+54', '+62']
    );
    expect(query('members-nps-chart-fill-2025-10-01')?.style.opacity).toBe('0.3');
    expect(query('members-nps-chart-fill-2026-04-01')?.style.opacity).toBe('1');
    expect(query('members-nps-chart-line')).not.toBeNull();
    expect(text('members-nps-chart-legend')).toBe('Response rate');
    expect(query('members-nps-chart-bar-2026-04-01')?.getAttribute('aria-label')).toBe('Q2 26, NPS +62, Response rate 69%');
  });

  it('leaves out the trend for a single quarter', async () => {
    await render(response({ trend: [quarter('2026-04-01', 'Q2 26', 62, 0.69)] }));

    expect(query('members-nps-trend')).toBeNull();
    expect(query('members-nps-metrics')).not.toBeNull();
    expect(text('members-nps-metrics-score-description')).toBeUndefined();
  });

  it('warns over a score on a response rate below the floor', async () => {
    const flagged = audience({ audience: 'All', npsScore: 80, recipientsCount: 24, responsesCount: 5, responseRatePct: 0.208, noResponseCount: 19 });
    await render(response({ audiences: [flagged] }));

    expect(text('members-nps-low-response')).toBe('Only 5 of 24 responded (21%). Below the confidence threshold, so read this score with caution.');
    expect(text('members-nps-metrics-score-value')).toBe('+80');
  });

  it('switches audience, re-reading it and writing it to the URL, and clears the URL back on the first audience', async () => {
    await render(response(), {}, response({ selectedAudience: 'Committers' }));
    getMembersNps.mockClear();

    fixture.componentRef.setInput('audience', 'Committers');
    await settle();

    expect(getMembersNps).toHaveBeenCalledWith(expect.objectContaining({ audience: 'Committers' }));
    expect(text('members-nps-metrics-score-label')).toBe('NPS・Committers');
    expect(text('members-nps-metrics-score-value')).toBe('+40');
    expect(switches.at(-1)?.selected).toBe('Committers');
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { npsAudience: 'Committers' }, preserveFragment: true, replaceUrl: true })
    );

    fixture.componentRef.setInput('audience', 'All');
    await settle();

    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { npsAudience: null } }));
  });

  it('starts on the audience the URL carries, trimmed, and lets the read pick for a blank one', async () => {
    await render(response({ selectedAudience: 'Committers' }), { npsAudience: ' Committers ' });
    expect(getMembersNps).toHaveBeenCalledWith(expect.objectContaining({ audience: 'Committers' }));
    expect(text('members-nps-metrics-score-value')).toBe('+40');
    expect(navigate).not.toHaveBeenCalled();

    TestBed.resetTestingModule();
    await render(response(), { npsAudience: '   ' });
    expect(getMembersNps).toHaveBeenCalledWith(expect.objectContaining({ audience: null }));
  });

  it('drops a URL audience the period did not survey, clearing the URL without a second read', async () => {
    await render(response(), { npsAudience: 'Ambassador' });

    expect(getMembersNps).toHaveBeenCalledTimes(1);
    expect(getMembersNps).toHaveBeenCalledWith(expect.objectContaining({ audience: 'Ambassador' }));
    expect(text('members-nps-metrics-score-value')).toBe('+62');
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { npsAudience: null } }));
    expect(fixture.componentInstance.audience()).toBeNull();
    expect(switches.at(-1)?.selected).toBe('All');
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
    expect(query('members-nps-metrics')).toBeNull();
  });

  it('settles empty, with no body and no switch options, when the period holds no survey', async () => {
    await render(HEALTH_METRICS_MEMBERS_NPS_UNMEASURED);

    expect(query('members-nps-metrics')).toBeNull();
    expect(switches.at(-1)).toEqual({ options: [], selected: null });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([true]);
  });

  it('separates a failed read from an empty one, and still settles', async () => {
    await render();
    lifecycle.length = 0;
    getMembersNps.mockReturnValue(throwError(() => new Error('gateway timeout')));

    selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(query('members-nps-error')).not.toBeNull();
    expect(switches.at(-1)).toEqual({ options: [], selected: null });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false, false]);
  });

  it('holds the loading state and reads nothing while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getMembersNps).not.toHaveBeenCalled();
    expect(lifecycle).not.toContain('settled');
    expect(query('members-nps-loading')).not.toBeNull();
  });

  it('keeps a deep-linked audience while the foundation resolves', async () => {
    selectedFoundation.set(null);
    await render(response({ selectedAudience: 'Committers' }), { npsAudience: 'Committers' });

    selectedFoundation.set({ slug: 'acme' });
    await settle();

    expect(getMembersNps).toHaveBeenCalledWith({ foundationSlug: 'acme', range: 'YTD', audience: 'Committers' });
    expect(navigate).not.toHaveBeenCalled();
    expect(text('members-nps-metrics-score-value')).toBe('+40');
  });
});
