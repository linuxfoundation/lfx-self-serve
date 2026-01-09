// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { VoteResponseStatus, VOTE_RESPONSE_STATUS_SEVERITY, TagSeverity } from '@lfx-one/shared';

/**
 * Transforms vote response status to tag severity for consistent styling
 * @description Maps VoteResponseStatus enum values to appropriate tag colors
 * @example
 * <!-- In template -->
 * <lfx-tag [severity]="vote.vote_status | voteResponseSeverity">{{ vote.vote_status }}</lfx-tag>
 */
@Pipe({
  name: 'voteResponseSeverity',
})
export class VoteResponseSeverityPipe implements PipeTransform {
  public transform(status: VoteResponseStatus): TagSeverity {
    return VOTE_RESPONSE_STATUS_SEVERITY[status] ?? 'secondary';
  }
}
