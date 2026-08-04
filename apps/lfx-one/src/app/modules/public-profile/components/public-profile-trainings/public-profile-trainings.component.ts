// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { PublicProfileTraining } from '@lfx-one/shared/interfaces';

import { PublicProfileDateRangePipe } from '../../pipes/public-profile-date-range.pipe';

@Component({
  selector: 'lfx-public-profile-trainings',
  imports: [CardComponent, PublicProfileDateRangePipe],
  templateUrl: './public-profile-trainings.component.html',
})
export class PublicProfileTrainingsComponent {
  public readonly trainings = input<PublicProfileTraining[]>([]);
}
