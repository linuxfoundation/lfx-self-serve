// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'isDueWithinMonth',
})
export class IsDueWithinMonthPipe implements PipeTransform {
  public transform(endTime: string): boolean {
    const now = new Date();
    const due = new Date(endTime);
    const diffTime = due.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays > 0 && diffDays <= 30;
  }
}
