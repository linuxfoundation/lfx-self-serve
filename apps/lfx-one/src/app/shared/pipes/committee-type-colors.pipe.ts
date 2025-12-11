// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { getCommitteeTypeColor } from '@lfx-one/shared/constants';

@Pipe({
  name: 'committeeTypeColor',
})
export class CommitteeTypeColorPipe implements PipeTransform {
  public transform(category: string): string {
    return getCommitteeTypeColor(category);
  }
}
