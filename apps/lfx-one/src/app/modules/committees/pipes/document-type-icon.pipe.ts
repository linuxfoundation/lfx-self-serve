// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { COMMITTEE_DOCUMENT_TYPE_ICONS } from '@lfx-one/shared/constants';
import { CommitteeDocumentType, DocumentDisplayItem } from '@lfx-one/shared/interfaces';

/** Maps a document type to its icon class (without color). Shared by DocumentIconPipe. */
export function getDocumentTypeIconClass(type: CommitteeDocumentType): string {
  return COMMITTEE_DOCUMENT_TYPE_ICONS[type] ?? COMMITTEE_DOCUMENT_TYPE_ICONS.file;
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
