// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { CommitteeDocumentSource } from '@lfx-one/shared/interfaces';

interface DocumentAction {
  icon: string;
  tooltip: string;
}

const DOCUMENT_SOURCE_ACTIONS: Record<CommitteeDocumentSource, DocumentAction> = {
  link: { icon: 'fa-light fa-external-link', tooltip: 'Open Link' },
  file: { icon: 'fa-light fa-download', tooltip: 'Download' },
  recording: { icon: 'fa-light fa-play', tooltip: 'View Recording' },
  transcript: { icon: 'fa-light fa-download', tooltip: 'Download Transcript' },
  summary: { icon: 'fa-light fa-eye', tooltip: 'View Summary' },
};

@Pipe({
  name: 'documentSourceAction',
  standalone: true,
  pure: true,
})
export class DocumentSourceActionPipe implements PipeTransform {
  public transform(source: CommitteeDocumentSource, field: 'icon'): string;
  public transform(source: CommitteeDocumentSource, field: 'tooltip'): string;
  public transform(source: CommitteeDocumentSource, field: 'icon' | 'tooltip'): string {
    return DOCUMENT_SOURCE_ACTIONS[source]?.[field] ?? '';
  }
}
