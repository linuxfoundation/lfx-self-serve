// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { FilterPillOption } from '@lfx-one/shared/interfaces';
import { FilterPillsComponent } from '../filter-pills/filter-pills.component';

/**
 * A standardised top-bar that lives at the top of a `<lfx-card>` with `p-0` body padding.
 * It renders the tab pills on the left and projects any action elements (buttons, etc.) on the right.
 * Includes a bottom border separator matching the card's inner divider style.
 *
 * Usage:
 * ```html
 * <lfx-card styleClass="[&_.p-card-body]:p-0 [&_.p-card-content]:p-0">
 *   <lfx-card-tabs-bar
 *     [options]="tabOptions"
 *     [selectedFilter]="activeTab()"
 *     (filterChange)="onTabChange($event)">
 *     <!-- optional right-side content -->
 *     <lfx-button label="New" severity="primary" size="small" />
 *   </lfx-card-tabs-bar>
 *   <!-- rest of card content -->
 * </lfx-card>
 * ```
 */
@Component({
  selector: 'lfx-card-tabs-bar',
  imports: [FilterPillsComponent],
  templateUrl: './card-tabs-bar.component.html',
})
export class CardTabsBarComponent {
  public readonly options = input.required<FilterPillOption[]>();
  public readonly selectedFilter = input.required<string>();
  /**
   * Extra classes for the bar's container, appended to its defaults — e.g. `flex-wrap gap-x-4
   * gap-y-3` so a wide projected control (a search box) drops below the pills on a phone instead
   * of squeezing them. Opt-in per consumer: the default bar keeps its single-row layout.
   */
  public readonly styleClass = input<string>('');
  public readonly filterChange = output<string>();
}
