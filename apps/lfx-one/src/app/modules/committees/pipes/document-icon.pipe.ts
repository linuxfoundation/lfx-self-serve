// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { CommitteeDocumentType, DocumentDisplayItem } from '@lfx-one/shared/interfaces';
import { getDocumentTypeIconClass } from './document-type-icon.pipe';

const DOCUMENT_ICON_COLORS: Record<CommitteeDocumentType, string> = {
  folder: 'text-amber-500',
  link: 'text-blue-500',
  file: 'text-red-400',
};

@Pipe({
  name: 'documentIcon',
  standalone: true,
  pure: true,
})
export class DocumentIconPipe implements PipeTransform {
  public transform(item: DocumentDisplayItem): string {
    return `${getDocumentTypeIconClass(item.type)} ${DOCUMENT_ICON_COLORS[item.type] ?? 'text-red-400'}`;
  }
}
