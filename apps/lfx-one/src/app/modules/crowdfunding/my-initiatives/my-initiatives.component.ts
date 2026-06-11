// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { environment } from '@environments/environment';
import { CrowdfundingInitiativesStats, InitiativesResponse } from '@lfx-one/shared/interfaces';
import { DEFAULT_CROWDFUNDING_PAGE_SIZE, EMPTY_INITIATIVES_RESPONSE } from '@lfx-one/shared/constants';
import { CrowdfundingService } from '@services/crowdfunding.service';
import { finalize, scan, switchMap } from 'rxjs/operators';
import { InitiativesStatsBarComponent } from './components/initiatives-stats-bar/initiatives-stats-bar.component';
import { InitiativesListComponent } from './components/initiatives-list/initiatives-list.component';

@Component({
  selector: 'lfx-my-initiatives',
  imports: [InitiativesStatsBarComponent, InitiativesListComponent],
  templateUrl: './my-initiatives.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyInitiativesComponent {
  // ─── Private Injections ────────────────────────────────────────────────────
  private readonly router = inject(Router);
  private readonly crowdfundingService = inject(CrowdfundingService);

  // ─── Public Fields ─────────────────────────────────────────────────────────
  protected readonly crowdfundingUrl = environment.urls.crowdfunding;

  // ─── Simple WritableSignals ───────────────────────────────────────────────
  protected readonly loadingMore = signal(false);

  // ─── Pagination Driver ────────────────────────────────────────────────────
  private readonly initiativesOffset = signal(0);

  // ─── Computed Signals ─────────────────────────────────────────────────────
  private readonly initiativesState: Signal<InitiativesResponse> = this.initInitiatives();
  protected readonly initiatives = computed(() => this.initiativesState().data);
  protected readonly initiativesHasMore = computed(() => this.initiativesState().data.length < this.initiativesState().total);
  protected readonly stats: Signal<CrowdfundingInitiativesStats | undefined> = this.initStats();

  // ─── Protected Methods ─────────────────────────────────────────────────────
  protected onInitiativeClick(slug: string): void {
    void this.router.navigate(['/crowdfunding/initiatives', slug]);
  }

  protected onLoadMoreInitiatives(): void {
    if (this.loadingMore()) return;
    this.loadingMore.set(true);
    this.initiativesOffset.update((curr) => curr + DEFAULT_CROWDFUNDING_PAGE_SIZE);
  }

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initInitiatives(): Signal<InitiativesResponse> {
    return toSignal(
      toObservable(this.initiativesOffset).pipe(
        switchMap((offset) =>
          this.crowdfundingService
            .getMyInitiatives({ pageSize: DEFAULT_CROWDFUNDING_PAGE_SIZE, offset })
            .pipe(finalize(() => this.loadingMore.set(false)))
        ),
        scan((acc, curr) => (curr.offset === 0 ? curr : { ...curr, data: [...acc.data, ...curr.data] }), EMPTY_INITIATIVES_RESPONSE)
      ),
      { initialValue: EMPTY_INITIATIVES_RESPONSE }
    );
  }

  private initStats(): Signal<CrowdfundingInitiativesStats | undefined> {
    return toSignal(this.crowdfundingService.getMyInitiativesStats());
  }
}
