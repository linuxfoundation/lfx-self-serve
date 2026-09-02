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

/**
 * Whole-count metric — registrations, attendees, speakers. Rounds before formatting because
 * formatNumber's sub-1,000 branch renders the raw float, and these counts come from a
 * prediction model that emits fractions: a predicted registration count reached the drawer as
 * "444.471" people, with "(400.024–488.918)" beside it. People are integers no matter what the
 * model returns, so the rounding belongs here rather than in the shared compact formatter,
 * which other call sites legitimately use for fractional values.
 *
 * The rounding is only observable below 1,000. At or above it formatNumber compacts to one
 * decimal ("1.2K"), which already hides any fraction — so this changes nothing there, and
 * anything comparing counts for equality must compare the FORMATTED strings rather than assume
 * rounding made them distinct.
 */
@Pipe({ standalone: true, name: 'metricCount', pure: true })
export class MetricCountPipe implements PipeTransform {
  public transform(value: number): string {
    if (!Number.isFinite(value)) return formatNumber(value);
    return formatNumber(Math.round(value));
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

/**
 * Percentage to TWO decimals, for rates that live below 1%.
 *
 * One decimal renders a real 0.01% click rate as `0.0%` -- a zero printed beside a nonzero click
 * counter, which reads as "nothing happened" rather than "a little happened". The em dash still
 * means the rate could not be computed at all (no denominator), and that distinction is the whole
 * reason this cannot just round up.
 *
 * Two decimals, not more: this follows the convention already set for CTR in the marketing-impact
 * email tab (`formatPercent(et.ctr, 2)`), where open rate keeps one decimal for the same reason
 * delivery does here -- it is a large number and a second decimal is noise.
 */
@Pipe({ standalone: true, name: 'metricLowPercent', pure: true })
export class MetricLowPercentPipe implements PipeTransform {
  public transform(value: number | null): string {
    return value === null ? '—' : `${formatPercent(value, 2)}%`;
  }
}
