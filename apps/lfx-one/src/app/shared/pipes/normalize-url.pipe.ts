// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { normalizeToUrl } from '@lfx-one/shared';

@Pipe({
  name: 'normalizeUrl',
})
export class NormalizeUrlPipe implements PipeTransform {
  /**
   * Transforms a domain or URL string into a valid URL
   * @param value - The domain or URL string to transform
   * @returns A valid URL string or null if invalid
   */
  public transform(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    return normalizeToUrl(value);
  }
}
