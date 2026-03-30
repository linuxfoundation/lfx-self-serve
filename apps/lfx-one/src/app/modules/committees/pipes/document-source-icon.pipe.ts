// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { CommitteeDocumentSource } from '@lfx-one/shared/interfaces';
import { DOCUMENT_SOURCE_ICONS } from '@lfx-one/shared/constants';

const ICON_COLORS: Record<CommitteeDocumentSource, string> = {
  link: 'text-blue-500',
  file: 'text-red-400',
  recording: 'text-purple-500',
  transcript: 'text-teal-500',
  summary: 'text-amber-500',
};

@Pipe({
  name: 'documentSourceIcon',
  standalone: true,
  pure: true,
})
export class DocumentSourceIconPipe implements PipeTransform {
  public transform(source: CommitteeDocumentSource): string {
    const icon = DOCUMENT_SOURCE_ICONS[source] || '';
    const color = ICON_COLORS[source] || '';
    return `${icon} ${color}`.trim();
  }
}
