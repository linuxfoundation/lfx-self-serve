// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'fileTypeIcon',
  standalone: true,
})
export class FileTypeIconPipe implements PipeTransform {
  public transform(mimeType: string): string {
    if (!mimeType) return 'fa-light fa-file';

    if (mimeType.startsWith('image/')) return 'fa-light fa-image';
    if (mimeType === 'application/pdf') return 'fa-light fa-file-pdf';
    if (mimeType.includes('word') || mimeType.includes('document')) return 'fa-light fa-file-word';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'fa-light fa-file-excel';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'fa-light fa-file-powerpoint';
    return 'fa-light fa-file';
  }
}
