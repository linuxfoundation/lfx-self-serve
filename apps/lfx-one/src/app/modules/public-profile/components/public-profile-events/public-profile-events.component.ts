// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { PublicProfileEvent } from '@lfx-one/shared/interfaces';
import { isValidUrl } from '@lfx-one/shared/utils';

import { PublicProfileDateRangePipe } from '../../pipes/public-profile-date-range.pipe';

@Component({
  selector: 'lfx-public-profile-events',
  imports: [PublicProfileDateRangePipe],
  templateUrl: './public-profile-events.component.html',
})
export class PublicProfileEventsComponent {
  public readonly events = input<PublicProfileEvent[]>([]);

  // Surface an [href] only when the upstream URL is a safe http(s) link; reject
  // javascript:/data: schemes and missing values so they never reach the binding.
  protected safeUrl(url: string | undefined): string | null {
    return url && isValidUrl(url) ? url : null;
  }
}
