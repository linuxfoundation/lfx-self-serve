// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { formatDate } from '@angular/common';
import { Pipe, PipeTransform } from '@angular/core';
import { MEETING_DATED_NAME_SOURCES } from '@lfx-one/shared/constants';
import { MyDocumentItem } from '@lfx-one/shared/interfaces';

/**
 * The name shown in a documents table. Recordings, transcripts and summaries are named after their
 * meeting, so every occurrence reads the same; those get the meeting date prepended, in the same
 * format as the Date column. The date comes first so a long, truncated title can't hide it. Everything else, and anything without a valid date, keeps its name.
 */
@Pipe({
  name: 'documentDisplayName',
})
export class DocumentDisplayNamePipe implements PipeTransform {
  public transform(doc: MyDocumentItem): string {
    if (doc.isFolder || !MEETING_DATED_NAME_SOURCES.includes(doc.source) || !Number.isFinite(Date.parse(doc.date))) {
      return doc.name;
    }
    return `${formatDate(doc.date, 'MMM d, y', 'en-US')} – ${doc.name}`;
  }
}
