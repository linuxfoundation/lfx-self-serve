// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { CardComponent } from '@components/card/card.component';
import { PublicProfileCommunityRole } from '@lfx-one/shared/interfaces';

import { PublicProfileDateRangePipe } from '../../pipes/public-profile-date-range.pipe';

@Component({
  selector: 'lfx-public-profile-communities',
  imports: [CardComponent, AvatarComponent, PublicProfileDateRangePipe],
  templateUrl: './public-profile-communities.component.html',
})
export class PublicProfileCommunitiesComponent {
  public readonly roles = input<PublicProfileCommunityRole[]>([]);
}
