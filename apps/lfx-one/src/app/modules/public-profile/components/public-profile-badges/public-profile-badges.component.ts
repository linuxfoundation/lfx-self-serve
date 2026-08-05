// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { PublicProfileBadge } from '@lfx-one/shared/interfaces';
import { isValidUrl } from '@lfx-one/shared/utils';

@Component({
  selector: 'lfx-public-profile-badges',
  templateUrl: './public-profile-badges.component.html',
})
export class PublicProfileBadgesComponent {
  public readonly badges = input<PublicProfileBadge[]>([]);

  // Surface an [href] only when the upstream URL is a safe http(s) link; reject
  // javascript:/data: schemes and missing values so they never reach the binding.
  protected safeUrl(url: string | undefined): string | null {
    return url && isValidUrl(url) ? url : null;
  }
}
