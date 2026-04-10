// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'fileSize', standalone: true })
export class FileSizePipe implements PipeTransform {
  public transform(bytes: number | undefined | null): string {
    if (!bytes) return '0 KB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1024).toFixed(0) + ' KB';
  }
}
