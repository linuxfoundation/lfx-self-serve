// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { DUE_DATE_LABELS } from '@lfx-one/shared';
import { daysUntilInTimezone } from '@lfx-one/shared/utils';

@Pipe({
  name: 'dueDateLabel',
})
export class DueDateLabelPipe implements PipeTransform {
  public transform(dueDate: string, timezone?: string | null): string {
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) return '';
    const diffDays = daysUntilInTimezone(due, timezone);

    // Past due: the row already shows the absolute date, so emit no countdown (mirrors the drawer once daysLeft < 0).
    if (diffDays < 0) return '';

    if (diffDays === 0) return DUE_DATE_LABELS.CLOSES_TODAY;
    if (diffDays === 1) return DUE_DATE_LABELS.CLOSES_TOMORROW;

    if (diffDays < 14) {
      return `Closes in ${diffDays} days`;
    }

    if (diffDays <= 41) {
      const weeks = Math.round(diffDays / 7);
      return `Closes in ${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
    }

    const months = Math.round(diffDays / 30);
    return `Closes in ${months} ${months === 1 ? 'month' : 'months'}`;
  }
}
