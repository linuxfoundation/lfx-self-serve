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

    // If past due or today
    if (diffDays <= 0) {
      return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    // Within 1 week (1-7 days)
    if (diffDays <= 7) {
      return 'Due in 1 week';
    }

    // Within 2 weeks (8-14 days)
    if (diffDays <= 14) {
      return 'Due in 2 weeks';
    }

    // Within 1 month (15-30 days)
    if (diffDays <= 30) {
      return 'Due in 1 month';
    }

    // More than 1 month away - show the date
    return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
