// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import type { FormationItem, FormationItemStatus, FormationReadinessSummary } from '@lfx-one/shared/interfaces';
import { deriveFormationReadinessSummary } from '@lfx-one/shared/utils';

const SEGMENT_COLOR_CLASS: Record<FormationItemStatus, string> = {
  done: 'bg-emerald-600',
  in_progress: 'bg-amber-500',
  waiting_on_partner: 'bg-violet-500',
  not_started: 'bg-gray-200',
  skipped: 'bg-gray-400',
};

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
    return `${dateLabel} · ${formatRelativeDayCount(parsed)}`;
  });

  /** Exposed directly so the template does a plain lookup, never a method call — see frontend-checklist §4. */
  protected readonly segmentColorClass = SEGMENT_COLOR_CLASS;
}

function formatRelativeDayCount(date: Date): string {
  const diffDays = Math.round((date.getTime() - Date.now()) / 86_400_000);
  if (diffDays === 0) return 'today';
  if (diffDays > 0) return `${diffDays} day${diffDays === 1 ? '' : 's'}`;
  const past = Math.abs(diffDays);
  return `${past} day${past === 1 ? '' : 's'} ago`;
}
