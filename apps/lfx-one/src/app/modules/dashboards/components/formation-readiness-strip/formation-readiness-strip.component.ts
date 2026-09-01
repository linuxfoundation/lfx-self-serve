// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import type { FormationItem, FormationReadinessSummary } from '@lfx-one/shared/interfaces';
import { FORMATION_ITEM_SEGMENT_COLORS } from '@lfx-one/shared/constants';
import { deriveFormationReadinessSummary, formatFormationRelativeDayCount } from '@lfx-one/shared/utils';

@Component({
  selector: 'lfx-formation-readiness-strip',
  imports: [NgClass],
  templateUrl: './formation-readiness-strip.component.html',
  styleUrl: './formation-readiness-strip.component.scss',
})
export class FormationReadinessStripComponent {
  public readonly items = input.required<FormationItem[]>();
  public readonly announcementDate = input<string | null>(null);

  // TODO(#1957): once the backend returns a pre-computed readiness_summary, replace this computed
  // with a direct read of that field and delete the deriveFormationReadinessSummary import — every
  // template binding below already reads FormationReadinessSummary-shaped data, so nothing else changes.
  protected readonly summary: Signal<FormationReadinessSummary> = computed(() => deriveFormationReadinessSummary(this.items()));

  protected readonly countsLabel = computed(() => {
    const counts = this.summary().counts;
    return `${counts.done} of ${this.summary().totalItems} done · ${counts.in_progress} in progress · ${counts.waiting_on_partner} waiting · ${counts.not_started} not started`;
  });

  protected readonly announcementLabel = computed(() => {
    const date = this.announcementDate();
    if (!date) return 'Not set';
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return 'Not set';
    const dateLabel = parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return `${dateLabel} · ${formatFormationRelativeDayCount(parsed)}`;
  });

  /** Exposed directly so the template does a plain lookup, never a method call — see frontend-checklist §4. */
  protected readonly segmentColorClass = FORMATION_ITEM_SEGMENT_COLORS;
}
