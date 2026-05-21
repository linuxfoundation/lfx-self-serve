// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { DonationStats } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-donations-stats-bar',
  imports: [CardComponent, DecimalPipe],
  templateUrl: './donations-stats-bar.component.html',
  styleUrl: './donations-stats-bar.component.scss',
})
export class DonationsStatsBarComponent {
  public readonly stats = input.required<DonationStats>();
}
