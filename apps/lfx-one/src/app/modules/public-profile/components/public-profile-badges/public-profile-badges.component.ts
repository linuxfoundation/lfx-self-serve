// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { PublicProfileBadge } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-public-profile-badges',
  imports: [CardComponent],
  templateUrl: './public-profile-badges.component.html',
})
export class PublicProfileBadgesComponent {
  public readonly badges = input<PublicProfileBadge[]>([]);
}
