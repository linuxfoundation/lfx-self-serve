// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { PublicProfileBadge } from '@lfx-one/shared/interfaces';
import { SafeUrlPipe } from '@pipes/safe-url.pipe';

@Component({
  selector: 'lfx-public-profile-badges',
  imports: [SafeUrlPipe],
  templateUrl: './public-profile-badges.component.html',
})
export class PublicProfileBadgesComponent {
  public readonly badges = input<PublicProfileBadge[]>([]);
}
