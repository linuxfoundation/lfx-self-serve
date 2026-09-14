// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, input, Signal } from '@angular/core';
import type { FormationItem, FormationReadinessSummary } from '@lfx-one/shared/interfaces';
import { FORMATION_ITEM_SEGMENT_COLORS } from '@lfx-one/shared/constants';
import { deriveFormationReadinessSummary, formatFormationAnnouncementLabel } from '@lfx-one/shared/utils';
import { ProjectContextService } from '@services/project-context.service';

@Component({
  selector: 'lfx-formation-readiness-strip',
  imports: [NgClass],
  templateUrl: './formation-readiness-strip.component.html',
  styleUrl: './formation-readiness-strip.component.scss',
})
export class FormationReadinessStripComponent {
  private readonly projectContextService = inject(ProjectContextService);

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
    return `${counts.done} of ${this.summary().totalItems} done · ${counts.in_progress} in progress · ${counts.blocked} blocked · ${counts.awaiting_acceptance} with formation team · ${counts.not_started} not started · ${counts.skipped} skipped`;
  });

  /** Shared with `FormationCardComponent`/`ProjectDashboardComponent` via `ProjectContextService` — no duplicate fetch. */
  protected readonly announcementDateLoading = this.projectContextService.activeProjectAnnouncementDateLoading;
  protected readonly announcementDateHasError = this.projectContextService.activeProjectAnnouncementDateHasError;

  /**
   * Deliberately reads `ProjectContextService.activeProjectAnnouncementDate` (the project-settings
   * date the dashboard subtitle and sidebar card already show) rather than any per-formation field —
   * one source, every surface: dashboard subtitle, sidebar card, and this header. Rendered via the
   * shared `formatFormationAnnouncementLabel` — the same UTC-anchored parse `formatIsoDateLabel`
   * uses for the other two surfaces — rather than a `new Date(date)` built and formatted locally
   * here, so this header's calendar day and day count can never drift a day off the dashboard's.
   */
  protected readonly announcementLabel = computed(() => {
    return formatFormationAnnouncementLabel(this.projectContextService.activeProjectAnnouncementDate()) ?? 'Not set';
  });

  /** Exposed directly so the template does a plain lookup, never a method call — see frontend-checklist §4. */
  protected readonly segmentColorClass = FORMATION_ITEM_SEGMENT_COLORS;
}
