// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { CommitteeDocumentType, DocumentDisplayItem } from '@lfx-one/shared/interfaces';

/** Maps a document type to its icon class (without color). Shared by DocumentIconPipe. */
export function getDocumentTypeIconClass(type: CommitteeDocumentType): string {
  if (type === 'folder') return 'fa-light fa-folder';
  if (type === 'link') return 'fa-light fa-link';
  return 'fa-light fa-file';
}

@Pipe({
  name: 'documentTypeIcon',
  standalone: true,
})
export class DocumentTypeIconPipe implements PipeTransform {
  public transform(item: DocumentDisplayItem): string {
    return getDocumentTypeIconClass(item.type);
  }
}
