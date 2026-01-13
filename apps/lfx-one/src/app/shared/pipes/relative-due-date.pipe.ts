// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'relativeDueDate',
})
export class RelativeDueDatePipe implements PipeTransform {
  public transform(dueDate: string): string {
    const now = new Date();
    const due = new Date(dueDate);
    const diffTime = due.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const formattedDate = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    // If past due or today - show just the date
    if (diffDays <= 0) {
      return formattedDate;
    }

    // Due soon: show days (1-13 days)
    if (diffDays < 14) {
      return `Due ${formattedDate} · in ${diffDays} ${diffDays === 1 ? 'day' : 'days'}`;
    }

    // Near future: show weeks (14-41 days / 2-6 weeks)
    if (diffDays <= 41) {
      const weeks = Math.round(diffDays / 7);
      return `Due ${formattedDate} · in ${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
    }

    // Later: show months (> 41 days)
    const months = Math.round(diffDays / 30);
    return `Due ${formattedDate} · in ${months} ${months === 1 ? 'month' : 'months'}`;
  }
}
