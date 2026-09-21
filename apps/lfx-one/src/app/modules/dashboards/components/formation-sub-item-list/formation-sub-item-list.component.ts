// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import type { FormationReadinessSummary, FormationSubItem } from '@lfx-one/shared/interfaces';
import { FORMATION_ITEM_SEGMENT_COLORS, FORMATION_ITEM_STATUS_GLYPHS, FORMATION_ITEM_STATUS_LABELS } from '@lfx-one/shared/constants';
import { deriveFormationReadinessSummary, formatFormationSubItemsDoneLabel } from '@lfx-one/shared/utils';

/**
 * One checklist item's sub-items (#2774), shared by the row's inline disclosure and the item drawer
 * so both surfaces read the same way: an optional "N of M done" header with a segmented bar, then
 * one row per sub-item led by its status glyph. Display-only — #2775 adds the checkbox toggle at
 * the head of each row.
 */
@Component({
  selector: 'lfx-formation-sub-item-list',
  imports: [NgClass],
  templateUrl: './formation-sub-item-list.component.html',
  styleUrl: './formation-sub-item-list.component.scss',
})
export class FormationSubItemListComponent {
  public readonly subItems = input.required<FormationSubItem[]>();
  /** The drawer shows the "Sub-items · N of M done" header and bar; the row's disclosure passes `false` since its trigger already carries both. */
  public readonly showSummary = input<boolean>(true);

  /** Exposed directly so the template does a plain lookup, never a method call — see frontend-checklist §4. */
  protected readonly segmentColorClass = FORMATION_ITEM_SEGMENT_COLORS;

  protected readonly summary: Signal<FormationReadinessSummary> = computed(() => deriveFormationReadinessSummary(this.subItems()));
  protected readonly summaryLabel = computed(() => `${this.summary().counts.done} of ${this.summary().totalItems} done`);
  /** The bar's accessible name — shared wording with the row disclosure's bar (`formatFormationSubItemsDoneLabel`). */
  protected readonly barLabel = computed(() => formatFormationSubItemsDoneLabel(this.summary()));
  /** Same indexed-track shape as the readiness strip — statuses repeat, so a stable per-position id is the track key. */
  protected readonly indexedSegments = computed(() => this.summary().segments.map((status, index) => ({ id: index, status })));
  /**
   * Glyph and label pre-resolved per row so the template only reads properties (frontend-checklist
   * §4). A status the frontend doesn't know yet (the wire type is a cast, and `mapSubItems` passes
   * `status` through unnormalized) falls back to the not-started glyph with the raw value as its
   * label — the same off-taxonomy-renders-verbatim rule as `getFormationQueueStageDisplay` — rather
   * than dereferencing `undefined` and taking the drawer body down with it. `Object.hasOwn`, not a
   * bare index, so an inherited `Object.prototype` key can't resolve to a function.
   */
  protected readonly rows = computed(() =>
    this.subItems().map((subItem) => {
      const known = Object.hasOwn(FORMATION_ITEM_STATUS_GLYPHS, subItem.status);
      return {
        ...subItem,
        glyph: known ? FORMATION_ITEM_STATUS_GLYPHS[subItem.status] : FORMATION_ITEM_STATUS_GLYPHS.not_started,
        statusLabel: known ? FORMATION_ITEM_STATUS_LABELS[subItem.status] : subItem.status,
      };
    })
  );
}
