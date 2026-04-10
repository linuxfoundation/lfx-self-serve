// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { FileTypeDisplay, MeetingAttachment, PastMeetingAttachment } from '@lfx-one/shared/interfaces';

@Pipe({
  name: 'fileTypeDisplay',
})
export class FileTypeDisplayPipe implements PipeTransform {
  public transform(attachment: MeetingAttachment | PastMeetingAttachment): FileTypeDisplay {
    const ext = (attachment.file_name || attachment.name || '').split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'pdf':
        return { icon: 'fa-light fa-file-pdf', bgColor: 'bg-red-100', textColor: 'text-red-600', label: 'PDF' };
      case 'xlsx':
      case 'xls':
        return { icon: 'fa-light fa-file-spreadsheet', bgColor: 'bg-green-100', textColor: 'text-green-600', label: 'XLSX' };
      case 'docx':
      case 'doc':
        return { icon: 'fa-light fa-file-word', bgColor: 'bg-blue-100', textColor: 'text-blue-600', label: 'DOCX' };
      case 'pptx':
      case 'ppt':
        return { icon: 'fa-light fa-file-powerpoint', bgColor: 'bg-orange-100', textColor: 'text-orange-600', label: 'PPTX' };
      default:
        return { icon: 'fa-light fa-file', bgColor: 'bg-gray-100', textColor: 'text-gray-600', label: ext?.toUpperCase() || 'FILE' };
    }
  }
}
