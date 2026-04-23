// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';
import { FilterPillOption } from '@lfx-one/shared/interfaces';

/** @deprecated Use FilterPillOption from @lfx-one/shared/interfaces instead */
export type FilterOption = FilterPillOption;

@Component({
  selector: 'lfx-filter-pills',
  imports: [TooltipModule],
  templateUrl: './filter-pills.component.html',
})
export class FilterPillsComponent {
  public readonly options = input.required<FilterPillOption[]>();
  public readonly selectedFilter = input.required<string>();
  public readonly filterChange = output<string>();

  public handleFilterChange(filterId: string): void {
    this.filterChange.emit(filterId);
  }
}
