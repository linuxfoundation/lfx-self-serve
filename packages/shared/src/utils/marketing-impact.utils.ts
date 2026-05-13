// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MarketingImpactMonthOption } from '../interfaces/marketing-impact.interface';

/** Number of past months to show in the Marketing Impact month picker. */
const MONTH_COUNT = 12;

/** Builds the last 12 month options in descending order for the month picker. */
export function buildMarketingImpactMonthOptions(): MarketingImpactMonthOption[] {
  const now = new Date();
  const options: MarketingImpactMonthOption[] = [];

  for (let i = 1; i <= MONTH_COUNT; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    options.push({ label, value });
  }

  return options;
}

/** Returns the default reporting month (previous calendar month). */
export function getDefaultMarketingImpactMonth(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}
