// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { Committee } from '@lfx-one/shared/interfaces';

@Pipe({
  name: 'committeeNames',
  standalone: true,
})
export class CommitteeNamesPipe implements PipeTransform {
  public transform(committeePermissions: { committee: Committee; level: string; scope: string }[]): string {
    if (!committeePermissions || committeePermissions.length === 0) {
      return '';
    }

    return committeePermissions.map((cp) => cp.committee.name).join(', ');
  }
}
