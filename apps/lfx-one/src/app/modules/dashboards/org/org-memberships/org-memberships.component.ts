// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { catchError, combineLatest, filter, of, switchMap, tap } from 'rxjs';
import { TooltipModule } from 'primeng/tooltip';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensMembershipsService } from '@services/org-lens-memberships.service';
import { CardComponent } from '@components/card/card.component';
import { TableComponent } from '@components/table/table.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import type {
  OrgActiveMembership,
  OrgActiveMembershipsResponse,
  OrgDiscoverOpportunitiesResponse,
  OrgExpiredMembershipsResponse,
} from '@lfx-one/shared/interfaces';
import { foundationInitials, foundationLogoSquareClasses } from '../components/org-overview-foundations-and-projects/helpers/foundation-logo.helper';

type PageState = 'loading' | 'error' | 'ready' | 'empty';
type MembershipTab = 'active' | 'expired' | 'discover';

interface DropdownOption {
  label: string;
  value: string;
}

@Component({
  selector: 'lfx-org-memberships',
  standalone: true,
  imports: [FormsModule, TableComponent, TooltipModule, SelectModule, InputTextModule, CardComponent, EmptyStateComponent],
  templateUrl: './org-memberships.component.html',
})
export class OrgMembershipsComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly membershipsService = inject(OrgLensMembershipsService);

  protected readonly activeTab = signal<MembershipTab>('active');
  protected readonly retryTrigger = signal(0);

  protected readonly tabs = [
    { id: 'active' as const, label: 'Active', icon: 'fa-light fa-circle-check' },
    { id: 'expired' as const, label: 'Expired', icon: 'fa-light fa-clock-rotate-left' },
    { id: 'discover' as const, label: 'Discover', icon: 'fa-light fa-magnifying-glass' },
  ];

  private readonly allTiers = signal<string[]>([]);

  protected readonly tierOptions = computed<DropdownOption[]>(() => {
    return [
      { label: 'All Membership Levels', value: '' },
      ...this.allTiers().map((t) => ({ label: t, value: t })),
    ];
  });

  protected readonly renewalOptions: DropdownOption[] = [
    { label: 'All Renewals', value: '' },
    { label: 'Renewing in 90 Days', value: '90' },
    { label: 'Renewing in 30 Days', value: '30' },
  ];

  protected readonly companyName = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');

  protected readonly searchTerm = signal('');
  protected readonly selectedTier = signal('');
  protected readonly selectedRenewal = signal('');
  protected readonly expiredSearchTerm = signal('');

  private readonly selectedAccountId$ = toObservable(computed(() => this.accountContext.selectedAccount()?.accountId));

  private readonly fetchError = signal(false);
  private readonly fetchLoading = signal(true);

  private readonly searchTerm$ = toObservable(this.searchTerm);
  private readonly selectedTier$ = toObservable(this.selectedTier);
  private readonly selectedRenewal$ = toObservable(this.selectedRenewal);

  private readonly activeResponse$ = combineLatest([
    this.selectedAccountId$.pipe(filter((id): id is string => !!id)),
    this.searchTerm$,
    this.selectedTier$,
    this.selectedRenewal$,
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
      if (response && !this.selectedTier()) {
        const tiers = [...new Set(response.memberships.map((m) => m.membershipTier))].sort();
        this.allTiers.set(tiers);
      }
    })
  );

  protected readonly activeData = toSignal<OrgActiveMembershipsResponse | null>(this.activeResponse$, { initialValue: null });
  protected readonly summary = computed(() => this.activeData()?.summary);
  protected readonly memberships = computed(() => this.activeData()?.memberships ?? []);

  protected readonly pageState = computed<PageState>(() => {
    if (this.fetchLoading()) return 'loading';
    if (this.fetchError()) return 'error';
    const data = this.activeData();
    if (!data || data.memberships.length === 0) return 'empty';
    return 'ready';
  });

  private readonly expiredLoading = signal(false);
  private readonly expiredError = signal(false);
  private readonly expiredData = signal<OrgExpiredMembershipsResponse | null>(null);

  protected readonly expiredMemberships = computed(() => {
    const data = this.expiredData();
    if (!data) return [];
    const search = this.expiredSearchTerm().toLowerCase();
    if (!search) return data.memberships;
    return data.memberships.filter((m) => m.foundationName.toLowerCase().includes(search));
  });

  protected readonly expiredState = computed<PageState>(() => {
    if (this.expiredLoading()) return 'loading';
    if (this.expiredError()) return 'error';
    if (!this.expiredData() || this.expiredMemberships().length === 0) return 'empty';
    return 'ready';
  });

  private readonly discoverLoading = signal(false);
  private readonly discoverError = signal(false);
  private readonly discoverData = signal<OrgDiscoverOpportunitiesResponse | null>(null);

  protected readonly discoverOpportunities = computed(() => this.discoverData()?.opportunities ?? []);

  protected readonly discoverState = computed<PageState>(() => {
    if (this.discoverLoading()) return 'loading';
    if (this.discoverError()) return 'error';
    if (!this.discoverData() || this.discoverOpportunities().length === 0) return 'empty';
    return 'ready';
  });

  public constructor() {
    effect(() => {
      const tab = this.activeTab();
      const accountId = this.accountContext.selectedAccount()?.accountId;
      if (!accountId) return;

      if (tab === 'expired' && !this.expiredData()) {
        this.fetchExpired(accountId);
      }
      if (tab === 'discover' && !this.discoverData()) {
        this.fetchDiscover(accountId);
      }
    });
  }

  protected switchTab(tab: MembershipTab): void {
    this.activeTab.set(tab);
  }

  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
  }

  protected formatDateShort(dateString: string | null): string {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  }

  protected formatDateFull(dateString: string | null): string {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  protected formatTierRange(membership: OrgActiveMembership): string {
    return `${this.formatDateShort(membership.tierStartDate)} – ${this.formatDateShort(membership.tierEndDate)}`;
  }

  protected getInitials(name: string): string {
    return foundationInitials(name);
  }

  protected getLogoClasses(foundationId: string): string {
    return foundationLogoSquareClasses(foundationId);
  }

  protected getRenewUrl(foundationId: string): string {
    const slug = this.accountContext.selectedAccount()?.accountSlug ?? '';
    return `https://myorg.lfx.dev/${slug}/project/project-group-membership/${foundationId}`;
  }

  protected getJoinUrl(foundationId: string): string {
    const slug = this.accountContext.selectedAccount()?.accountSlug ?? '';
    return `https://myorg.lfx.dev/${slug}/project/${foundationId}/membership`;
  }

  private fetchExpired(accountId: string): void {
    this.expiredLoading.set(true);
    this.expiredError.set(false);
    this.membershipsService.getExpiredMemberships(accountId).subscribe({
      next: (data) => {
        this.expiredData.set(data);
        this.expiredLoading.set(false);
      },
      error: () => {
        this.expiredError.set(true);
        this.expiredLoading.set(false);
      },
    });
  }

  private fetchDiscover(accountId: string): void {
    this.discoverLoading.set(true);
    this.discoverError.set(false);
    this.membershipsService.getDiscoverOpportunities(accountId).subscribe({
      next: (data) => {
        this.discoverData.set(data);
        this.discoverLoading.set(false);
      },
      error: () => {
        this.discoverError.set(true);
        this.discoverLoading.set(false);
      },
    });
  }
}
