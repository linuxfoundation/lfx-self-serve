// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { DOCUMENT_KIND_BY_SOURCE, DOCUMENT_KIND_TAGS } from '@lfx-one/shared/constants';
import { DocumentKindTag, MyDocumentItem } from '@lfx-one/shared/interfaces';

import { FileTypeIconPipe } from './file-type-icon.pipe';

/**
 * Resolves the label bubble and name-column icon for a document. Returns null for folders (they keep
 * their own folder icon) and for rows nothing identifies. Files get a MIME-specific icon when known.
 */
@Pipe({
  name: 'documentKindTag',
})
export class DocumentKindTagPipe implements PipeTransform {
  private readonly fileTypeIcon = new FileTypeIconPipe();

  public transform(doc: MyDocumentItem): DocumentKindTag | null {
    if (doc.isFolder) return null;
    const kind = doc.documentKind ?? DOCUMENT_KIND_BY_SOURCE[doc.source];
    if (!kind) return null;
    const tag = DOCUMENT_KIND_TAGS[kind];
    return kind === 'file' ? { ...tag, icon: this.fileTypeIcon.transform(doc.fileType ?? '') } : tag;
  }
}
