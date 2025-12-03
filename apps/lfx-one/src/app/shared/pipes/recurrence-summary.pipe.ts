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
    // Parse numeric values that might come as strings from v1 meetings
    // type defaults to 2 (weekly), repeat_interval defaults to 1
    const type = this.parseToInt(recurrence.type) ?? 2;
    const monthlyDay = this.parseToInt(recurrence.monthly_day);
    const monthlyWeek = this.parseToInt(recurrence.monthly_week);
    const monthlyWeekDay = this.parseToInt(recurrence.monthly_week_day);
    const endTimes = this.parseToInt(recurrence.end_times);
    const repeatInterval = this.parseToInt(recurrence.repeat_interval) ?? 1;

    // Determine pattern type from recurrence.type
    let patternType: 'daily' | 'weekly' | 'monthly' = 'weekly';
    if (type === 1) patternType = 'daily';
    else if (type === 2) patternType = 'weekly';
    else if (type === 3) patternType = 'monthly';

    // Determine monthly type
    // Use explicit undefined checks to handle 0 values correctly (0 is a valid day-of-week for Sunday)
    let monthlyType: 'dayOfMonth' | 'dayOfWeek' = 'dayOfMonth';
    if (monthlyDay !== undefined) {
      monthlyType = 'dayOfMonth';
    } else if (monthlyWeek !== undefined && monthlyWeekDay !== undefined) {
      monthlyType = 'dayOfWeek';
    }

    // Determine end type
    let endType: 'never' | 'date' | 'occurrences' = 'never';
    if (recurrence.end_date_time) endType = 'date';
    else if (endTimes) endType = 'occurrences';

    // Convert weekly_days to array if present
    let weeklyDaysArray: number[] = [];
    if (recurrence.weekly_days) {
      weeklyDaysArray = recurrence.weekly_days.split(',').map((d) => parseInt(d.trim()) - 1);
    }

    return {
      ...recurrence,
      type,
      monthly_day: monthlyDay,
      monthly_week: monthlyWeek,
      monthly_week_day: monthlyWeekDay,
      end_times: endTimes,
      repeat_interval: repeatInterval,
      patternType,
      monthlyType,
      endType,
      weeklyDaysArray,
    };
  }

  /**
   * Parse a value to integer, handling both string and number inputs.
   * Returns undefined if the value is undefined, null, or cannot be parsed.
   */
  private parseToInt(value: string | number | undefined | null): number | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === 'number') {
      return value;
    }
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? undefined : parsed;
  }
}
