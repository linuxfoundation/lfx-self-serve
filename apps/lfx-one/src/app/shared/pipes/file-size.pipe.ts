// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { formatFileSize } from '@lfx-one/shared/utils';

@Pipe({ name: 'fileSize', standalone: true })
export class FileSizePipe implements PipeTransform {
  public transform(bytes: number | undefined | null): string {
    return formatFileSize(bytes ?? 0);
  }
}
