// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensRoiAnnualRow } from '../interfaces/org-lens-roi.interface';

/**
 * The annual rows restated as running totals: each year carries every year up to and including it.
 *
 * The input is sorted defensively. `/annual` orders by year (`org-lens-roi.service.ts`), but that
 * is the server's doing rather than anything the row contract promises, and order is load-bearing
 * here in a way it is not year over year: out of order it only mislabels the x axis, cumulatively
 * it changes the values.
 *
 * Gap years are left as gaps. The x axis is a category scale of the years actually present, so a
 * gap already reads as two adjacent labels, and the running total simply carries across it — which
 * is the true cumulative figure, since a year the warehouse did not report contributed nothing.
 * Inventing a zero row would draw a dip that never happened.
 *
 * `roi` and `bcr` are recomputed from the cumulative figures rather than carried over: a running
 * total's ratios are not the last year's. Both stay null — never zero — while there is no
 * cumulative investment to divide by, which is how the warehouse reports them.
 */
export function cumulativeAnnualRows(rows: readonly OrgLensRoiAnnualRow[]): OrgLensRoiAnnualRow[] {
  let expenditure = 0;
  let totalReturn = 0;

  return [...rows]
    .sort((a, b) => a.year - b.year)
    .map((row) => {
      expenditure += row.expenditure;
      totalReturn += row.totalReturn;
      const hasInvestment = expenditure > 0;

      return {
        year: row.year,
        totalReturn,
        expenditure,
        profit: totalReturn - expenditure,
        roi: hasInvestment ? (totalReturn - expenditure) / expenditure : null,
        bcr: hasInvestment ? totalReturn / expenditure : null,
      };
    });
}
