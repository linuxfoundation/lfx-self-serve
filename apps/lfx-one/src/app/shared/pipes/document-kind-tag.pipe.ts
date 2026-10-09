// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { DOCUMENT_KIND_TAGS } from '@lfx-one/shared/constants';
import { DocumentKind, MyDocumentItem, TagSeverity } from '@lfx-one/shared/interfaces';

/** Sources that already say what the document is, for rows that don't carry an explicit `documentKind`. */
const KIND_BY_SOURCE: Partial<Record<MyDocumentItem['source'], DocumentKind>> = {
  file: 'file',
  link: 'link',
  recording: 'recording',
  transcript: 'transcript',
  summary: 'summary',
};

/** Resolves the label bubble shown next to a document's name. Returns null for folders and unclassifiable rows. */
@Pipe({
  name: 'documentKindTag',
})
export class DocumentKindTagPipe implements PipeTransform {
  public transform(doc: MyDocumentItem): { value: string; severity: TagSeverity } | null {
    if (doc.isFolder) return null;
    const kind = doc.documentKind ?? KIND_BY_SOURCE[doc.source];
    return kind ? DOCUMENT_KIND_TAGS[kind] : null;
  }
}
