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
    entryTierName: 'Silver',
    entryTierFeeUsd: 25000,
    organizationsTracked: 412,
    highFitCount: 2,
    newCount: 37,
    estimatedPipelineUsd: 50000,
    warmest: [
      { accountId: '0014100000AcmeAAAA', accountName: 'Acme Motors', meetingsAttended: 12, contributions: 400 },
      { accountId: '0014100000VendAAAA', accountName: 'Vendor Corp', meetingsAttended: 1, contributions: 100 },
    ],
    ...overrides,
  };
}

describe('NonMembersConversionComponent', () => {
  let fixture: ComponentFixture<NonMembersConversionComponent>;
  let getNonMembersConversion: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];
  let counts: (number | null)[];

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
    fixture.componentInstance.settled.subscribe(() => lifecycle.push('settled'));
    fixture.componentInstance.countChange.subscribe((count) => counts.push(count));
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

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
    counts = [];
  });

  it('reads the foundation for the period, settles and reports the high-fit count', async () => {
    await render();

    expect(getNonMembersConversion).toHaveBeenCalledTimes(1);
    expect(getNonMembersConversion).toHaveBeenCalledWith({ foundationSlug: 'acme', range: 'YTD' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(counts).toEqual([null, 2]);
    expect(query('non-members-conversion-loading')).toBeNull();
  });

  it('renders the qualified pipeline, side stats, summary and footnote', async () => {
    await render();

    expect(text('non-members-conversion-pipeline-value')).toBe('$50K');
    expect(text('non-members-conversion-pipeline-label')).toBe('Estimated pipeline');
    expect(text('non-members-conversion-side-high-fit-value')).toBe('2');
    expect(text('non-members-conversion-side-new-value')).toBe('37');
    expect(text('non-members-conversion-summary')).toBe('412 organizations tracked');
    expect(text('non-members-conversion-footnote')).toBe('Estimated pipeline multiplies high-fit organizations by the Silver fee and is indicative only.');
  });

  it('ranks the warmest organizations, sized by contributions', async () => {
    await render();

    expect(text('non-members-conversion-warm-0')).toContain('Acme Motors · 12 meetings');
    expect(text('non-members-conversion-warm-0-value')).toBe('400 contributions');
    expect(text('non-members-conversion-warm-1')).toContain('Vendor Corp · 1 meeting');
    const bars = fixture.nativeElement.querySelectorAll('[data-testid^="non-members-conversion-warm-"] .bg-blue-600');
    expect(bars.length).toBe(2);
    expect((bars[1] as HTMLElement).style.width).toBe('25%');
  });

  it('never shows a bare figure when the estimate is missing, and says a NULL count is not available', async () => {
    await render(conversion({ estimatedPipelineUsd: null, newCount: null }));

    expect(text('non-members-conversion-pipeline-value')).toBe('—');
    expect(text('non-members-conversion-pipeline-label')).toBe('Estimated pipeline · not enough data');
    expect(text('non-members-conversion-side-new-value')).toBe('not available');
  });

  it('says no organization is high-fit when the warmest list is empty', async () => {
    await render(conversion({ highFitCount: 0, warmest: [] }));

    expect(query('non-members-conversion-warmest-empty')).not.toBeNull();
    expect(counts).toEqual([null, 0]);
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

  it('shows the not-measured state, with no badge, when the foundation has no conversion row', async () => {
    await render(HEALTH_METRICS_NON_MEMBERS_CONVERSION_UNMEASURED);

    expect(query('non-members-conversion-unmeasured')).not.toBeNull();
    expect(counts).toEqual([null, null]);
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('shows the error state and still settles when the read fails', async () => {
    await render(new Error('boom'));

    expect(query('non-members-conversion-error')).not.toBeNull();
    expect(counts).toEqual([null, null]);
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('holds the skeleton without reading or settling until a foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getNonMembersConversion).not.toHaveBeenCalled();
    expect(query('non-members-conversion-loading')).not.toBeNull();
    expect(lifecycle).toEqual(['reading']);
  });
});
