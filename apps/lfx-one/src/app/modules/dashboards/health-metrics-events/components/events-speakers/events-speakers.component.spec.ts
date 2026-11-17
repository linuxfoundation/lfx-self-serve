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
    logoUrl: '',
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
      { accountId: 'acct-acme', accountName: 'Acme Motors', logoUrl: '', periods: [{ range: 'YTD', submitted: 40, rank: 1 }] },
      { accountId: 'acct-beta', accountName: 'Beta Coastal', logoUrl: '', periods: [{ range: 'YTD', submitted: 20, rank: 2 }] },
    ],
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
  let verdicts: boolean[];

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

  function text(testId: string): string {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function rowKeys(): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="events-speakers-proposal-"]'))
      .map((row) => (row as HTMLElement).dataset['testid'] ?? '')
      .filter((id) => !id.endsWith('-status'))
      .map((id) => id.replace('events-speakers-proposal-', ''));
  }

  async function pickRange(range: HealthMetricsEventsSpeakersPeriod['range']): Promise<void> {
    TestBed.inject(HealthMetricsChromeService).selectedRange.set(range);
    await settle();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
    verdicts = [];
  });

  it('reads the foundation once and settles', async () => {
    await render();

    expect(getEventsSpeakers).toHaveBeenCalledTimes(1);
    expect(getEventsSpeakers).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
    expect(query('events-speakers-loading')).toBeNull();
  });

  it("lays out the period's metrics row", async () => {
    await render();

    expect(text('events-speakers-metrics-total-value')).toBe('1,200');
    expect(text('events-speakers-metrics-accepted-description')).toBe('25% acceptance rate');
    expect(text('events-speakers-metrics-speakers-trend')).toBe('−35%');
    expect(query('events-speakers-metrics-speakers-tip')).not.toBeNull();
  });

  it('draws proposals by year as stacked status columns with a legend', async () => {
    await render();

    expect(text('events-speakers-years-heading')).toBe('Proposals by year');
    expect([...(query('events-speakers-chart-legend')?.children ?? [])].map((item) => item.textContent?.trim())).toEqual(['Accepted', 'In review', 'Declined']);
    expect(query(`events-speakers-chart-column-${new Date().getFullYear()}`)?.getAttribute('aria-label')).toContain('· partial year');
  });

  it("lists the period's latest proposals by job title, with the company, an individual's as Individual, and the status badge", async () => {
    await render();

    expect(rowKeys()).toEqual(['p-1', 'p-2']);
    expect(text('events-speakers-proposal-p-1')).toContain('Platform Engineer');
    expect(text('events-speakers-proposal-p-1')).toContain('Scaling sample workloads');
    expect(text('events-speakers-proposal-p-2')).toContain('Individual');
    expect(text('events-speakers-proposal-p-1-status')).toBe('Accepted');
    expect(text('events-speakers-proposal-p-2-status')).toBe('In review');
  });

  it('switches to the most active companies as bars, and re-settles as the height moves', async () => {
    await render();
    lifecycle = [];

    fixture.componentInstance['onListChange']('companies');
    await settle();

    expect(query('events-speakers-proposals')).toBeNull();
    // The design's grid, with a phone grid that keeps the counts inside a 375px screen.
    expect(query('events-speakers-companies-row-acct-acme')?.className).toContain('grid-cols-[minmax(200px,300px)_1fr_100px]');
    expect(query('events-speakers-companies-row-acct-acme')?.className).toContain('max-[640px]:grid-cols-[minmax(0,1fr)_minmax(48px,0.6fr)_auto]');
    const cells = [...(query('events-speakers-companies-row-acct-acme')?.children ?? [])].map((cell) => cell.textContent?.trim());
    expect(cells[0]).toContain('Acme Motors');
    expect(cells[2]).toBe('40 proposals');
    expect(lifecycle).toEqual(['settled']);
  });

  it('says so when the period has no proposal or no company', async () => {
    await render(speakers({ proposals: [], organizations: [] }));

    expect(text('events-speakers-proposals-empty')).toBe('No proposal in the selected period.');
    fixture.componentInstance['onListChange']('companies');
    await settle();
    expect(text('events-speakers-companies-empty')).toBe('No company submitted a proposal in the selected period.');
  });

  it('re-projects a period change without re-reading, and re-settles', async () => {
    await render();
    lifecycle = [];
    const year = new Date().getFullYear();
    const columns = () => [...fixture.nativeElement.querySelectorAll('[data-testid^="events-speakers-chart-column-"]')].length;

    await pickRange('COMPLETED_YEAR');

    expect(getEventsSpeakers).toHaveBeenCalledTimes(1);
    expect(text('events-speakers-metrics-accepted-value')).toBe('500');
    expect(rowKeys()).toEqual(['p-3']);
    expect(lifecycle).toEqual(['settled']);
    // The chart shows every year whatever the period.
    expect(columns()).toBe(4);
    expect(query(`events-speakers-chart-column-${year}`)).not.toBeNull();
  });

  it('settles an unmeasured period empty, with no body, rather than showing zeros', async () => {
    await render();

    await pickRange('COMPLETED_YEAR_2');

    expect(verdicts).toEqual([false, true]);
    expect(query('events-speakers-metrics')).toBeNull();
    expect(query('events-speakers-chart')).toBeNull();
    expect(query('events-speakers-list')).toBeNull();
  });

  it('settles empty, with no body, when the foundation has no proposals at all', async () => {
    await render(speakers({ periods: [], organizations: [], proposals: [] }));

    expect(verdicts).toEqual([true]);
    expect(query('events-speakers-metrics')).toBeNull();
  });

  it('shows the error state when the read fails, and still settles', async () => {
    await render(new Error('boom'));

    expect(query('events-speakers-error')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  it('re-reads on a foundation switch and settles again', async () => {
    await render();
    getEventsSpeakers.mockReturnValue(
      of(speakers({ periods: [period({ changes: { speakers: -0.5 } })], proposals: [proposal({ proposalKey: 'p-b', organizationName: 'Beta Coastal' })] }))
    );

    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(getEventsSpeakers).toHaveBeenCalledTimes(2);
    expect(getEventsSpeakers).toHaveBeenLastCalledWith({ foundationSlug: 'beta' });
    expect(lifecycle).toEqual(['reading', 'settled', 'reading', 'settled']);
    expect(rowKeys()).toEqual(['p-b']);
  });

  it('holds the skeleton without settling until a foundation resolves', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getEventsSpeakers).not.toHaveBeenCalled();
    expect(query('events-speakers-loading')).not.toBeNull();
    expect(lifecycle).toEqual(['reading']);
  });
});
