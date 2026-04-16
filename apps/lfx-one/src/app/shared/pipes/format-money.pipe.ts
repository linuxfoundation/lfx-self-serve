// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { formatCurrency } from '@lfx-one/shared/utils';

@Pipe({
  standalone: true,
  name: 'formatMoney',
})
export class FormatMoneyPipe implements PipeTransform {
  public transform(value: number): string {
    return formatCurrency(value);
  }
}
