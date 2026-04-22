// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { LinkedGroup } from '@lfx-one/shared/interfaces';

/**
 * Transforms remaining linked groups to a tooltip string
 * @description Takes an array of LinkedGroup objects starting from an offset and joins their names
 * @example
 * <!-- In template -->
 * [pTooltip]="mailingList.committees | remainingGroupsTooltip: maxVisibleGroups"
 */
@Pipe({
  name: 'remainingGroupsTooltip',
})
export class RemainingGroupsTooltipPipe implements PipeTransform {
  public transform(groups: LinkedGroup[], startIndex: number): string {
    if (!groups || groups.length <= startIndex) {
      return '';
    }
    // Fall back to uid when name is missing (e.g., enrichment failure or partial resolution)
    // so tooltip/aria-label never degrade to empty strings or stray commas.
    return groups
      .slice(startIndex)
      .map((g) => g?.name || g?.uid)
      .filter((label): label is string => !!label)
      .join(', ');
  }
}
