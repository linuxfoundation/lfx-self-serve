// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { parseLocalDateString } from '@lfx-one/shared/utils';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, filter, of, switchMap, take, tap } from 'rxjs';
import { TooltipModule } from 'primeng/tooltip';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensMembershipsService } from '@services/org-lens-memberships.service';
import { CardComponent } from '@components/card/card.component';
import { TableComponent } from '@components/table/table.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import type {
  OrgActiveMembershipsResponse,
  OrgDiscoverOpportunitiesResponse,
  OrgExpiredMembershipsResponse,
  OrgMembershipsPageState,
  OrgMembershipTab,
  OrgDropdownOption,
  ActiveMembershipRow,
  ExpiredMembershipRow,
  DiscoverOpportunityRow,
} from '@lfx-one/shared/interfaces';
import { foundationInitials, foundationLogoSquareClasses } from '../components/org-overview-foundations-and-projects/helpers/foundation-logo.helper';

@Component({
  selector: 'lfx-org-memberships',
  standalone: true,
  imports: [FormsModule, RouterLink, TableComponent, TooltipModule, SelectModule, InputTextModule, CardComponent, EmptyStateComponent],
  templateUrl: './org-memberships.component.html',
})
export class OrgMembershipsComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly membershipsService = inject(OrgLensMembershipsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly activeTab = signal<OrgMembershipTab>('active');
  protected readonly retryTrigger = signal(0);

  protected readonly tabs = [
    { id: 'active' as const, label: 'Active', icon: 'fa-light fa-circle-check' },
    { id: 'expired' as const, label: 'Expired', icon: 'fa-light fa-clock-rotate-left' },
    { id: 'discover' as const, label: 'Discover', icon: 'fa-light fa-magnifying-glass' },
  ];

  private readonly allTiers = signal<string[]>([]);

  protected readonly tierOptions: Signal<OrgDropdownOption[]> = computed(() => this.initTierOptions());

  protected readonly renewalOptions: OrgDropdownOption[] = [
    { label: 'All Renewals', value: '' },
    { label: 'Renewing in 90 Days', value: '90' },
    { label: 'Renewing in 30 Days', value: '30' },
  ];

  protected readonly companyName = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');

  protected readonly searchTerm = signal('');
  protected readonly selectedTier = signal('');
  protected readonly selectedRenewal = signal('');
  protected readonly expiredSearchTerm = signal('');

  private readonly selectedOrgUid$ = toObservable(computed(() => this.accountContext.selectedAccount()?.uid));

  private readonly fetchError = signal(false);
  private readonly fetchLoading = signal(true);

  private readonly searchTerm$ = toObservable(this.searchTerm).pipe(debounceTime(300), distinctUntilChanged());
  private readonly selectedTier$ = toObservable(this.selectedTier).pipe(distinctUntilChanged());
  private readonly selectedRenewal$ = toObservable(this.selectedRenewal).pipe(distinctUntilChanged());
  private readonly retryTrigger$ = toObservable(this.retryTrigger);

  private readonly activeResponse$ = combineLatest([
    this.selectedOrgUid$.pipe(filter((id): id is string => !!id)),
    this.searchTerm$,
    this.selectedTier$,
    this.selectedRenewal$,
    this.retryTrigger$,
  ]).pipe(
    tap(() => {
      this.fetchLoading.set(true);
      this.fetchError.set(false);
    }),
    switchMap(([id, search, tier, renewal]) =>
      this.membershipsService.getActiveMemberships(id, { search: search || undefined, tier: tier || undefined, renewal: renewal || undefined }).pipe(
        catchError(() => {
          this.fetchError.set(true);
          this.fetchLoading.set(false);
          return of(null);
        })
      )
    ),
    tap((response) => {
      this.fetchLoading.set(false);
      if (response) {
        const tiers = [...new Set(response.memberships.map((m) => m.membershipTier))].sort();
        this.allTiers.set(tiers);
      }
    })
  );

  protected readonly activeData = toSignal<OrgActiveMembershipsResponse | null>(this.activeResponse$, { initialValue: null });
  protected readonly summary = computed(() => this.activeData()?.summary);
  protected readonly memberships: Signal<ActiveMembershipRow[]> = computed(() => this.initMemberships());

  protected readonly pageState: Signal<OrgMembershipsPageState> = computed(() => this.initPageState());

  private readonly expiredLoading = signal(false);
  private readonly expiredError = signal(false);
  private readonly expiredData = signal<OrgExpiredMembershipsResponse | null>(null);

  protected readonly expiredMemberships: Signal<ExpiredMembershipRow[]> = computed(() => this.initExpiredMemberships());

  protected readonly expiredState: Signal<OrgMembershipsPageState> = computed(() => this.initExpiredState());

  private readonly discoverLoading = signal(false);
  private readonly discoverError = signal(false);
  private readonly discoverData = signal<OrgDiscoverOpportunitiesResponse | null>(null);

  protected readonly discoverOpportunities: Signal<DiscoverOpportunityRow[]> = computed(() => this.initDiscoverOpportunities());

  protected readonly discoverState: Signal<OrgMembershipsPageState> = computed(() => this.initDiscoverState());

  private readonly renewBaseUrl = computed(() => this.initRenewBaseUrl());
  private readonly joinBaseUrl = computed(() => this.initJoinBaseUrl());

  private lastOrgUid: string | null = null;

  public constructor() {
    combineLatest([this.selectedOrgUid$.pipe(filter((id): id is string => !!id)), toObservable(this.activeTab)])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([orgUid, tab]) => {
        if (this.lastOrgUid && this.lastOrgUid !== orgUid) {
          this.expiredData.set(null);
          this.discoverData.set(null);
        }
        this.lastOrgUid = orgUid;
        if (tab === 'expired' && !this.expiredData()) this.fetchExpired(orgUid);
        if (tab === 'discover' && !this.discoverData()) this.fetchDiscover(orgUid);
      });
  }

  protected switchTab(tab: OrgMembershipTab): void {
    this.activeTab.set(tab);
  }

  protected onTabKeydown(event: KeyboardEvent): void {
    const ids = this.tabs.map((t) => t.id);
    const idx = ids.indexOf(this.activeTab());
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (idx + 1) % ids.length;
    else if (event.key === 'ArrowLeft') next = (idx - 1 + ids.length) % ids.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ids.length - 1;
    if (next !== null) {
      event.preventDefault();
      this.switchTab(ids[next]);
      if (typeof document !== 'undefined') {
        (document.getElementById(`memberships-tab-trigger-${ids[next]}`) as HTMLElement | null)?.focus();
      }
    }
  }

  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
  }

  protected retryExpired(): void {
    const orgUid = this.accountContext.selectedAccount()?.uid;
    if (orgUid) this.fetchExpired(orgUid);
  }

  protected retryDiscover(): void {
    const orgUid = this.accountContext.selectedAccount()?.uid;
    if (orgUid) this.fetchDiscover(orgUid);
  }

  // --- Private init methods for multi-line computed() (component-organization convention) ---

  private initRenewBaseUrl(): string {
    const slug = encodeURIComponent(this.accountContext.selectedAccount()?.accountSlug ?? '');
    return `https://myorg.lfx.dev/${slug}/project/project-group-membership`;
  }

  private initJoinBaseUrl(): string {
    const slug = encodeURIComponent(this.accountContext.selectedAccount()?.accountSlug ?? '');
    return `https://myorg.lfx.dev/${slug}/project`;
  }

  private initTierOptions(): OrgDropdownOption[] {
    return [{ label: 'All Membership Levels', value: '' }, ...this.allTiers().map((t) => ({ label: t, value: t }))];
  }

  private initPageState(): OrgMembershipsPageState {
    if (this.fetchLoading()) return 'loading';
    if (this.fetchError()) return 'error';
    const data = this.activeData();
    if (!data || data.memberships.length === 0) return 'empty';
    return 'ready';
  }

  private initMemberships(): ActiveMembershipRow[] {
    return (this.activeData()?.memberships ?? []).map((m) => ({
      ...m,
      initials: foundationInitials(m.foundationName),
      tierRange: `${this.formatDateShort(m.tierStartDate)} – ${this.formatDateShort(m.tierEndDate)}`,
      memberSinceFormatted: this.formatDateShort(m.memberSince),
    }));
  }

  private initExpiredMemberships(): ExpiredMembershipRow[] {
    const data = this.expiredData();
    if (!data) return [];
    const baseUrl = this.renewBaseUrl();
    let rows = data.memberships;
    const search = this.expiredSearchTerm().toLowerCase();
    if (search) {
      rows = rows.filter((m) => m.foundationName.toLowerCase().includes(search));
    }
    return rows.map((m) => ({
      ...m,
      initials: foundationInitials(m.foundationName),
      logoClasses: foundationLogoSquareClasses(m.foundationId),
      expirationDateFormatted: this.formatDateFull(m.expirationDate),
      tierStartFormatted: this.formatDateFull(m.tierStartDate),
      tierEndFormatted: this.formatDateFull(m.tierEndDate),
      renewUrl: `${baseUrl}/${encodeURIComponent(m.foundationId)}`,
    }));
  }

  private initExpiredState(): OrgMembershipsPageState {
    if (this.expiredLoading()) return 'loading';
    if (this.expiredError()) return 'error';
    if (!this.expiredData() || this.expiredMemberships().length === 0) return 'empty';
    return 'ready';
  }

  private initDiscoverOpportunities(): DiscoverOpportunityRow[] {
    const data = this.discoverData();
    if (!data) return [];
    const baseUrl = this.joinBaseUrl();
    return data.opportunities.map((o) => ({
      ...o,
      initials: foundationInitials(o.foundationName),
      logoClasses: foundationLogoSquareClasses(o.foundationId),
      joinUrl: `${baseUrl}/${encodeURIComponent(o.foundationId)}/membership`,
    }));
  }

  private initDiscoverState(): OrgMembershipsPageState {
    if (this.discoverLoading()) return 'loading';
    if (this.discoverError()) return 'error';
    if (!this.discoverData() || this.discoverOpportunities().length === 0) return 'empty';
    return 'ready';
  }

  private formatDateShort(dateString: string | null): string {
    if (!dateString) return '—';
    try {
      return parseLocalDateString(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    } catch {
      return dateString;
    }
  }

  private formatDateFull(dateString: string | null): string {
    if (!dateString) return '—';
    try {
      return parseLocalDateString(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return dateString;
    }
  }

  // --- Private fetch methods ---

  private fetchExpired(orgUid: string): void {
    this.expiredLoading.set(true);
    this.expiredError.set(false);
    this.membershipsService
      .getExpiredMemberships(orgUid)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          if (this.accountContext.selectedAccount()?.uid !== orgUid) return;
          this.expiredData.set(data);
          this.expiredLoading.set(false);
        },
        error: () => {
          if (this.accountContext.selectedAccount()?.uid !== orgUid) return;
          this.expiredError.set(true);
          this.expiredLoading.set(false);
        },
      });
  }

  private fetchDiscover(orgUid: string): void {
    this.discoverLoading.set(true);
    this.discoverError.set(false);
    this.membershipsService
      .getDiscoverOpportunities(orgUid)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          if (this.accountContext.selectedAccount()?.uid !== orgUid) return;
          this.discoverData.set(data);
          this.discoverLoading.set(false);
        },
        error: () => {
          if (this.accountContext.selectedAccount()?.uid !== orgUid) return;
          this.discoverError.set(true);
          this.discoverLoading.set(false);
        },
      });
  }
}
