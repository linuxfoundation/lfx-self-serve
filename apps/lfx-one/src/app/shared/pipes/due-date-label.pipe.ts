// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { DUE_DATE_LABELS } from '@lfx-one/shared';

@Pipe({
  name: 'dueDateLabel',
})
export class DueDateLabelPipe implements PipeTransform {
  public transform(dueDate: string): string {
    const now = new Date();
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) return '';
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const diffTime = dueDay.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

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
