// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { formatHubSpotUpdatedAt } from '@lfx-one/shared/utils';

/**
 * Render a HubSpot template's `updatedAt` in a row.
 *
 * A pipe rather than a component method because the template picker renders up to 500 rows:
 * `docs/reviews/frontend-checklist.md` §4 forbids template method calls, which re-run for every
 * row on every change-detection pass. A pure pipe memoizes per input instead.
 */
@Pipe({
  name: 'hubspotUpdatedAt',
})
export class HubSpotUpdatedAtPipe implements PipeTransform {
  public transform(value: string | undefined): string {
    return formatHubSpotUpdatedAt(value);
  }
}
