// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { environment } from '@environments/environment';
import { ButtonComponent } from '@components/button/button.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { CrowdfundingInitiativesStats, InitiativesResponse, StatCardItem } from '@lfx-one/shared/interfaces';
import { DEFAULT_CROWDFUNDING_PAGE_SIZE, EMPTY_INITIATIVES_RESPONSE } from '@lfx-one/shared/constants';
import { formatCurrency } from '@lfx-one/shared/utils';
import { CrowdfundingService } from '@services/crowdfunding.service';
import { finalize, scan, switchMap } from 'rxjs/operators';
import { InitiativesListComponent } from './components/initiatives-list/initiatives-list.component';

@Component({
  selector: 'lfx-my-initiatives',
  imports: [ButtonComponent, StatCardGridComponent, InitiativesListComponent],
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
  protected readonly statCards: Signal<StatCardItem[]> = this.initStatCards();

  // ─── Protected Methods ─────────────────────────────────────────────────────
  protected onInitiativeClick(slug: string): void {
    void this.router.navigate(['/crowdfunding/initiatives', slug]);
  }

  protected onLoadMoreInitiatives(): void {
    if (this.loadingMore() || !this.initiativesHasMore()) return;
    this.loadingMore.set(true);
    this.initiativesOffset.update((curr) => curr + DEFAULT_CROWDFUNDING_PAGE_SIZE);
  }

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initInitiatives(): Signal<InitiativesResponse> {
    return toSignal(
      toObservable(this.initiativesOffset).pipe(
        switchMap((offset) =>
          this.crowdfundingService.getMyInitiatives({ pageSize: DEFAULT_CROWDFUNDING_PAGE_SIZE, offset }).pipe(finalize(() => this.loadingMore.set(false)))
        ),
        scan((acc, curr) => (curr.offset === 0 ? curr : { ...curr, data: [...acc.data, ...curr.data] }), EMPTY_INITIATIVES_RESPONSE)
      ),
      { initialValue: EMPTY_INITIATIVES_RESPONSE }
    );
  }

  private initStats(): Signal<CrowdfundingInitiativesStats | undefined> {
    return toSignal(this.crowdfundingService.getMyInitiativesStats());
  }

  private initStatCards(): Signal<StatCardItem[]> {
    return computed<StatCardItem[]>(() => {
      const stats = this.stats();
      const raisedLabel = stats && stats.monthlyGain > 0 ? `Total Raised · +${formatCurrency(stats.monthlyGain)} this month` : 'Total Raised';

      return [
        { value: stats?.activeCount ?? 0, label: 'Active Initiatives', icon: 'fa-light fa-box-dollar', iconContainerClass: 'bg-blue-100 text-blue-600' },
        { value: formatCurrency(stats?.totalRaised ?? 0), label: raisedLabel, icon: 'fa-light fa-dollar-sign', iconContainerClass: 'bg-emerald-100 text-emerald-600' },
        { value: stats?.totalSponsors ?? 0, label: 'Total Sponsors', icon: 'fa-light fa-users', iconContainerClass: 'bg-gray-200 text-gray-500' },
      ];
    });
  }
}
