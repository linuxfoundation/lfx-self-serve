// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_LENS_ROI_VALUE_DRIVER_CATEGORIES, ORG_LENS_ROI_VALUE_DRIVERS_COLORS } from '../constants/org-lens-roi.constants';
import type { OrgLensRoiValueDriverBar, OrgLensRoiValueDriverRow } from '../interfaces/org-lens-roi.interface';

/** `+14.2%` / `-5.3%`; a rounded zero carries no sign so it never reads as a direction. */
export function formatSignedPercent(value: number, fractionDigits = 1): string {
  const rounded = Number(value.toFixed(fractionDigits));
  if (rounded === 0) return `${(0).toFixed(fractionDigits)}%`;
  return `${rounded > 0 ? '+' : '-'}${Math.abs(rounded).toFixed(fractionDigits)}%`;
}

/**
 * A symmetric axis bound on a 1/2/5 step, so zero sits in the middle and the Average line is the
 * visual centre. At least 10, so a portfolio near average does not stretch tiny bars across the plot.
 */
export function valueDriverAxisBound(rows: OrgLensRoiValueDriverRow[]): number {
  const max = Math.max(0, ...rows.map((row) => Math.abs(row.pctDeviation)));
  const steps = [10, 20, 50, 100, 200, 500];
  return steps.find((step) => max <= step) ?? Math.ceil(max / 100) * 100;
}

/** Largest positive deviation first, as the chart reads top-down; unknown categories get no subtitle. */
export function buildValueDriverBars(rows: OrgLensRoiValueDriverRow[]): OrgLensRoiValueDriverBar[] {
  const subtitles = new Map<string, string>(ORG_LENS_ROI_VALUE_DRIVER_CATEGORIES.map((entry) => [entry.category, entry.subtitle]));
  return [...rows]
    .sort((a, b) => b.pctDeviation - a.pctDeviation)
    .map((row) => ({
      ...row,
      subtitle: subtitles.get(row.category) ?? '',
      color: row.pctDeviation >= 0 ? ORG_LENS_ROI_VALUE_DRIVERS_COLORS.moreThanAverage : ORG_LENS_ROI_VALUE_DRIVERS_COLORS.lessThanAverage,
      label: formatSignedPercent(row.pctDeviation),
    }));
}
