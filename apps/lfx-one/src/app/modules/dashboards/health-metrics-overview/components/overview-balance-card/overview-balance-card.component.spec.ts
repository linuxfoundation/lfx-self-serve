// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OverviewBalanceCardComponent } from './overview-balance-card.component';

import type { HealthMetricsOverviewOutstandingBalance } from '@lfx-one/shared/interfaces';

const BALANCE: HealthMetricsOverviewOutstandingBalance = {
  measured: true,
  outstandingUsd: 1105250,
  overdueMembers: 20,
  highRiskUsd: 1083250,
  highRiskMembers: 18,
  highRiskSharePct: 0.98,
  mediumRiskUsd: 22000,
  mediumRiskMembers: 2,
  mediumRiskSharePct: 0.02,
};

describe('OverviewBalanceCardComponent', () => {
  let fixture: ComponentFixture<OverviewBalanceCardComponent>;

  async function render(payload: HealthMetricsOverviewOutstandingBalance): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [OverviewBalanceCardComponent],
      providers: [
        provideRouter([]),
        { provide: AnalyticsService, useValue: { getOverviewOutstandingBalance: vi.fn().mockReturnValue(of(payload)) } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OverviewBalanceCardComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Each grid cell's text, since Angular drops the whitespace between them. */
  function cells(testId: string): string[] {
    const row = fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
    return [...row.children].map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  }

  function text(testId: string): string {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('reads the total, the members at risk and each risk band', async () => {
    await render(BALANCE);

    expect(text('overview-balance-total')).toBe('$1,105,250');
    expect(text('overview-balance-at-risk')).toBe('18 members at risk of churn');
    expect(cells('overview-balance-high')).toEqual(['High risk90+ days overdue', '18', '$1,083,250']);
    expect(fixture.nativeElement.querySelectorAll('[data-testid="overview-balance-bar"] span')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('[data-testid="overview-balance-explore"]').getAttribute('href')).toContain('/members#risk');
  });

  it('reads as good news when nothing is overdue', async () => {
    await render({ ...BALANCE, outstandingUsd: 0 });

    expect(text('overview-balance-empty-title')).toBe('All invoices paid');
  });

  it('stays neutral when the balance was never measured', async () => {
    await render({ ...BALANCE, measured: false, outstandingUsd: null });

    expect(text('overview-balance-empty-title')).toBe('No balance data yet');
  });
});
