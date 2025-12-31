// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { LinkedGroup } from '@lfx-one/shared/interfaces';

/**
 * Slices a LinkedGroup array with proper type preservation
 * @description Takes an array of LinkedGroup objects and returns a typed slice
 * @example
 * <!-- In template -->
 * @for (group of mailingList.committees | sliceLinkedGroups: maxVisibleGroups; track group.uid)
 */
@Pipe({
  name: 'sliceLinkedGroups',
})
export class SliceLinkedGroupsPipe implements PipeTransform {
  public transform(groups: LinkedGroup[], limit: number): LinkedGroup[] {
    if (!groups || !Array.isArray(groups)) {
      return [];
    }
    return groups.slice(0, limit);
  }
}
