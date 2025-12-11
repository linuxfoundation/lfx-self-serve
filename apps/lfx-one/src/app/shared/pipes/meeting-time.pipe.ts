// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'meetingTime',
})
export class MeetingTimePipe implements PipeTransform {
  public transform(startTime: string | null, duration: number | null, format: 'full' | 'full-start' | 'date' | 'time' | 'compact' = 'full'): string {
    if (!startTime) {
      return 'Time not set';
    }

    try {
      // Parse the start time - it should be in ISO format with timezone info
      const startDate = new Date(startTime);

      // If the date is invalid, return error message
      if (isNaN(startDate.getTime())) {
        return 'Invalid date';
      }

      // Calculate end time if duration is provided (duration is in minutes)
      const endDate = duration ? new Date(startDate.getTime() + duration * 60000) : null;

      // Format date: Monday, August 4, 2025
      const dateOptions: Intl.DateTimeFormatOptions = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      };

      // Format time: 3:00 PM
      const timeOptions: Intl.DateTimeFormatOptions = {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      };

      const dateStr = startDate.toLocaleDateString('en-US', dateOptions);
      const startTimeStr = startDate.toLocaleTimeString('en-US', timeOptions);

      switch (format) {
        case 'compact': {
          // Return compact format: Wed, Aug 26 • 11:30 PM - 12:30 AM
          const compactDateOptions: Intl.DateTimeFormatOptions = {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          };
          const compactDateStr = startDate.toLocaleDateString('en-US', compactDateOptions);
          if (endDate) {
            const endTimeStr = endDate.toLocaleTimeString('en-US', timeOptions);
            return `${compactDateStr} • ${startTimeStr} - ${endTimeStr}`;
          }
          return `${compactDateStr} • ${startTimeStr}`;
        }

        case 'date':
          // Return just the date: Monday, August 4, 2025
          return dateStr;

        case 'time': {
          // Return just the time range: 3:00 PM - 4:00 PM
          if (endDate) {
            const endTimeStr = endDate.toLocaleTimeString('en-US', timeOptions);
            return `${startTimeStr} - ${endTimeStr}`;
          }
          return startTimeStr;
        }

        case 'full-start':
          return `${dateStr} @ ${startTimeStr}`;

        case 'full':
        default: {
          // Return full format: Monday, August 4, 2025 3:00 PM - 4:00 PM
          if (endDate) {
            const endTimeStr = endDate.toLocaleTimeString('en-US', timeOptions);
            return `${dateStr} @ ${startTimeStr} - ${endTimeStr}`;
          }
          return `${dateStr} ${startTimeStr}`;
        }
      }
    } catch {
      return 'Invalid date';
    }
  }
}
