// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { buildRecurrenceSummary, convertRecurrenceToPattern, MeetingRecurrence } from '@lfx-one/shared';

@Pipe({
  name: 'recurrenceSummary',
})
export class RecurrenceSummaryPipe implements PipeTransform {
  public transform(recurrence: MeetingRecurrence | null | undefined, format: 'full' | 'description' | 'end' = 'full'): string {
    if (!recurrence) {
      return '';
    }

    const pattern = convertRecurrenceToPattern(recurrence);
    const summary = buildRecurrenceSummary(pattern);

    switch (format) {
      case 'description':
        return summary.description;
      case 'end':
        return summary.endDescription;
      case 'full':
      default:
        return summary.fullSummary;
    }
  }
}
