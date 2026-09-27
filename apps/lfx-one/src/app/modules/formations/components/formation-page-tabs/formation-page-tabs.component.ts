// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import type { FilterPillOption } from '@lfx-one/shared/interfaces';

/**
 * Page-level underline tabs for the formation pages (#3037) — My Formations (formations | submitted
 * proposals) and the foundation Formations queue (formations | project proposals). Same visual as the
 * Akrites dashboard tab bar; the host page owns the selection (kept in `?tab=`).
 */
@Component({
  selector: 'lfx-formation-page-tabs',
  templateUrl: './formation-page-tabs.component.html',
})
export class FormationPageTabsComponent {
  // === Inputs ===
  public readonly options = input.required<FilterPillOption[]>();
  public readonly active = input.required<string>();
  public readonly testIdPrefix = input<string>('formation-page-tabs');

  // === Outputs ===
  public readonly tabChange = output<string>();

  // === Protected Methods ===
  protected select(id: string): void {
    if (id !== this.active()) {
      this.tabChange.emit(id);
    }
  }
}
