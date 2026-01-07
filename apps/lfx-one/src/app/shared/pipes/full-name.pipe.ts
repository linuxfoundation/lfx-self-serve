// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { NamedEntity } from '@lfx-one/shared/interfaces';

@Pipe({
  name: 'fullName',
})
export class FullNamePipe implements PipeTransform {
  public transform(entity: NamedEntity | null | undefined, fallback = '-'): string {
    if (!entity) return fallback;

    const parts = [entity.first_name, entity.last_name].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(' ');
    }

    return entity.email || fallback;
  }
}
