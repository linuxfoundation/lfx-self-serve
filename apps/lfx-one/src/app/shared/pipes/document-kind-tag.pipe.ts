// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { DOCUMENT_KIND_BY_SOURCE, DOCUMENT_KIND_TAGS } from '@lfx-one/shared/constants';
import { MyDocumentItem, TagSeverity } from '@lfx-one/shared/interfaces';

/** Resolves the label bubble shown next to a document's name. Returns null for folders and unclassifiable rows. */
@Pipe({
  name: 'documentKindTag',
})
export class DocumentKindTagPipe implements PipeTransform {
  public transform(doc: MyDocumentItem): { value: string; severity: TagSeverity } | null {
    if (doc.isFolder) return null;
    const kind = doc.documentKind ?? DOCUMENT_KIND_BY_SOURCE[doc.source];
    return kind ? DOCUMENT_KIND_TAGS[kind] : null;
  }
}
