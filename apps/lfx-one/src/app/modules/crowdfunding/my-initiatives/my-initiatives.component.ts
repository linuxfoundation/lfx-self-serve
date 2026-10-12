// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { environment } from '@environments/environment';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import {
  CrowdfundingInitiativesStats,
  InitiativesLoadError,
  InitiativesResponse,
  InitiativesScope,
  Lens,
  NavLens,
  StatCardItem,
} from '@lfx-one/shared/interfaces';
import { DEFAULT_CROWDFUNDING_PAGE_SIZE, EMPTY_CROWDFUNDING_STATS, EMPTY_INITIATIVES_RESPONSE, NAV_LENSES } from '@lfx-one/shared/constants';
import { formatCurrency } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { CrowdfundingService } from '@services/crowdfunding.service';
import { ProjectContextService } from '@services/project-context.service';
import { of } from 'rxjs';
import { catchError, filter, finalize, scan, startWith, switchMap, tap } from 'rxjs/operators';
import { InitiativesListComponent } from './components/initiatives-list/initiatives-list.component';

@Component({
  selector: 'lfx-my-initiatives',
  imports: [ButtonComponent, EmptyStateComponent, StatCardGridComponent, RouteLoadingComponent, InitiativesListComponent],
  templateUrl: './my-initiatives.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyInitiativesComponent {
  // ─── Private Injections ────────────────────────────────────────────────────
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly crowdfundingService = inject(CrowdfundingService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly accountContext = inject(AccountContextService);

  // ─── Public Fields ─────────────────────────────────────────────────────────
  protected readonly crowdfundingUrl = `${environment.urls.crowdfunding}?fundraise=true`;
  // The Project/Foundation (#347) and Org (#348) lens routes reuse this page scoped to the lens's entity; elsewhere
  // it lists the caller's own initiatives.
  private readonly lens = this.route.snapshot.data['lens'] as Lens | undefined;
  private readonly isOrgLens = this.lens === 'org';
  protected readonly isLensPage = this.isOrgLens || NAV_LENSES.includes(this.lens as NavLens);

  // ─── Simple WritableSignals ───────────────────────────────────────────────
  protected readonly isLoading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly loadError = signal<InitiativesLoadError | null>(null);
  // Bumped by Try again to refetch the same scope.
  private readonly reloadCount = signal(0);

  // ─── Computed Signals ─────────────────────────────────────────────────────
  // undefined = the caller's own initiatives; a lens scope with uid '' = the lens entity has not resolved yet.
  private readonly scope: Signal<InitiativesScope | undefined> = this.initScope();
  protected readonly entityName = computed(() =>
    this.isOrgLens ? this.accountContext.selectedAccount().accountName : (this.projectContextService.activeContext()?.name ?? '')
  );
  // Pagination driver — back to the first page whenever the lens entity changes or Try again is clicked.
  private readonly page = linkedSignal({
    source: () => ({ scope: this.scope(), reload: this.reloadCount() }),
    computation: ({ scope }) => ({ scope, offset: 0 }),
  });
  private readonly initiativesState: Signal<InitiativesResponse> = this.initInitiatives();
  protected readonly initiatives = computed(() => this.initiativesState().data);
  protected readonly initiativesHasMore = computed(() => this.initiativesState().data.length < this.initiativesState().total);
  protected readonly stats: Signal<CrowdfundingInitiativesStats | undefined> = this.initStats();
  protected readonly statCards: Signal<StatCardItem[]> = this.initStatCards();

  // ─── Protected Methods ─────────────────────────────────────────────────────
  protected onInitiativeClick(slug: string): void {
    // Relative, keeping ?project=, so a lens page opens its own lens's detail route rather than the Me one.
    void this.router.navigate([slug], { relativeTo: this.route, queryParamsHandling: 'preserve' });
  }

  protected onLoadMoreInitiatives(): void {
    if (this.loadingMore() || !this.initiativesHasMore()) return;
    this.loadingMore.set(true);
    this.page.update((curr) => ({ ...curr, offset: curr.offset + DEFAULT_CROWDFUNDING_PAGE_SIZE }));
  }

  protected onRetry(): void {
    this.reloadCount.update((count) => count + 1);
  }

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initScope(): Signal<InitiativesScope | undefined> {
    return computed(
      (): InitiativesScope | undefined => {
        if (this.isOrgLens) return { kind: 'organizations', uid: this.accountContext.selectedAccount().uid ?? '' };
        if (this.isLensPage) return { kind: 'projects', uid: this.projectContextService.activeContextUid() };
        return undefined;
      },
      // The selected account is re-set as its display fields hydrate; only a different entity is a new scope.
      { equal: (a, b) => a?.kind === b?.kind && a?.uid === b?.uid }
    );
  }

  private initInitiatives(): Signal<InitiativesResponse> {
    return toSignal(
      toObservable(this.page).pipe(
        // On a lens route, wait for the lens context to resolve its entity rather than listing the caller's own.
        filter(({ scope }) => !scope || !!scope.uid),
        // A first page (initial load, entity switch, retry) shows the loader, not the previous entity's rows.
        tap(({ offset }) => {
          if (offset !== 0) return;
          this.isLoading.set(true);
          this.loadError.set(null);
        }),
        switchMap(({ scope, offset }) =>
          this.crowdfundingService.getMyInitiatives({ pageSize: DEFAULT_CROWDFUNDING_PAGE_SIZE, offset, scope }).pipe(
            // Only scoped calls error (the caller's own list falls back to empty in the service): 403 = not a writer on
            // the entity, anything else = CF or its FGA check is down.
            catchError((err: HttpErrorResponse) => {
              this.loadError.set(err.status === 403 ? 'forbidden' : 'unavailable');
              return of(EMPTY_INITIATIVES_RESPONSE);
            }),
            finalize(() => this.loadingMore.set(false))
          )
        ),
        scan((acc, curr) => (curr.offset === 0 ? curr : { ...curr, data: [...acc.data, ...curr.data] }), EMPTY_INITIATIVES_RESPONSE),
        tap(() => this.isLoading.set(false))
      ),
      { initialValue: EMPTY_INITIATIVES_RESPONSE }
    );
  }

  private initStats(): Signal<CrowdfundingInitiativesStats | undefined> {
    return toSignal(
      toObservable(computed(() => ({ scope: this.scope(), reload: this.reloadCount() }))).pipe(
        filter(({ scope }) => !scope || !!scope.uid),
        // startWith(undefined): the cards show their loading state, not the previous entity's numbers. A failed scoped
        // call shows zeroes; the list's error state is what the page shows in that case.
        switchMap(({ scope }) =>
          this.crowdfundingService.getMyInitiativesStats(scope).pipe(
            catchError(() => of(EMPTY_CROWDFUNDING_STATS)),
            startWith(undefined)
          )
        )
      )
    );
  }

  private initStatCards(): Signal<StatCardItem[]> {
    return computed<StatCardItem[]>(() => {
      const stats = this.stats();
      const raised = formatCurrency(stats?.totalRaised ?? 0);
      const raisedValue = stats && stats.monthlyGain > 0 ? `${raised} · +${formatCurrency(stats.monthlyGain)}/mo` : raised;

      return [
        { value: stats?.activeCount ?? 0, label: 'Active Initiatives', icon: 'fa-light fa-box-dollar', iconContainerClass: 'bg-blue-100 text-blue-600' },
        { value: raisedValue, label: 'Total Raised', icon: 'fa-light fa-dollar-sign', iconContainerClass: 'bg-emerald-100 text-emerald-600' },
        { value: stats?.totalSponsors ?? 0, label: 'Total Sponsors', icon: 'fa-light fa-users', iconContainerClass: 'bg-gray-200 text-gray-500' },
      ];
    });
  }
}
