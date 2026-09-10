// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { FORMATION_ENABLED_FLAG, FORMATION_SUB_STAGE_LABELS, FORMATION_SUB_STAGE_SEVERITY } from '@lfx-one/shared/constants';
import type { DecoratedMyFormation, MyFormationSummary } from '@lfx-one/shared/interfaces';
import { formatFormationAnnouncementLabel, formatMyFormationSubtitle } from '@lfx-one/shared/utils';
import { TagComponent } from '@components/tag/tag.component';
import { FeatureFlagService } from '@services/feature-flag.service';
import { FormationService } from '@services/formation.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, finalize, map, of } from 'rxjs';

/**
 * "My formations" card (GH-1956) — one row per formation the caller has at least one checklist item
 * assigned to (see `MyFormationSummary`'s doc comment for why that, not a direct grant, is the
 * definition). Renders on both Me-lens dashboards (`multi-persona-dashboard`, `user-dashboard`);
 * the "In formation" tile is `multi-persona-dashboard`-only, added separately there.
 *
 * N=1 is the primary layout, not a degenerate single-row table — a lone formation renders as the
 * card's one full-width row, and additional formations stack as sibling rows separated by a divider.
 * The card renders nothing (returns to the DOM as empty) once the flag is off, the fetch errored, or
 * there are no formations to show — an Active project drops out of the response entirely, so this
 * is also how the card disappears once the caller's last formation goes Active.
 */
@Component({
  selector: 'lfx-my-formations-card',
  imports: [SkeletonModule, TagComponent, RouterLink],
  templateUrl: './my-formations-card.component.html',
})
export class MyFormationsCardComponent {
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly formationService = inject(FormationService);

  protected readonly formationFlagEnabled = this.featureFlagService.getBooleanFlag(FORMATION_ENABLED_FLAG, false);
  protected readonly loading = signal(true);
  protected readonly hasError = signal(false);

  private readonly formations: Signal<MyFormationSummary[]> = this.initFormations();
  protected readonly visible = computed(() => this.formationFlagEnabled() && !this.loading() && !this.hasError() && this.formations().length > 0);
  protected readonly showSkeleton = computed(() => this.formationFlagEnabled() && this.loading());
  protected readonly visibleFormations: Signal<DecoratedMyFormation[]> = this.initVisibleFormations();

  protected readonly stageLabels = FORMATION_SUB_STAGE_LABELS;
  protected readonly stageSeverities = FORMATION_SUB_STAGE_SEVERITY;

  private initVisibleFormations(): Signal<DecoratedMyFormation[]> {
    return computed(() =>
      this.formations().map((formation) => ({
        ...formation,
        subtitle: formatMyFormationSubtitle({
          assigned_to_do: formation.assigned_to_do,
          assigned_with_team: formation.assigned_with_team,
          assigned_done: formation.assigned_done,
        }),
        progressPercent: formation.items_total > 0 ? Math.round((formation.items_done / formation.items_total) * 100) : 0,
        announcementLabel: formatFormationAnnouncementLabel(formation.announcement_date),
      }))
    );
  }

  private initFormations(): Signal<MyFormationSummary[]> {
    return toSignal(
      this.formationService.getMyFormationWork().pipe(
        map((response) => response.formations),
        catchError((error: unknown) => {
          console.error('[MyFormationsCard] Failed to load formation work', error);
          this.hasError.set(true);
          return of([] as MyFormationSummary[]);
        }),
        finalize(() => this.loading.set(false))
      ),
      { initialValue: [] as MyFormationSummary[] }
    );
  }
}
