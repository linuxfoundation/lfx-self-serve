// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { POLL_STATUS_LABELS, PollStatus } from '@lfx-one/shared';

@Pipe({
  name: 'pollStatusLabel',
})
export class PollStatusLabelPipe implements PipeTransform {
  public transform(status: PollStatus): string {
    return POLL_STATUS_LABELS[status] ?? status;
  }
}
