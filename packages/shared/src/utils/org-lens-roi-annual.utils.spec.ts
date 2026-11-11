// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensRoiAnnualRow } from '../interfaces/org-lens-roi.interface';
import { describe, expect, it } from 'vitest';

import { cumulativeAnnualRows } from './org-lens-roi-annual.utils';

/** Mirrors how the warehouse reports a year: ratios from the row's own figures, null when there is no investment. */
function row(year: number, expenditure: number, totalReturn: number): OrgLensRoiAnnualRow {
  const profit = totalReturn - expenditure;
  const hasInvestment = expenditure > 0;
  return { year, totalReturn, expenditure, profit, roi: hasInvestment ? profit / expenditure : null, bcr: hasInvestment ? totalReturn / expenditure : null };
}

const THREE_YEARS = [row(2023, 100, 400), row(2024, 200, 900), row(2025, 300, 1700)];

describe('cumulativeAnnualRows', () => {
  it('accumulates investment and return across the years', () => {
    const result = cumulativeAnnualRows(THREE_YEARS);

    expect(result.map((entry) => entry.expenditure)).toEqual([100, 300, 600]);
    expect(result.map((entry) => entry.totalReturn)).toEqual([400, 1300, 3000]);
  });

  it('lands the final year exactly on the lifetime totals', () => {
    // This is the property that makes the view worth having: the last point must reconcile with the
    // KPI band above the chart, which reports lifetime figures.
    const result = cumulativeAnnualRows(THREE_YEARS);
    const last = result[result.length - 1];

    expect(last.expenditure).toBe(THREE_YEARS.reduce((sum, entry) => sum + entry.expenditure, 0));
    expect(last.totalReturn).toBe(THREE_YEARS.reduce((sum, entry) => sum + entry.totalReturn, 0));
  });

  it('keeps profit consistent with the cumulative figures', () => {
    const result = cumulativeAnnualRows(THREE_YEARS);

    for (const entry of result) {
      expect(entry.profit).toBe(entry.totalReturn - entry.expenditure);
    }
    expect(result.map((entry) => entry.profit)).toEqual([300, 1000, 2400]);
  });

  it('recomputes the ratios from the running totals rather than carrying the year’s own', () => {
    const result = cumulativeAnnualRows(THREE_YEARS);

    // 2024 alone is 900/200; through 2024 it is 1300/300.
    expect(result[1].bcr).toBeCloseTo(1300 / 300, 10);
    expect(result[1].roi).toBeCloseTo((1300 - 300) / 300, 10);
    expect(result[1].bcr).not.toBeCloseTo(THREE_YEARS[1].bcr as number, 5);
  });

  it('reports no ratio — not zero — while there is no cumulative investment to divide by', () => {
    const result = cumulativeAnnualRows([row(2023, 0, 0), row(2024, 0, 500), row(2025, 250, 500)]);

    expect(result[0].roi).toBeNull();
    expect(result[0].bcr).toBeNull();
    expect(result[1].roi).toBeNull();
    expect(result[1].bcr).toBeNull();
    // Once investment arrives, the ratios cover everything accumulated so far, return included.
    expect(result[2].bcr).toBeCloseTo(1000 / 250, 10);
  });

  it('sorts by year before accumulating, so row order cannot change the values', () => {
    const shuffled = [THREE_YEARS[2], THREE_YEARS[0], THREE_YEARS[1]];

    expect(cumulativeAnnualRows(shuffled)).toEqual(cumulativeAnnualRows(THREE_YEARS));
    expect(cumulativeAnnualRows(shuffled).map((entry) => entry.year)).toEqual([2023, 2024, 2025]);
  });

  it('does not mutate or reorder the caller’s array', () => {
    const input = [THREE_YEARS[2], THREE_YEARS[0], THREE_YEARS[1]];
    const before = [...input];

    cumulativeAnnualRows(input);

    expect(input).toEqual(before);
    expect(input[0].expenditure).toBe(300);
  });

  it('carries the total across a gap year without inventing a row for it', () => {
    const result = cumulativeAnnualRows([row(2020, 100, 400), row(2025, 200, 900)]);

    expect(result.map((entry) => entry.year)).toEqual([2020, 2025]);
    expect(result.map((entry) => entry.expenditure)).toEqual([100, 300]);
  });

  it('returns a single year unchanged in value', () => {
    expect(cumulativeAnnualRows([row(2025, 300, 1700)])).toEqual([row(2025, 300, 1700)]);
  });

  it('returns nothing for no rows', () => {
    expect(cumulativeAnnualRows([])).toEqual([]);
  });
});
