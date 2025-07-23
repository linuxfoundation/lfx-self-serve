// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { ObjectPermission } from '@lfx-pcc/shared/interfaces';

@Pipe({
  name: 'committeeNames',
  standalone: true,
})
export class CommitteeNamesPipe implements PipeTransform {
  public transform(committees: ObjectPermission[]): string {
    return committees.map((committee) => committee.committee_name).join(', ');
  }
}
