// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { DELTA_DIRECTION_ICON, DELTA_DIRECTION_TEXT_CLASS, GRID_COLS_CLASS } from '@lfx-one/shared/constants';
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
  public readonly columns = input<2 | 3 | 4>(3);

  protected readonly gridColsClass = computed(() => GRID_COLS_CLASS[this.columns()]);
  protected readonly deltaIcon = DELTA_DIRECTION_ICON;
  protected readonly deltaTextClass = DELTA_DIRECTION_TEXT_CLASS;
}
