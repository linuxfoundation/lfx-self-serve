// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { PageHeaderComponent } from '@components/page-header/page-header.component';
import { TagComponent } from '@components/tag/tag.component';
import { DEFAULT_CROWDFUNDING_PAGE_SIZE, EMPTY_ORG_DONATIONS } from '@lfx-one/shared/constants';
import { InitiativesLoadError, OrgDonationsResponse } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { CrowdfundingService } from '@services/crowdfunding.service';
import { of } from 'rxjs';
import { catchError, filter, finalize, scan, switchMap, tap } from 'rxjs/operators';

/** Org lens Donations page (#415): Crowdfunding donations matched to the selected organization. */
@Component({
  selector: 'lfx-org-donations',
  imports: [ButtonComponent, EmptyStateComponent, PageHeaderComponent, RouteLoadingComponent, TagComponent, CurrencyPipe, DatePipe],
  templateUrl: './org-donations.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgDonationsComponent {
  // ─── Private Injections ────────────────────────────────────────────────────
  private readonly crowdfundingService = inject(CrowdfundingService);
  private readonly accountContext = inject(AccountContextService);

  // ─── Simple WritableSignals ───────────────────────────────────────────────
  protected readonly isLoading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly loadError = signal<InitiativesLoadError | null>(null);
  // Bumped by Try again to refetch the same organization.
  private readonly reloadCount = signal(0);

  // ─── Computed Signals ─────────────────────────────────────────────────────
  // '' = the selected organization has not resolved yet. The account is re-set as its display fields hydrate, but
  // a computed string only changes for a different organization.
  private readonly orgUid = computed(() => this.accountContext.selectedAccount().uid ?? '');
  protected readonly orgName = computed(() => this.accountContext.selectedAccount().accountName);
  // Pagination driver — back to the first page whenever the organization changes or Try again is clicked.
  private readonly page = linkedSignal({
    source: () => ({ orgUid: this.orgUid(), reload: this.reloadCount() }),
    computation: ({ orgUid }) => ({ orgUid, offset: 0 }),
  });
  private readonly donationsState: Signal<OrgDonationsResponse> = this.initDonations();
  protected readonly donations = computed(() => this.donationsState().data);
  protected readonly hasMore = computed(() => this.donationsState().data.length < this.donationsState().total);

  // ─── Protected Methods ─────────────────────────────────────────────────────
  protected onLoadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);
    this.page.update((curr) => ({ ...curr, offset: curr.offset + DEFAULT_CROWDFUNDING_PAGE_SIZE }));
  }

  protected onRetry(): void {
    this.reloadCount.update((count) => count + 1);
  }

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initDonations(): Signal<OrgDonationsResponse> {
    return toSignal(
      toObservable(this.page).pipe(
        filter(({ orgUid }) => !!orgUid),
        // A first page (initial load, organization switch, retry) shows the loader, not the previous organization's rows.
        tap(({ offset }) => {
          if (offset !== 0) return;
          this.isLoading.set(true);
          this.loadError.set(null);
        }),
        switchMap(({ orgUid, offset }) =>
          this.crowdfundingService.getOrgDonations({ orgUid, pageSize: DEFAULT_CROWDFUNDING_PAGE_SIZE, offset }).pipe(
            // 403 = not an auditor on the organization; anything else = CF or its FGA check is down.
            catchError((err: HttpErrorResponse) => {
              this.loadError.set(err.status === 403 ? 'forbidden' : 'unavailable');
              return of(EMPTY_ORG_DONATIONS);
            }),
            finalize(() => this.loadingMore.set(false))
          )
        ),
        scan((acc, curr) => (curr.offset === 0 ? curr : { ...curr, data: [...acc.data, ...curr.data] }), EMPTY_ORG_DONATIONS),
        tap(() => this.isLoading.set(false))
      ),
      { initialValue: EMPTY_ORG_DONATIONS }
    );
  }
}
