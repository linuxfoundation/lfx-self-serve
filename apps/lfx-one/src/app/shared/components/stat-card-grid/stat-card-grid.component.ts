// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { StatCardItem } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-stat-card-grid',
  imports: [CardComponent],
  templateUrl: './stat-card-grid.component.html',
  styleUrl: './stat-card-grid.component.scss',
})
export class StatCardGridComponent {
  public readonly cards = input.required<StatCardItem[]>();
  public readonly loading = input<boolean>(false);
}
