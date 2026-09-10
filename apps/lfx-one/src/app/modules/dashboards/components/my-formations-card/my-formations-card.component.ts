// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { FORMATION_ENABLED_FLAG, FORMATION_SUB_STAGE_LABELS, FORMATION_SUB_STAGE_SEVERITY } from '@lfx-one/shared/constants';
import type { DecoratedMyFormation, MyFormationSummary } from '@lfx-one/shared/interfaces';
import { formatFormationAnnouncementLabel, formatMyFormationSubtitle } from '@lfx-one/shared/utils';
import { TagComponent } from '@components/tag/tag.component';
import { FeatureFlagService } from '@services/feature-flag.service';
import { FormationService } from '@services/formation.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, filter, map, of, switchMap, take, tap } from 'rxjs';

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
  // Only ever cleared, never re-armed by a post-mutation `invalidateMyFormationWork()` refresh — a
  // deliberate choice so an in-place update (e.g. claiming a row) swaps the card's rows in place
  // instead of flashing the skeleton back in.
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

  // Gated on the flag so a disabled flag never issues the request — mirrors
  // `multi-persona-dashboard.component.ts`'s `initFormationCount`.
  // `getMyFormationWork()` re-emits on every `invalidateMyFormationWork()` rather than completing,
  // so `finalize` would never fire — `tap`/`catchError` clear `loading` on each emission instead.
  // The service's own fetch never errors (its `catchError` sits inside the shared stream and falls
  // back to an empty response there), so this `catchError` is defensive only; `hasError` still
  // resets on every successful emission so a page that loaded fine doesn't stay flagged from an
  // earlier defensive trip.
  private initFormations(): Signal<MyFormationSummary[]> {
    return toSignal(
      toObservable(this.formationFlagEnabled).pipe(
        filter(Boolean),
        take(1),
        switchMap(() =>
          this.formationService.getMyFormationWork().pipe(
            tap(() => {
              this.loading.set(false);
              this.hasError.set(false);
            }),
            map((response) => response.formations),
            catchError((error: unknown) => {
              console.error('[MyFormationsCard] Failed to load formation work', error);
              this.hasError.set(true);
              this.loading.set(false);
              return of([] as MyFormationSummary[]);
            })
          )
        )
      ),
      { initialValue: [] as MyFormationSummary[] }
    );
  }
}
