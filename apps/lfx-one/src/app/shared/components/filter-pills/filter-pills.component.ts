// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';

export interface FilterOption {
  id: string;
  label: string;
}

@Component({
  selector: 'lfx-filter-pills',
  imports: [],
  templateUrl: './filter-pills.component.html',
})
export class FilterPillsComponent {
  public readonly options = input.required<FilterOption[]>();
  public readonly selectedFilter = input.required<string>();
  public readonly filterChange = output<string>();

  public handleFilterChange(filterId: string): void {
    this.filterChange.emit(filterId);
  }
}
