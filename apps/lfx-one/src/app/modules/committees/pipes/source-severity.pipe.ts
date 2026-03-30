// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { DocumentDisplayItem, TagSeverity } from '@lfx-one/shared/interfaces';

@Pipe({
  name: 'sourceSeverity',
  standalone: true,
})
export class SourceSeverityPipe implements PipeTransform {
  public transform(item: DocumentDisplayItem): TagSeverity {
    if (item.source === 'folder') return 'info';
    if (item.source === 'meeting') return 'warn';
    if (item.source === 'file') return 'secondary';
    return 'success';
  }
}
