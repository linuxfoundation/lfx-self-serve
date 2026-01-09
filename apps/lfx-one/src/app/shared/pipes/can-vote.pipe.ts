// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { PollStatus, VoteResponseStatus } from '@lfx-one/shared';
import { UserVote } from '@lfx-one/shared/interfaces';

@Pipe({
  name: 'canVote',
})
export class CanVotePipe implements PipeTransform {
  public transform(vote: UserVote): boolean {
    return vote.poll_status === PollStatus.ACTIVE && vote.vote_status === VoteResponseStatus.AWAITING_RESPONSE;
  }
}
