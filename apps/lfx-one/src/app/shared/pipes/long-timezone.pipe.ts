// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { getLongTimezoneName } from '@lfx-one/shared/utils';

@Pipe({
  name: 'longTimezone',
})
export class LongTimezonePipe implements PipeTransform {
  public transform(value: string | Date | null | undefined, timezone?: string | null): string {
    return getLongTimezoneName(value, timezone);
  }
}
