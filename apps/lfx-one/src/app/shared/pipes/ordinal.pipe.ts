// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';

/** 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
@Pipe({ name: 'ordinal' })
export class OrdinalPipe implements PipeTransform {
  public transform(rank: number): string {
    const lastTwo = rank % 100;
    if (lastTwo >= 11 && lastTwo <= 13) return `${rank}th`;
    switch (rank % 10) {
      case 1:
        return `${rank}st`;
      case 2:
        return `${rank}nd`;
      case 3:
        return `${rank}rd`;
      default:
        return `${rank}th`;
    }
  }
}
