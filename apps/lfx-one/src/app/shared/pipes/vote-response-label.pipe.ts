// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { VOTE_RESPONSE_STATUS_LABELS, VoteResponseStatus } from '@lfx-one/shared';

@Pipe({
  name: 'voteResponseLabel',
})
export class VoteResponseLabelPipe implements PipeTransform {
  public transform(status: VoteResponseStatus): string {
    return VOTE_RESPONSE_STATUS_LABELS[status] ?? status;
  }
}
