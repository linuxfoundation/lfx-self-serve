// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';

/** Renders a field value with an em-dash placeholder for null/undefined/empty; numbers are locale-formatted. Used by Org Profile (spec 021) read-only meta rows. */
@Pipe({
  name: 'displayValue',
  standalone: true,
  pure: true,
})
export class DisplayValuePipe implements PipeTransform {
  public transform(value: string | number | null | undefined, locale: string = 'en-US'): string {
    if (value === null || value === undefined || value === '') return '—';
    return typeof value === 'number' ? value.toLocaleString(locale) : value;
  }
}
