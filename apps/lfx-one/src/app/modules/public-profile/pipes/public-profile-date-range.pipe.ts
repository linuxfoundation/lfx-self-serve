// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formats a start/end date pair from the public profile artifact as a human range.
 * Handles partial data: both dates render as "MMM D, YYYY – MMM D, YYYY", a single
 * present date renders on its own, and unparseable/absent values are dropped. Returns
 * an empty string when neither date is usable so callers can hide the field.
 */
@Pipe({
  name: 'publicProfileDateRange',
})
export class PublicProfileDateRangePipe implements PipeTransform {
  public transform(start: string | null | undefined, end: string | null | undefined): string {
    const startLabel = this.format(start);
    const endLabel = this.format(end);

    if (startLabel && endLabel) {
      return `${startLabel} – ${endLabel}`;
    }
    return startLabel || endLabel;
  }

  private format(value: string | null | undefined): string {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    // Drop unparseable values and the epoch/zero-time placeholder (upstream's "no date"
    // sentinel), while keeping any genuine post-epoch date.
    if (Number.isNaN(date.getTime()) || date.getTime() <= 0) {
      return '';
    }
    // Upstream emits UTC ISO-8601 timestamps (e.g. "2024-01-15T00:00:00Z"), so format in UTC —
    // without `timeZone: 'UTC'` a midnight-UTC date shifts to the previous day west of UTC.
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
}
