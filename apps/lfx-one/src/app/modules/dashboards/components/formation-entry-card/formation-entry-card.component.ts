// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type { FormationEntryCardSummary } from '@lfx-one/shared/interfaces';
import { deriveFormationReadinessSummary } from '@lfx-one/shared/utils';
import { FormationService } from '@services/formation.service';
import { ProjectContextService } from '@services/project-context.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, finalize, of, switchMap } from 'rxjs';

/**
 * GH-1958 dashboard teaser for the formation checklist, now its own route (`/project/formation`).
 * A progress summary + link, not a preview of the rows — the checklist itself lives at that route.
 */
@Component({
  selector: 'lfx-formation-entry-card',
  imports: [SkeletonModule, RouterLink],
  templateUrl: './formation-entry-card.component.html',
  styleUrl: './formation-entry-card.component.scss',
})
export class FormationEntryCardComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly formationService = inject(FormationService);

  protected readonly loading = signal(true);
  protected readonly hasError = signal(false);

  private readonly summary: Signal<FormationEntryCardSummary | null> = this.initSummary();
  protected readonly doneCount = computed(() => this.summary()?.readiness.counts.done ?? 0);
  protected readonly totalCount = computed(() => this.summary()?.readiness.totalItems ?? 0);
  protected readonly openGatingCount = computed(() => this.summary()?.openGatingItems ?? 0);
  protected readonly totalGatingCount = computed(() => this.summary()?.totalGatingItems ?? 0);
  protected readonly formationLink = ['/project/formation'];
  protected readonly formationQueryParams = computed(() => {
    const slug = this.projectContextService.activeContext()?.slug;
    return slug ? { project: slug } : {};
  });

  private initSummary(): Signal<FormationEntryCardSummary | null> {
    const slug$ = toObservable(computed(() => this.projectContextService.activeContext()?.slug ?? null)).pipe(distinctUntilChanged());

    return toSignal(
      slug$.pipe(
        switchMap((slug) => {
          if (!slug) {
            this.loading.set(false);
            return of(null);
          }

          this.loading.set(true);
          this.hasError.set(false);
          return this.formationService.getProjectFormation(slug).pipe(
            switchMap((response) =>
              of({
                readiness: deriveFormationReadinessSummary(response.items),
                openGatingItems: response.formation.gating_items_open,
                totalGatingItems: response.formation.gating_items_total,
              })
            ),
            catchError((error: unknown) => {
              console.error('[FormationEntryCard] Failed to load formation checklist summary', error);
              this.hasError.set(true);
              return of(null);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
