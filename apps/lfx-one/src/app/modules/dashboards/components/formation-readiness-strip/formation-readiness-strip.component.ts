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
  /**
   * Announcement date override for a host rendering another project's checklist (the foundation
   * formations drill-down, LFXV2-3386) — `ProjectContextService` still describes the *foundation*
   * there, so the date must ride in with the checklist data instead. `undefined` (the default) is
   * the "no override" sentinel: fall back to the context service exactly as before; `null` is a
   * real value meaning "no announcement date set" and renders "Not set" with no loading dash.
   */
  public readonly announcementDate = input<string | null | undefined>(undefined);

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

  /** Shared with `FormationCardComponent`/`ProjectDashboardComponent` via `ProjectContextService` — no duplicate fetch. With an `announcementDate` override the value is already in hand, so the context's loading/error states don't apply. */
  protected readonly announcementDateLoading = computed(
    () => this.announcementDate() === undefined && this.projectContextService.activeProjectAnnouncementDateLoading()
  );
  protected readonly announcementDateHasError = computed(
    () => this.announcementDate() === undefined && this.projectContextService.activeProjectAnnouncementDateHasError()
  );

  /**
   * Without an `announcementDate` override, deliberately reads
   * `ProjectContextService.activeProjectAnnouncementDate` (the project-settings date the dashboard
   * subtitle and sidebar card already show) rather than any per-formation field — one source, every
   * surface: dashboard subtitle, sidebar card, and this header. The override path (LFXV2-3386's
   * foundation drill-down) keeps that guarantee: the checklist BFF sources `announcement_date` from
   * the same project-settings read. Rendered via the shared `formatFormationAnnouncementLabel` — the
   * same UTC-anchored parse `formatIsoDateLabel` uses for the other two surfaces — rather than a
   * `new Date(date)` built and formatted locally here, so this header's calendar day and day count
   * can never drift a day off the dashboard's.
   */
  protected readonly announcementLabel = computed(() => {
    const override = this.announcementDate();
    const date = override !== undefined ? override : this.projectContextService.activeProjectAnnouncementDate();
    return formatFormationAnnouncementLabel(date) ?? 'Not set';
  });

  /** Exposed directly so the template does a plain lookup, never a method call — see frontend-checklist §4. */
  protected readonly segmentColorClass = FORMATION_ITEM_SEGMENT_COLORS;
}
