// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { getCommitteeCategorySeverity, TagSeverity } from '@lfx-one/shared';

@Pipe({
  name: 'committeeCategorySeverity',
})
export class CommitteeCategorySeverityPipe implements PipeTransform {
  public transform(category: string): TagSeverity {
    return getCommitteeCategorySeverity(category);
  }
}
