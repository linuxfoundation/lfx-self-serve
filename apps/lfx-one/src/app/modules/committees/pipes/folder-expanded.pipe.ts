// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'folderExpanded',
  standalone: true,
  pure: true,
})
export class FolderExpandedPipe implements PipeTransform {
  public transform(folderUid: string, expandedFolders: Set<string>): boolean {
    return expandedFolders.has(folderUid);
  }
}
