// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { formatCompactRounded, formatNumber, formatPercent } from '@lfx-one/shared/utils';

/**
 * Formatting pipes for dashboard metrics.
 *
 * These exist so templates can format without calling component methods, which re-execute on every
 * change-detection pass (docs/reviews/frontend-checklist.md §4). Pure pipes memoize on their input,
 * so a value that has not changed is not reformatted.
 *
 * They wrap the shared utils rather than reimplementing them, so a template and a computed that
 * format the same number cannot disagree.
 */
@Pipe({ standalone: true, name: 'metricNumber', pure: true })
export class MetricNumberPipe implements PipeTransform {
  public transform(value: number): string {
    return formatNumber(value);
  }
}

/** Compact currency — $1.2K / $11.9M — matching the shared formatter used server-side. */
@Pipe({ standalone: true, name: 'metricMoney', pure: true })
export class MetricMoneyPipe implements PipeTransform {
  public transform(value: number): string {
    return formatCompactRounded(value, '$');
  }
}

/** Percentage to one decimal; an em dash when the rate could not be computed. */
@Pipe({ standalone: true, name: 'metricPercent', pure: true })
export class MetricPercentPipe implements PipeTransform {
  public transform(value: number | null): string {
    return value === null ? '—' : `${formatPercent(value)}%`;
  }
}
