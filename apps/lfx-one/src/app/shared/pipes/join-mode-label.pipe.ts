// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { JOIN_MODE_LABELS } from '@lfx-one/shared/constants';
import { JoinMode } from '@lfx-one/shared/interfaces';

@Pipe({
  name: 'joinModeLabel',
  standalone: true,
})
export class JoinModeLabelPipe implements PipeTransform {
  public transform(mode: JoinMode | undefined): string {
    return (mode && JOIN_MODE_LABELS[mode]) || 'Closed';
  }
}
