// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HEALTH_METRICS_OVERVIEW_EMPTY_COPY } from '@lfx-one/shared/constants';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { NEVER } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';

import { HealthMetricsBlankCardComponent } from '../components/health-metrics-blank-card/health-metrics-blank-card.component';
import { OverviewCardComponent } from './components/overview-card/overview-card.component';
import { HealthMetricsOverviewComponent } from './health-metrics-overview.component';

import type { HealthMetricsOverviewCardStatus } from '@lfx-one/shared/interfaces';

describe('HealthMetricsOverviewComponent', () => {
  it('lays out every card in the design order, each loading on its own', async () => {
    const pending = () => NEVER;
    await TestBed.configureTestingModule({
      imports: [HealthMetricsOverviewComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        {
          provide: AnalyticsService,
          useValue: {
            getOverviewParticipatingOrgs: pending,
            getOverviewNps: pending,
            getOverviewChurn: pending,
            getOverviewOutstandingBalance: pending,
            getOverviewEvents: pending,
            getEventsAtAGlance: pending,
            getEventsSponsorship: pending,
            getTrainingEnrollment: pending,
            getOverviewCode: pending,
            getOverviewBoard: pending,
          },
        },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }), selectedFoundationSfid: signal(null) } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(HealthMetricsOverviewComponent);
    fixture.detectChanges();

    const loading = [...fixture.nativeElement.querySelectorAll('[data-testid$="-loading"]')].map((element: Element) => element.getAttribute('data-testid'));
    expect(loading).toEqual([
      'overview-orgs-loading',
      'overview-nps-loading',
      'overview-churn-loading',
      'overview-balance-loading',
      'overview-events-loading',
      'overview-training-loading',
      'overview-code-loading',
      'overview-board-loading',
    ]);
  });
});

const CARD_SELECTORS = [
  'lfx-overview-orgs-card',
  'lfx-overview-nps-card',
  'lfx-overview-churn-card',
  'lfx-overview-balance-card',
  'lfx-overview-events-card',
  'lfx-overview-training-card',
  'lfx-overview-code-card',
  'lfx-overview-board-card',
];
/** Whether each stub card has data; a stub missing from the map settles empty. */
const cardHasData = signal<Record<string, boolean>>({});
const cardStatus = signal<HealthMetricsOverviewCardStatus>('ready');

/** A stand-in for each card: the real card shell, settled empty unless `cardHasData` says otherwise. */
const STUB_CARDS = CARD_SELECTORS.map((selector) =>
  Component({
    selector,
    imports: [OverviewCardComponent],
    template: `<lfx-overview-card heading="Card" info="Info" [status]="status()" [isEmpty]="!hasData()" [emptyCopy]="copy" [testId]="selector" />`,
  })(
    class {
      protected readonly selector = selector;
      protected readonly copy = HEALTH_METRICS_OVERVIEW_EMPTY_COPY.events;
      protected readonly status = cardStatus;
      protected readonly hasData = computed(() => cardHasData()[selector] ?? false);
    }
  )
);

describe('HealthMetricsOverviewComponent blank state', () => {
  async function render(): Promise<ComponentFixture<HealthMetricsOverviewComponent>> {
    await TestBed.configureTestingModule({
      imports: [HealthMetricsOverviewComponent],
      providers: [HealthMetricsChromeService, { provide: UserService, useValue: { impersonating: signal(false) } }],
    })
      .overrideComponent(HealthMetricsOverviewComponent, { set: { imports: [HealthMetricsBlankCardComponent, ...STUB_CARDS] } })
      .compileComponents();
    const fixture = TestBed.createComponent(HealthMetricsOverviewComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function query(fixture: ComponentFixture<HealthMetricsOverviewComponent>, testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  it('replaces every card with one blank card when all of them settle empty, worded for the period', async () => {
    cardHasData.set({});
    cardStatus.set('ready');
    const fixture = await render();

    expect(query(fixture, 'health-metrics-overview-blank')?.querySelector('h2')?.textContent).toBe('No health data yet');
    expect(query(fixture, 'health-metrics-overview-blank-reasons')?.children).toHaveLength(3);
    expect(query(fixture, 'health-metrics-overview-cards')?.className).toContain('hidden');

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();

    const year = new Date().getFullYear() - 1;
    expect(query(fixture, 'health-metrics-overview-blank')?.querySelector('h2')?.textContent).toBe(`No health data for ${year}`);
    expect(query(fixture, 'health-metrics-overview-blank-lead')?.textContent).toBe(`Nothing was recorded for the foundation in ${year}.`);
  });

  it('keeps the cards, each with its own empty state, once any card has data', async () => {
    cardHasData.set({});
    cardStatus.set('ready');
    const fixture = await render();

    cardHasData.set({ 'lfx-overview-events-card': true });
    fixture.detectChanges();

    expect(query(fixture, 'health-metrics-overview-blank')).toBeNull();
    expect(query(fixture, 'health-metrics-overview-cards')?.className).not.toContain('hidden');
    expect(query(fixture, 'lfx-overview-orgs-card-empty')).not.toBeNull();
  });

  it.each(['loading', 'failed'] as const)('shows no blank card while the cards are %s', async (status) => {
    cardHasData.set({});
    cardStatus.set(status);
    const fixture = await render();

    expect(query(fixture, 'health-metrics-overview-blank')).toBeNull();
  });
});
