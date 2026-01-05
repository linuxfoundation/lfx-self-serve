// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { stripHtml } from '@lfx-one/shared';

@Pipe({
  name: 'stripHtml',
})
export class StripHtmlPipe implements PipeTransform {
  public transform(value: string | null | undefined): string {
    return stripHtml(value);
  }
}
