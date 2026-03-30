// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { DocumentDisplayItem } from '@lfx-one/shared/interfaces';

@Pipe({
  name: 'sourceLabel',
  standalone: true,
})
export class SourceLabelPipe implements PipeTransform {
  public transform(item: DocumentDisplayItem): string {
    if (item.source === 'folder') return 'Folder';
    if (item.source === 'meeting') return 'Meeting';
    if (item.source === 'file') return 'File';
    return 'Link';
  }
}
