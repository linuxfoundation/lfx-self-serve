// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { COMBINED_VOTE_STATUS_SEVERITY } from '@lfx-one/shared';
import { TagSeverity, UserVote } from '@lfx-one/shared/interfaces';
import { getCombinedVoteStatus } from '@lfx-one/shared/utils';

@Pipe({
  name: 'combinedVoteStatusSeverity',
})
export class CombinedVoteStatusSeverityPipe implements PipeTransform {
  public transform(vote: UserVote): TagSeverity {
    const status = getCombinedVoteStatus(vote);
    return COMBINED_VOTE_STATUS_SEVERITY[status];
  }
}
