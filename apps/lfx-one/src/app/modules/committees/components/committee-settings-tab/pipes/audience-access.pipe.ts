// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'audienceAccess',
  standalone: true,
  pure: true,
})
export class AudienceAccessPipe implements PipeTransform {
  public transform(value: string | undefined): string {
    if (!value) return '';
    return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
