// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { COMBINED_VOTE_STATUS_LABELS } from '@lfx-one/shared';
import { UserVote } from '@lfx-one/shared/interfaces';
import { getCombinedVoteStatus } from '@lfx-one/shared/utils';

@Pipe({
  name: 'combinedVoteStatusLabel',
})
export class CombinedVoteStatusLabelPipe implements PipeTransform {
  public transform(vote: UserVote): string {
    const status = getCombinedVoteStatus(vote);
    return COMBINED_VOTE_STATUS_LABELS[status];
  }
}
