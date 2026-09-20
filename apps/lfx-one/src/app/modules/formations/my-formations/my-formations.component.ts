// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { FORMATION_CHECKLIST_PATH, FORMATION_STAGE_TAB_OPTIONS } from '@lfx-one/shared/constants';
import type { DecoratedMyFormation, FilterPillOption, MyFormationWorkResponse } from '@lfx-one/shared/interfaces';
import { compareMyFormationsByNeed, decorateMyFormation } from '@lfx-one/shared/utils';
import { FormationService } from '@services/formation.service';
import { debounceTime, tap } from 'rxjs';

/**
 * Me-lens "My Formations" page (#2753) — one row per formation the caller has at least one
 * checklist item assigned to (see `MyFormationSummary`'s doc comment for why that, not a direct
 * grant, is the definition). Replaces the capped "My formations" dashboard card (GH-1956, GH-2331)
 * with the layout every other "My …" page in the My Engagement group uses: header, an `lfx-card`
 * with stage tabs and a search box, and an `lfx-table`. Reachable from the sidebar while
 * `formation-enabled` is on; the route's `formationMeEnabledGuard` owns the flag gate, so nothing
 * here re-checks it.
 *
 * Rows keep the card's need-based order (`compareMyFormationsByNeed`) with no column sorting,
 * unlike the foundation queue: this is a short, self-scoped list, and "what needs me most" is the
 * one ordering a caller wants from it. A row's name lands on the project's formation checklist —
 * the same destination the Pending Actions "View item" control uses (#2732).
 */
@Component({
  selector: 'lfx-my-formations',
  imports: [CardComponent, CardTabsBarComponent, EmptyStateComponent, InputTextComponent, ReactiveFormsModule, RouterLink, TableComponent, TagComponent],
  templateUrl: './my-formations.component.html',
  styleUrl: './my-formations.component.scss',
})
export class MyFormationsComponent {
  // === Services ===
  private readonly formationService = inject(FormationService);
  private readonly destroyRef = inject(DestroyRef);

  // === Template constants ===
  protected readonly checklistPath = FORMATION_CHECKLIST_PATH;
  protected readonly stageTabOptions: FilterPillOption[] = FORMATION_STAGE_TAB_OPTIONS;

  // === Forms ===
  public readonly searchForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
  });

  // === Writable Signals ===
  // Starts true — nothing meaningful to show before the first fetch resolves; false would flash
  // "No formations yet" for one frame. Re-armed by onRetry so a retried fetch shows the table's
  // loading state again instead of the stale error box.
  protected readonly loading = signal(true);
  protected readonly searchTerm = signal('');
  protected readonly stageTab = signal<string>('all');

  // === Computed Signals ===
  private readonly formationWork: Signal<MyFormationWorkResponse | null> = this.initFormationWork();
  /** `'unavailable'` only — `'partial'` keeps the rows that did arrive, the better failure mode than hiding all of them. */
  protected readonly hasError: Signal<boolean> = computed(() => !this.loading() && this.formationWork()?.state === 'unavailable');
  private readonly rows: Signal<DecoratedMyFormation[]> = this.initRows();
  protected readonly filteredRows: Signal<DecoratedMyFormation[]> = this.initFilteredRows();
  protected readonly hasActiveFilters: Signal<boolean> = computed(() => this.stageTab() !== 'all' || !!this.searchTerm().trim());
  protected readonly showEmptyState: Signal<boolean> = computed(
    () => !this.loading() && !this.hasError() && this.rows().length === 0 && !this.hasActiveFilters()
  );
  protected readonly showNoResults: Signal<boolean> = computed(() => !this.loading() && this.filteredRows().length === 0);

  // === Constructor ===
  public constructor() {
    // No `distinctUntilChanged`: the signal already ignores a repeated value, and the operator's
    // memory would outlive `resetFilters()` — a term typed again right after "Reset filters" (inside
    // the debounce window, so the reset's own empty value never reaches it) would be swallowed,
    // leaving the box showing a term the table isn't applying.
    this.searchForm.controls.search.valueChanges
      .pipe(debounceTime(200), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.searchTerm.set(value ?? ''));
  }

  // === Protected Methods ===
  protected onStageTabChange(tab: string): void {
    this.stageTab.set(tab);
  }

  // The signal is set directly so the table clears now rather than after the debounce; the form reset
  // still emits so the debounced pipeline and the control agree on the empty value.
  protected resetFilters(): void {
    this.searchForm.reset({ search: '' });
    this.searchTerm.set('');
    this.stageTab.set('all');
  }

  /** Re-runs the shared `getMyFormationWork()` fetch; the new response lands through the same signal. */
  protected onRetry(): void {
    this.loading.set(true);
    this.formationService.invalidateMyFormationWork();
  }

  // === Private Initializers ===
  // `getMyFormationWork()` re-emits on every `invalidateMyFormationWork()` rather than completing,
  // so `finalize` would never fire — `tap` clears `loading` on each emission instead. No
  // component-level `catchError`: the service's own `catchError` already absorbs every HTTP/network
  // failure inside its shared stream and re-emits `state: 'unavailable'` rather than erroring the
  // observable (`formation.service.ts`'s `myFormationWork$`), so a second one here would be
  // unreachable dead code layered on top of it.
  private initFormationWork(): Signal<MyFormationWorkResponse | null> {
    return toSignal(this.formationService.getMyFormationWork().pipe(tap(() => this.loading.set(false))), { initialValue: null });
  }

  private initRows(): Signal<DecoratedMyFormation[]> {
    return computed(() => [...(this.formationWork()?.formations ?? [])].sort(compareMyFormationsByNeed).map(decorateMyFormation));
  }

  // Both filters are client-side — the response is the caller's whole list, so there is nothing to
  // re-fetch. A row whose `sub_stage` is `null` (an upstream stage outside the queue taxonomy, shown
  // verbatim on its chip) matches no stage tab and only appears under "All".
  private initFilteredRows(): Signal<DecoratedMyFormation[]> {
    return computed(() => {
      const term = this.searchTerm().trim().toLowerCase();
      const tab = this.stageTab();
      let rows = this.rows();
      if (tab !== 'all') {
        rows = rows.filter((row) => row.sub_stage === tab);
      }
      if (term) {
        rows = rows.filter((row) => row.project_name.toLowerCase().includes(term));
      }
      return rows;
    });
  }
}
