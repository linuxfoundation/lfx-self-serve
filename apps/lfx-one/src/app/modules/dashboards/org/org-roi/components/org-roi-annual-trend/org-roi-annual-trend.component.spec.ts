// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChartComponent } from '@components/chart/chart.component';
import type { Account, OrgLensRoiAnnualRow } from '@lfx-one/shared/interfaces';
import { formatCurrency } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensRoiService } from '@services/org-lens-roi.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgRoiAnnualTrendComponent } from './org-roi-annual-trend.component';

/** Stands in for the canvas, which jsdom cannot draw. What the component hands the chart is what is under test. */
@Component({ selector: 'lfx-chart', template: '' })
class ChartStubComponent {
  public readonly type = input<string>();
  public readonly data = input<{ labels: string[]; datasets: { label?: string; data: number[]; cubicInterpolationMode?: string }[] }>();
  public readonly options = input<unknown>();
  public readonly height = input<string>();
}

/** Derived from the stub's own input rather than declared again, so the two cannot drift apart. */
type DrawnChart = NonNullable<ReturnType<ChartStubComponent['data']>>;

const ACCOUNT = { accountId: 'acc-1', accountName: 'Test Org', uid: 'acc-1' } as Account;

function row(year: number, expenditure: number, totalReturn: number): OrgLensRoiAnnualRow {
  const profit = totalReturn - expenditure;
  const hasInvestment = expenditure > 0;
  return { year, totalReturn, expenditure, profit, roi: hasInvestment ? profit / expenditure : null, bcr: hasInvestment ? totalReturn / expenditure : null };
}

// Deliberately not the current calendar year, so the partial-year note stays out of these cases.
const THREE_YEARS = [row(2021, 100, 400), row(2022, 200, 900), row(2023, 300, 1700)];
const CUMULATIVE_INVESTMENT = 600;
const CUMULATIVE_RETURN = 3000;

describe('OrgRoiAnnualTrendComponent — year over year and cumulative', () => {
  let rows: OrgLensRoiAnnualRow[];
  let apportioned: boolean;

  beforeEach(async () => {
    rows = THREE_YEARS;
    apportioned = true;
    TestBed.overrideComponent(OrgRoiAnnualTrendComponent, {
      remove: { imports: [ChartComponent] },
      add: { imports: [ChartStubComponent] },
    });
    await TestBed.configureTestingModule({
      imports: [OrgRoiAnnualTrendComponent],
      providers: [
        { provide: AccountContextService, useValue: { selectedAccount: signal(ACCOUNT) } },
        { provide: OrgLensRoiService, useValue: { getAnnual: vi.fn(() => of({ method: 'logit', rows, apportioned })) } },
      ],
    }).compileComponents();
  });

  const open = (): ComponentFixture<OrgRoiAnnualTrendComponent> => {
    const fixture = TestBed.createComponent(OrgRoiAnnualTrendComponent);
    fixture.componentRef.setInput('method', 'logit');
    fixture.detectChanges();
    return fixture;
  };
  const has = (fixture: ComponentFixture<OrgRoiAnnualTrendComponent>, testId: string): boolean =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) !== null;
  const text = (fixture: ComponentFixture<OrgRoiAnnualTrendComponent>, testId: string): string =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '';
  const pressed = (fixture: ComponentFixture<OrgRoiAnnualTrendComponent>, testId: string): string | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`)?.getAttribute('aria-pressed') ?? null;
  const ariaLabel = (fixture: ComponentFixture<OrgRoiAnnualTrendComponent>): string =>
    fixture.nativeElement.querySelector('[data-testid="org-roi-annual-trend-chart"]')?.getAttribute('aria-label') ?? '';
  const click = (fixture: ComponentFixture<OrgRoiAnnualTrendComponent>, testId: string): void => {
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`).click();
    fixture.detectChanges();
  };
  /**
   * The canvas itself, not the sr-only table. Both read the same signal today, but nothing stops
   * them diverging, and the legend labels and interpolation mode exist nowhere else.
   */
  const drawn = (fixture: ComponentFixture<OrgRoiAnnualTrendComponent>): DrawnChart =>
    fixture.debugElement.query(By.directive(ChartStubComponent)).componentInstance.data();

  it('opens on year over year and draws each year on its own', () => {
    const fixture = open();

    expect(pressed(fixture, 'org-roi-annual-trend-series-yearly')).toBe('true');
    expect(pressed(fixture, 'org-roi-annual-trend-series-cumulative')).toBe('false');

    const table = text(fixture, 'org-roi-annual-trend-table');
    expect(table).toContain(formatCurrency(300));
    expect(table).toContain(formatCurrency(1700));
    expect(table).not.toContain(formatCurrency(CUMULATIVE_RETURN));
  });

  it('keeps the default aria-label free of any cumulative claim', () => {
    // `org-roi-summary.spec.ts` asserts this label matches /investment and return by year/i, which
    // both modes satisfy — so the mode has to be asserted on the wording itself.
    const fixture = open();

    expect(ariaLabel(fixture)).toContain('investment and return by year');
    expect(ariaLabel(fixture)).not.toContain('cumulative');
    expect(text(fixture, 'org-roi-annual-trend-table')).not.toContain('Cumulative');
  });

  it('restates both series as running totals when cumulative is chosen', () => {
    const fixture = open();
    click(fixture, 'org-roi-annual-trend-series-cumulative');

    expect(pressed(fixture, 'org-roi-annual-trend-series-cumulative')).toBe('true');
    expect(pressed(fixture, 'org-roi-annual-trend-series-yearly')).toBe('false');

    const table = text(fixture, 'org-roi-annual-trend-table');
    // The first year is its own total either way; the last must carry the whole series.
    expect(table).toContain(formatCurrency(100));
    expect(table).toContain(formatCurrency(CUMULATIVE_INVESTMENT));
    expect(table).toContain(formatCurrency(CUMULATIVE_RETURN));
  });

  it('says which reading the canvas and the table are showing', () => {
    const fixture = open();
    click(fixture, 'org-roi-annual-trend-series-cumulative');

    expect(ariaLabel(fixture)).toContain('cumulative investment and return by year');
    expect(ariaLabel(fixture)).toContain('running total');
    expect(text(fixture, 'org-roi-annual-trend-table')).toContain('Cumulative investment and return by year');
  });

  it('returns to the per-year figures when year over year is chosen again', () => {
    const fixture = open();
    click(fixture, 'org-roi-annual-trend-series-cumulative');
    click(fixture, 'org-roi-annual-trend-series-yearly');

    expect(pressed(fixture, 'org-roi-annual-trend-series-yearly')).toBe('true');
    expect(text(fixture, 'org-roi-annual-trend-table')).not.toContain(formatCurrency(CUMULATIVE_RETURN));
    expect(ariaLabel(fixture)).not.toContain('cumulative');
  });

  it('restates the apportionment disclosure without dropping it', () => {
    const fixture = open();
    const yearly = text(fixture, 'org-roi-annual-trend-apportionment-note');
    click(fixture, 'org-roi-annual-trend-series-cumulative');
    const cumulative = text(fixture, 'org-roi-annual-trend-apportionment-note');

    // The claim both modes owe survives; only the clause about between-year movement is restated,
    // because a running total has no movement between years to misread.
    expect(yearly).toContain('not measured independently for each year');
    expect(cumulative).toContain('not measured independently for each year');
    expect(yearly).toContain('movement between years');
    expect(cumulative).not.toContain('movement between years');
    expect(cumulative).toContain('cumulative curve');
  });

  it('hands the canvas the per-year values and names in year over year', () => {
    const chart = drawn(open());

    expect(chart.labels).toEqual(['2021', '2022', '2023']);
    expect(chart.datasets.map((dataset) => dataset.label)).toEqual(['Investment', 'Return']);
    expect(chart.datasets[0].data).toEqual([100, 200, 300]);
    expect(chart.datasets[1].data).toEqual([400, 900, 1700]);
  });

  it('hands the canvas the running totals and the cumulative names when cumulative is chosen', () => {
    const fixture = open();
    click(fixture, 'org-roi-annual-trend-series-cumulative');
    const chart = drawn(fixture);

    expect(chart.labels).toEqual(['2021', '2022', '2023']);
    expect(chart.datasets.map((dataset) => dataset.label)).toEqual(['Cumulative investment', 'Cumulative return']);
    expect(chart.datasets[0].data).toEqual([100, 300, CUMULATIVE_INVESTMENT]);
    expect(chart.datasets[1].data).toEqual([400, 1300, CUMULATIVE_RETURN]);
  });

  it('returns the canvas to the per-year values and names when year over year is chosen again', () => {
    const fixture = open();
    click(fixture, 'org-roi-annual-trend-series-cumulative');
    click(fixture, 'org-roi-annual-trend-series-yearly');
    const chart = drawn(fixture);

    expect(chart.datasets.map((dataset) => dataset.label)).toEqual(['Investment', 'Return']);
    expect(chart.datasets[0].data).toEqual([100, 200, 300]);
    expect(chart.datasets[1].data).toEqual([400, 900, 1700]);
  });

  it('holds the cumulative spline to the data direction, and only the cumulative one', () => {
    // A running total never falls, but Chart.js's default cubic control points are derived in pixel
    // space from both neighbours, so a small step before a large one draws the curve below the
    // earlier total. 'monotone' is what stops the canvas showing a decline that cannot happen.
    const fixture = open();

    expect(drawn(fixture).datasets.map((dataset) => dataset.cubicInterpolationMode)).toEqual(['default', 'default']);

    click(fixture, 'org-roi-annual-trend-series-cumulative');

    expect(drawn(fixture).datasets.map((dataset) => dataset.cubicInterpolationMode)).toEqual(['monotone', 'monotone']);
  });

  it('offers no toggle when there are no rows to restate', () => {
    rows = [];
    const fixture = open();

    expect(has(fixture, 'org-roi-annual-trend-series-yearly')).toBe(false);
    expect(has(fixture, 'org-roi-annual-trend-series-cumulative')).toBe(false);
    expect(has(fixture, 'org-roi-annual-trend-empty-state')).toBe(true);
  });

  it('reads the same in both modes for a single year', () => {
    rows = [row(2023, 300, 1700)];
    const fixture = open();
    const yearly = text(fixture, 'org-roi-annual-trend-table');
    click(fixture, 'org-roi-annual-trend-series-cumulative');

    expect(text(fixture, 'org-roi-annual-trend-table')).toContain(formatCurrency(300));
    expect(text(fixture, 'org-roi-annual-trend-table')).toContain(formatCurrency(1700));
    expect(yearly).toContain(formatCurrency(1700));
  });
});
