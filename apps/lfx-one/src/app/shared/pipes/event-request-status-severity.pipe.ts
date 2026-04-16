// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { EVENT_REQUEST_STATUS_SEVERITY_MAP, TagSeverity } from '@lfx-one/shared';

/**
 * Transforms event request status to tag severity for consistent styling
 * @description Maps visa/travel fund request status values to appropriate tag colors
 * @example
 * <!-- In template -->
 * <lfx-tag [severity]="request.status | eventRequestStatusSeverity">{{ request.status }}</lfx-tag>
 */
@Pipe({
  name: 'eventRequestStatusSeverity',
})
export class EventRequestStatusSeverityPipe implements PipeTransform {
  public transform(status: string): TagSeverity {
    return EVENT_REQUEST_STATUS_SEVERITY_MAP[status] ?? 'info';
  }
}
