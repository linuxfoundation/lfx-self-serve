// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { CommitteeDocumentSource, TagSeverity } from '@lfx-one/shared/interfaces';
import { DOCUMENT_SOURCE_TAGS } from '@lfx-one/shared/constants';

@Pipe({
  name: 'documentSourceTag',
  pure: true,
})
export class DocumentSourceTagPipe implements PipeTransform {
  public transform(source: CommitteeDocumentSource, field: 'severity'): TagSeverity;
  public transform(source: CommitteeDocumentSource, field: 'value' | 'icon'): string;
  public transform(source: CommitteeDocumentSource, field: 'value' | 'severity' | 'icon'): string | TagSeverity {
    return DOCUMENT_SOURCE_TAGS[source]?.[field] || '';
  }
}
