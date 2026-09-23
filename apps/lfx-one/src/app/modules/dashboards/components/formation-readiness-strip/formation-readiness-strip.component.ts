// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import type { FormationItem, FormationReadinessSummary } from '@lfx-one/shared/interfaces';
import { FORMATION_ITEM_SEGMENT_COLORS } from '@lfx-one/shared/constants';
import { deriveFormationReadinessSummary } from '@lfx-one/shared/utils';

@Component({
  selector: 'lfx-formation-readiness-strip',
  imports: [NgClass],
  templateUrl: './formation-readiness-strip.component.html',
  styleUrl: './formation-readiness-strip.component.scss',
})
export class FormationReadinessStripComponent {
  public readonly items = input.required<FormationItem[]>();
  /** Server-computed, read straight off `gating_items_open`/`gating_items_total` — not re-derived here. */
  public readonly openGatingItems = input.required<number>();
  public readonly totalGatingItems = input.required<number>();

  protected readonly summary: Signal<FormationReadinessSummary> = computed(() => deriveFormationReadinessSummary(this.items()));

  /**
   * Segment-bar `@for` track source — `segment` values (item statuses) repeat across the array, so
   * tracking the raw status string would violate `@for`'s unique-track-value requirement; this pairs
   * each status with a stable per-position `id` so the template can track that instead of `$index`.
   */
  protected readonly indexedSegments = computed(() => this.summary().segments.map((status, index) => ({ id: index, status })));

  protected readonly countsLabel = computed(() => {
    const counts = this.summary().counts;
    return `${counts.done} of ${this.summary().totalItems} done · ${counts.in_progress} in progress · ${counts.blocked} blocked · ${counts.not_started} not started · ${counts.skipped} skipped`;
  });

  /** Exposed directly so the template does a plain lookup, never a method call — see frontend-checklist §4. */
  protected readonly segmentColorClass = FORMATION_ITEM_SEGMENT_COLORS;
}
