// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import type { FormationReadinessSummary, FormationSubItem } from '@lfx-one/shared/interfaces';
import { FORMATION_ITEM_STATUS_LABELS, FORMATION_SUB_ITEM_MARKERS, FORMATION_SUB_ITEM_UNKNOWN_LABEL_CLASS } from '@lfx-one/shared/constants';
import { deriveFormationReadinessSummary } from '@lfx-one/shared/utils';

import { FormationProgressRingComponent } from '../formation-progress-ring/formation-progress-ring.component';

/**
 * One checklist item's sub-items (#2774, redrawn in #2818), shared by the row's inline disclosure
 * and the item drawer so both surfaces read the same way: an optional "N of M done" summary led by
 * a progress ring, then one row per sub-item led by its status marker (`FORMATION_SUB_ITEM_MARKERS`
 * — a filled check for done, a ring otherwise) with the status label visible only where the marker
 * alone doesn't say it. Display-only — #2775 replaces each marker with a checkbox toggle in place.
 */
@Component({
  selector: 'lfx-formation-sub-item-list',
  imports: [NgClass, FormationProgressRingComponent],
  templateUrl: './formation-sub-item-list.component.html',
  styleUrl: './formation-sub-item-list.component.scss',
})
export class FormationSubItemListComponent {
  public readonly subItems = input.required<FormationSubItem[]>();
  /** The drawer shows the "N of M done" summary and ring; the row's disclosure passes `false` since its trigger already carries both. */
  public readonly showSummary = input<boolean>(true);

  protected readonly summary: Signal<FormationReadinessSummary> = computed(() => deriveFormationReadinessSummary(this.subItems()));
  protected readonly summaryLabel = computed(() => `${this.summary().counts.done} of ${this.summary().totalItems} done`);
  /**
   * Marker, label and label classes pre-resolved per row so the template only reads properties
   * (frontend-checklist §4). A status the frontend doesn't know yet (the wire type is a cast, and
   * `mapSubItems` passes `status` through unnormalized) falls back to the not-started marker with
   * the raw value as a *visible* label — the same off-taxonomy-renders-verbatim rule as
   * `getFormationQueueStageDisplay` — rather than dereferencing `undefined` and taking the drawer
   * body down with it. `Object.hasOwn`, not a bare index, so an inherited `Object.prototype` key
   * can't resolve to a function.
   */
  protected readonly rows = computed(() =>
    this.subItems().map((subItem) => {
      const known = Object.hasOwn(FORMATION_SUB_ITEM_MARKERS, subItem.status);
      const marker = known ? FORMATION_SUB_ITEM_MARKERS[subItem.status] : FORMATION_SUB_ITEM_MARKERS.not_started;
      return {
        ...subItem,
        marker,
        statusLabel: known ? FORMATION_ITEM_STATUS_LABELS[subItem.status] : subItem.status,
        // An unknown status must be seen, not only heard: its raw value takes the visible label classes.
        labelClass: known ? marker.labelClass : FORMATION_SUB_ITEM_UNKNOWN_LABEL_CLASS,
      };
    })
  );
}
