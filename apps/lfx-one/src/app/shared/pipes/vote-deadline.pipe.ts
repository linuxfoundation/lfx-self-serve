// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { formatVoteDeadline } from '@lfx-one/shared/utils';

@Pipe({
  name: 'voteDeadline',
})
export class VoteDeadlinePipe implements PipeTransform {
  public transform(value: string | Date | null | undefined, timezone?: string | null): string {
    return formatVoteDeadline(value, timezone);
  }
}
