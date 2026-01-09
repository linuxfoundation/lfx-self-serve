// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { PollStatus, POLL_STATUS_SEVERITY, TagSeverity } from '@lfx-one/shared';

/**
 * Transforms poll status to tag severity for consistent styling
 * @description Maps PollStatus enum values to appropriate tag colors
 * @example
 * <!-- In template -->
 * <lfx-tag [severity]="vote.poll_status | pollStatusSeverity">{{ vote.poll_status }}</lfx-tag>
 */
@Pipe({
  name: 'pollStatusSeverity',
})
export class PollStatusSeverityPipe implements PipeTransform {
  public transform(status: PollStatus): TagSeverity {
    return POLL_STATUS_SEVERITY[status] ?? 'secondary';
  }
}
