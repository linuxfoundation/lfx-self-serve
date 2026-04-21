// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';

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

    if (diffDays <= 0) return '';

    if (diffDays < 14) {
      return `Due in ${diffDays} ${diffDays === 1 ? 'day' : 'days'}`;
    }

    if (diffDays <= 41) {
      const weeks = Math.round(diffDays / 7);
      return `Due in ${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
    }

    const months = Math.round(diffDays / 30);
    return `Due in ${months} ${months === 1 ? 'month' : 'months'}`;
  }
}
