// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { FormationService } from '@services/formation.service';
import type { FormationsQueueFilterState, FormationsQueueResponse, StatCardItem } from '@lfx-one/shared/interfaces';
import { createEmptyFormationsQueueResponse } from '@lfx-one/shared/constants';
import { BehaviorSubject, catchError, combineLatest, finalize, of, switchMap } from 'rxjs';

import { FormationsTableComponent } from '../components/formations-table/formations-table.component';

@Component({
  selector: 'lfx-formations-queue',
  imports: [StatCardGridComponent, FormationsTableComponent],
  templateUrl: './formations-queue.component.html',
  styleUrl: './formations-queue.component.scss',
})
export class FormationsQueueComponent {
  private readonly formationService = inject(FormationService);

  private readonly refresh$ = new BehaviorSubject<void>(undefined);
  private readonly filters = signal<FormationsQueueFilterState>({ subStage: undefined, search: '' });
  // Starts true — this page has nothing meaningful to show before the first fetch resolves; false
  // would flash "No formations yet" for one frame.
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);

  private readonly response: Signal<FormationsQueueResponse> = this.initResponse();
  protected readonly rows = computed(() => this.response().rows);
  protected readonly tiles: Signal<StatCardItem[]> = this.initTiles();

  protected onFiltersChange(filters: FormationsQueueFilterState): void {
    this.filters.set(filters);
  }

  protected onRetry(): void {
    // The error state's @else branch (formations-queue.component.html) destroys FormationsTableComponent,
    // which resets its own statusTab/searchForm to defaults — reset filters() to match, or the retried
    // fetch would run with stale filter values the freshly re-created table no longer displays.
    // filters.set() always allocates a fresh object, so it alone re-triggers initResponse()'s
    // combineLatest via the filters branch — an additional refresh$.next() here would double-fire.
    this.filters.set({ subStage: undefined, search: '' });
  }

  private initResponse(): Signal<FormationsQueueResponse> {
    return toSignal(
      combineLatest([this.refresh$, toObservable(this.filters)]).pipe(
        switchMap(([, filters]) => {
          this.loadFailed.set(false);
          this.loading.set(true);
          return this.formationService.getFormationsQueue(filters.subStage, filters.search).pipe(
            catchError((error: unknown) => {
              console.error('[FormationsQueue] Failed to load Formations queue', error);
              this.loadFailed.set(true);
              return of(createEmptyFormationsQueueResponse());
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: createEmptyFormationsQueueResponse() }
    );
  }

  private initTiles(): Signal<StatCardItem[]> {
    return computed(() => {
      const t = this.response().tiles;
      return [
        {
          value: t.total,
          label: 'In formation',
          subLine: `${t.foundations} foundations · ${t.subprojects} subprojects`,
          icon: 'fa-light fa-diagram-project',
          iconContainerClass: 'bg-blue-50 text-blue-600',
        },
        {
          value: t.activating,
          label: 'Ready to activate',
          subLine: 'Gating items done',
          icon: 'fa-light fa-flag-checkered',
          iconContainerClass: 'bg-amber-50 text-amber-600',
        },
        {
          value: t.exploratory,
          label: 'Exploratory',
          subLine: 'Early conversations',
          icon: 'fa-light fa-compass',
          iconContainerClass: 'bg-violet-50 text-violet-600',
        },
        {
          value: t.engaged,
          label: 'Engaged',
          subLine: `${t.on_hold} on hold`,
          icon: 'fa-light fa-handshake',
          iconContainerClass: 'bg-emerald-50 text-emerald-600',
        },
      ];
    });
  }
}
