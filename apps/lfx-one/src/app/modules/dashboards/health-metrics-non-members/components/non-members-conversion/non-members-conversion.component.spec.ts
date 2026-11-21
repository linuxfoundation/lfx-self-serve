// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { NonMembersConversionComponent } from './non-members-conversion.component';

import type { HealthMetricsNonMembersConversion } from '@lfx-one/shared/interfaces';

function conversion(overrides: Partial<HealthMetricsNonMembersConversion> = {}): HealthMetricsNonMembersConversion {
  return {
    measured: true,
    highFitCount: 2,
    newCount: 37,
    estimatedPipelineUsd: 50000,
    warmest: [
      { accountId: '0014100000AcmeAAAA', accountName: 'Acme Motors', logoUrl: 'https://logos.example/acme.png', meetingsAttended: 12, contributions: 400 },
      { accountId: '0014100000VendAAAA', accountName: 'Vendor Corp', logoUrl: null, meetingsAttended: 1, contributions: 1200 },
    ],
    ...overrides,
  };
}

describe('NonMembersConversionComponent', () => {
  let fixture: ComponentFixture<NonMembersConversionComponent>;
  let getNonMembersConversion: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];
  let verdicts: boolean[];

  async function render(payload: HealthMetricsNonMembersConversion | Error = conversion()): Promise<void> {
    getNonMembersConversion = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));

    await TestBed.configureTestingModule({
      imports: [NonMembersConversionComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getNonMembersConversion } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NonMembersConversionComponent);
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

  function rowOrder(): string[] {
    return [...fixture.nativeElement.querySelectorAll('[data-testid$="-name"] [data-testid="health-metrics-cell-text"]')].map(
      (el) => (el as HTMLElement).textContent?.trim() ?? ''
    );
  }

  function sortBy(key: string): void {
    (query(`non-members-conversion-sort-${key}`)?.querySelector('button') as HTMLButtonElement).click();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
    verdicts = [];
  });

  it('reads the foundation for the period and settles', async () => {
    await render();

    expect(getNonMembersConversion).toHaveBeenCalledTimes(1);
    expect(getNonMembersConversion).toHaveBeenCalledWith({ foundationSlug: 'acme', range: 'YTD' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
    expect(query('non-members-conversion-loading-metrics')).toBeNull();
  });

  it('shows the shared metrics row: compact pipeline, high-fit and new, with no trend or description', async () => {
    await render();

    expect(text('non-members-conversion-metrics-pipeline-label')).toBe('Estimated pipeline');
    expect(text('non-members-conversion-metrics-pipeline-value')).toBe('$50K');
    expect(text('non-members-conversion-metrics-high-fit-value')).toBe('2');
    expect(text('non-members-conversion-metrics-new-value')).toBe('37');
    expect(query('non-members-conversion-metrics-pipeline-trend')).toBeNull();
    expect(query('non-members-conversion-summary')).toBeNull();
  });

  it('lists the warmest companies under an uppercase sub-heading, with logos and a Contributions tip', async () => {
    await render();

    expect(text('non-members-conversion-warmest')).toContain('Warmest companies');
    const headers = [...(query('non-members-conversion-warmest-table')?.querySelectorAll('th') ?? [])].map((th) => th.textContent?.trim());
    expect(headers).toEqual(['Company', 'Meetings attended', 'Contributions']);
    expect(query('non-members-conversion-warm-0014100000AcmeAAAA-name')?.querySelector('[data-testid="health-metrics-cell-company"]')).not.toBeNull();
    expect(text('non-members-conversion-warm-0014100000VendAAAA-contributions')).toBe('1,200');
    expect(fixture.componentInstance['contributionsTip']).toContain('this company made');
  });

  it('sorts the shown companies in the browser, never re-reading, and returns to the read order', async () => {
    await render();
    expect(rowOrder()).toEqual(['Acme Motors', 'Vendor Corp']);

    sortBy('contributions');
    await settle();
    expect(rowOrder()).toEqual(['Vendor Corp', 'Acme Motors']);

    sortBy('meetings');
    await settle();
    expect(rowOrder()).toEqual(['Acme Motors', 'Vendor Corp']);
    sortBy('meetings');
    await settle();
    expect(rowOrder()).toEqual(['Vendor Corp', 'Acme Motors']);

    expect(getNonMembersConversion).toHaveBeenCalledTimes(1);
  });

  it('dashes every figure in neutral-400 with no conversion row, and still lists the companies', async () => {
    await render({ ...HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED, warmest: conversion().warmest });

    expect(verdicts).toEqual([false]);
    for (const key of ['pipeline', 'high-fit', 'new']) {
      expect(text(`non-members-conversion-metrics-${key}-value`)).toBe('—');
      expect(query(`non-members-conversion-metrics-${key}-value`)?.className).toContain('text-gray-400');
    }
    expect(query('non-members-conversion-warmest-table')).not.toBeNull();
  });

  it('re-reads a period change', async () => {
    await render();
    lifecycle = [];

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(getNonMembersConversion).toHaveBeenCalledTimes(2);
    expect(getNonMembersConversion).toHaveBeenLastCalledWith({ foundationSlug: 'acme', range: 'COMPLETED_YEAR' });
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('settles empty, with no body, when the period has no conversion row and no active company', async () => {
    await render(HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED);

    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([true]);
    expect(query('non-members-conversion-metrics')).toBeNull();
    expect(query('non-members-conversion-warmest')).toBeNull();
  });

  it('shows the error state and still settles when the read fails', async () => {
    await render(new Error('boom'));

    expect(query('non-members-conversion-error')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  it('holds the skeleton without reading or settling until a foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getNonMembersConversion).not.toHaveBeenCalled();
    // The metrics row's and the table's own skeletons, not one block.
    expect(query('non-members-conversion-loading-metrics')).not.toBeNull();
    expect(query('non-members-conversion-loading-table')).not.toBeNull();
    expect(lifecycle).toEqual(['reading']);
  });
});
