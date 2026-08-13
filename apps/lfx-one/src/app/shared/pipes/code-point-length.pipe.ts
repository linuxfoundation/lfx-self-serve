// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { codePointLength } from '@lfx-one/shared/utils';

/**
 * Count a string's Unicode code points (emoji/non-BMP chars count once) for character counters,
 * where `String.length` would count UTF-16 units and disagree with the code-point-based limit.
 */
@Pipe({
  name: 'codePointLength',
})
export class CodePointLengthPipe implements PipeTransform {
  public transform(value: string | null | undefined): number {
    return value ? codePointLength(value) : 0;
  }
}
