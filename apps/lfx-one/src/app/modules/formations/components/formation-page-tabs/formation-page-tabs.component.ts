// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, inject, input, output, PLATFORM_ID, viewChildren } from '@angular/core';
import type { FilterPillOption } from '@lfx-one/shared/interfaces';

/**
 * Page-level underline tabs for the formation pages (#3037) — My Formations (formations | submitted
 * proposals) and the foundation Formations queue (formations | project proposals). Same visual as the
 * Akrites dashboard tab bar and the same ARIA tab pattern as `program-detail-header`: roving tabindex,
 * Arrow/Home/End navigation, and each tab `aria-controls` a host-rendered `role="tabpanel"` whose id is
 * `<idPrefix>-panel-<tab id>`, labelled by `<idPrefix>-tab-<tab id>` — hosts must build their panel id and
 * `aria-labelledby` in exactly that format. The host page owns the selection (kept in `?tab=`).
 */
@Component({
  selector: 'lfx-formation-page-tabs',
  templateUrl: './formation-page-tabs.component.html',
})
export class FormationPageTabsComponent {
  // === Services ===
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  public readonly options = input.required<FilterPillOption[]>();
  public readonly active = input.required<string>();
  public readonly ariaLabel = input.required<string>();
  /** Prefix for tab/panel ids and test ids; the host's tabpanel uses `<idPrefix>-panel-<tab id>`. */
  public readonly idPrefix = input<string>('formation-page-tabs');

  // === Outputs ===
  public readonly tabChange = output<string>();

  // === View queries ===
  private readonly tabButtons = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');

  // === Protected Methods ===
  protected select(id: string): void {
    if (id !== this.active()) {
      this.tabChange.emit(id);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    const ids = this.options().map((option) => option.id);
    const current = Math.max(0, ids.indexOf(this.active()));
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (current + 1) % ids.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + ids.length) % ids.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ids.length - 1;
    if (next === null) return;

    event.preventDefault();
    this.select(ids[next]);
    if (isPlatformBrowser(this.platformId)) {
      const target = next;
      setTimeout(() => this.tabButtons()[target]?.nativeElement.focus());
    }
  }
}
