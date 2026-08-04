// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { PublicProfileEvent } from '@lfx-one/shared/interfaces';

import { PublicProfileDateRangePipe } from '../../pipes/public-profile-date-range.pipe';

@Component({
  selector: 'lfx-public-profile-events',
  imports: [CardComponent, PublicProfileDateRangePipe],
  templateUrl: './public-profile-events.component.html',
})
export class PublicProfileEventsComponent {
  public readonly events = input<PublicProfileEvent[]>([]);
}
