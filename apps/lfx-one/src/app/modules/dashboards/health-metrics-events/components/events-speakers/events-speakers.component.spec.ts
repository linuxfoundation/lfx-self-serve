// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EventsSpeakersComponent } from './events-speakers.component';

import type { HealthMetricsEventsSpeakers, HealthMetricsEventsSpeakersPeriod, HealthMetricsEventsSpeakersProposal } from '@lfx-one/shared/interfaces';

function period(overrides: Partial<HealthMetricsEventsSpeakersPeriod> = {}): HealthMetricsEventsSpeakersPeriod {
  return {
    range: 'YTD',
    submitted: 1200,
    accepted: 300,
    inReview: 100,
    declined: 800,
    speakers: 250,
    acceptanceRate: 0.25,
    changes: { speakers: -0.35 },
    ...overrides,
  };
}

function proposal(overrides: Partial<HealthMetricsEventsSpeakersProposal> = {}): HealthMetricsEventsSpeakersProposal {
  return {
    proposalKey: 'p-1',
    range: 'YTD',
    jobTitle: 'Platform Engineer',
    organizationName: 'Acme Motors',
    unaffiliated: false,
    eventName: 'Sample Summit',
    sessionTitle: 'Scaling sample workloads',
    submissionDate: '2026-03-10',
    status: 'Accepted',
    statusGroup: 'accepted',
    ...overrides,
  };
}

function speakers(overrides: Partial<HealthMetricsEventsSpeakers> = {}): HealthMetricsEventsSpeakers {
  return {
    periods: [period(), period({ range: 'COMPLETED_YEAR', submitted: 2000, accepted: 500, changes: { speakers: 0.1 } })],
    organizations: [
      { accountId: 'acct-acme', accountName: 'Acme Motors', periods: [{ range: 'YTD', submitted: 40, rank: 1 }] },
      { accountId: 'acct-beta', accountName: 'Beta Coastal', periods: [{ range: 'YTD', submitted: 20, rank: 2 }] },
    ],
    unaffiliated: [{ range: 'YTD', submitted: 90 }],
    proposals: [
      proposal(),
      proposal({
        proposalKey: 'p-2',
        jobTitle: null,
        organizationName: null,
        unaffiliated: true,
        status: 'Waitlisted',
        statusGroup: 'in-review',
      }),
      proposal({ proposalKey: 'p-3', range: 'COMPLETED_YEAR', organizationName: 'Vendor Corp' }),
    ],
    ...overrides,
  };
}

describe('EventsSpeakersComponent', () => {
  let fixture: ComponentFixture<EventsSpeakersComponent>;
  let getEventsSpeakers: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];
  let notes: string[];

  async function render(payload: HealthMetricsEventsSpeakers | Error = speakers()): Promise<void> {
    getEventsSpeakers = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));

    await TestBed.configureTestingModule({
      imports: [EventsSpeakersComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getEventsSpeakers } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventsSpeakersComponent);
    fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
    fixture.componentInstance.settled.subscribe(() => lifecycle.push('settled'));
    fixture.componentInstance.noteChange.subscribe((note) => notes.push(note));
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

  function text(testId: string): string {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function rowKeys(): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="events-speakers-row-"]')).map((row) =>
      (row as HTMLElement).dataset['testid']!.replace('events-speakers-row-', '')
    );
  }

  async function pickRange(range: HealthMetricsEventsSpeakersPeriod['range']): Promise<void> {
    TestBed.inject(HealthMetricsChromeService).selectedRange.set(range);
    await settle();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
    notes = [];
  });

  it('reads the foundation once, settles and reports the sub-nav note', async () => {
    await render();

    expect(getEventsSpeakers).toHaveBeenCalledTimes(1);
    expect(getEventsSpeakers).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(notes).toEqual(['', 'down 35% YoY']);
    expect(query('events-speakers-loading')).toBeNull();
  });

  it("renders the period's headline, side stats and status bars", async () => {
    await render();

    expect(text('events-speakers-headline-value')).toBe('300');
    expect(text('events-speakers-side-total-value')).toBe('1,200');
    expect(text('events-speakers-side-acceptance-rate-value')).toBe('25%');
    expect(text('events-speakers-side-speakers-delta')).toBe('−35%');
    expect(text('events-speakers-status-declined-value')).toBe('800');
    expect(text('events-speakers-count')).toBe('1,200 proposals');
    expect(query('events-speakers-chart')).not.toBeNull();
  });

  it('ranks the organizations and keeps individual speakers on their own line', async () => {
    await render();

    expect(text('events-speakers-organization-acct-acme-value')).toBe('40');
    expect(text('events-speakers-organization-acct-beta-value')).toBe('20');
    expect(text('events-speakers-individual-value')).toBe('90 proposals submitted');
  });

  it("lists the period's proposals, labelling an individual's and badging the status", async () => {
    await render();

    expect(rowKeys()).toEqual(['p-1', 'p-2']);
    expect(text('events-speakers-organization-label-p-2')).toBe('Individual');
    expect(text('events-speakers-job-title-p-1')).toBe('Platform Engineer');
    expect(query('events-speakers-job-title-p-2')).toBeNull();
    expect(query('events-speakers-status-badge-p-1')?.className).toContain('bg-emerald-50');
    expect(text('events-speakers-status-badge-p-2')).toBe('Waitlisted');
  });

  it('filters the proposals by tab and re-settles', async () => {
    await render();
    lifecycle = [];
    const chartData = fixture.componentInstance['chartData']();

    fixture.componentInstance['onTabChange']('in-review');
    await settle();

    expect(rowKeys()).toEqual(['p-2']);
    expect(text('events-speakers-count')).toBe('100 proposals');
    expect(lifecycle).toEqual(['settled']);
    expect(getEventsSpeakers).toHaveBeenCalledTimes(1);
    // The chart is keyed on the response alone, so a tab change must not rebuild it.
    expect(fixture.componentInstance['chartData']()).toBe(chartData);
  });

  it('re-projects a period change without re-reading, and re-notes it', async () => {
    await render();
    lifecycle = [];
    notes = [];
    const chartData = fixture.componentInstance['chartData']();

    await pickRange('COMPLETED_YEAR');

    expect(getEventsSpeakers).toHaveBeenCalledTimes(1);
    expect(text('events-speakers-headline-value')).toBe('500');
    expect(rowKeys()).toEqual(['p-3']);
    expect(query('events-speakers-individual')).toBeNull();
    expect(lifecycle).toEqual(['settled']);
    expect(notes).toEqual(['']);
    expect(fixture.componentInstance['chartData']()).toBe(chartData);
  });

  it('says a period is unmeasured rather than showing zeros', async () => {
    await render();

    await pickRange('COMPLETED_YEAR_2');

    expect(query('events-speakers-unmeasured')).not.toBeNull();
    expect(query('events-speakers-hero')).toBeNull();
  });

  it('says so when the foundation has no proposals at all', async () => {
    await render(speakers({ periods: [], organizations: [], unaffiliated: [], proposals: [] }));

    expect(query('events-speakers-foundation-unmeasured')).not.toBeNull();
  });

  it('shows the error state and clears the note when the read fails', async () => {
    await render(new Error('boom'));

    expect(query('events-speakers-error')).not.toBeNull();
    expect(notes).toEqual(['', '']);
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('re-reads on a foundation switch, clearing the note until the new read settles', async () => {
    await render();
    getEventsSpeakers.mockReturnValue(
      of(speakers({ periods: [period({ changes: { speakers: -0.5 } })], proposals: [proposal({ proposalKey: 'p-b', organizationName: 'Beta Coastal' })] }))
    );

    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(getEventsSpeakers).toHaveBeenCalledTimes(2);
    expect(getEventsSpeakers).toHaveBeenLastCalledWith({ foundationSlug: 'beta' });
    expect(lifecycle).toEqual(['reading', 'settled', 'reading', 'settled']);
    expect(notes).toEqual(['', 'down 35% YoY', '', 'down 50% YoY']);
    expect(rowKeys()).toEqual(['p-b']);
  });

  it('gives the chart a text equivalent listing every year', async () => {
    await render();

    const rows = Array.from(query('events-speakers-chart-table')?.querySelectorAll('tbody tr') ?? []).map((row) =>
      Array.from(row.children).map((cell) => cell.textContent?.trim())
    );
    expect(rows).toHaveLength(4);
    expect(rows[0][1]).toBe('not available');
    expect(rows[2][1]).toBe('2,000');
    expect(rows[3][0]).toMatch(/^\d{4} \(partial year\)$/);
    expect(rows[3][1]).toBe('1,200');
    expect(query('events-speakers-chart')?.getAttribute('aria-label')).toMatch(
      /^Bar chart of proposals per year, \d{4} to \d{4}\. The same figures follow in a table\.$/
    );
  });

  it('holds the skeleton without settling until a foundation resolves', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getEventsSpeakers).not.toHaveBeenCalled();
    expect(query('events-speakers-loading')).not.toBeNull();
    expect(lifecycle).toEqual(['reading']);
  });
});
