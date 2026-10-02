// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { NamedEntity } from '@lfx-one/shared/interfaces';
import { composeFullName } from '@lfx-one/shared/utils';

@Pipe({
  name: 'fullName',
})
export class FullNamePipe implements PipeTransform {
  public transform(entity: NamedEntity | null | undefined, fallback = '-'): string {
    if (!entity) return fallback;

    const fullName = composeFullName(entity.first_name, entity.last_name);
    if (fullName) {
      return fullName;
    }

    return entity.email || fallback;
  }
}
