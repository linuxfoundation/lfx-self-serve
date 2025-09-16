// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { buildRecurrenceSummary, CustomRecurrencePattern, MeetingRecurrence } from '@lfx-one/shared';

@Pipe({
  name: 'recurrenceSummary',
  standalone: true,
})
export class RecurrenceSummaryPipe implements PipeTransform {
  public transform(recurrence: MeetingRecurrence | null | undefined, format: 'full' | 'description' | 'end' = 'full'): string {
    if (!recurrence) {
      return '';
    }

    const pattern = this.convertToRecurrencePattern(recurrence);
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

  private convertToRecurrencePattern(recurrence: MeetingRecurrence): CustomRecurrencePattern {
    // Determine pattern type from recurrence.type
    let patternType: 'daily' | 'weekly' | 'monthly' = 'weekly';
    if (recurrence.type === 1) patternType = 'daily';
    else if (recurrence.type === 2) patternType = 'weekly';
    else if (recurrence.type === 3) patternType = 'monthly';

    // Determine monthly type
    let monthlyType: 'dayOfMonth' | 'dayOfWeek' = 'dayOfMonth';
    if (recurrence.monthly_day) {
      monthlyType = 'dayOfMonth';
    } else if (recurrence.monthly_week && recurrence.monthly_week_day) {
      monthlyType = 'dayOfWeek';
    }

    // Determine end type
    let endType: 'never' | 'date' | 'occurrences' = 'never';
    if (recurrence.end_date_time) endType = 'date';
    else if (recurrence.end_times) endType = 'occurrences';

    // Convert weekly_days to array if present
    let weeklyDaysArray: number[] = [];
    if (recurrence.weekly_days) {
      weeklyDaysArray = recurrence.weekly_days.split(',').map((d) => parseInt(d.trim()) - 1);
    }

    return {
      ...recurrence,
      patternType,
      monthlyType,
      endType,
      weeklyDaysArray,
    };
  }
}
