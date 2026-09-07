// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import type { OrgClaGroup, OrgClaGroupList } from '@lfx-one/shared/interfaces';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, filter, of, skip, switchMap, tap } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { OrgNavigationService } from '@shared/services/org-navigation.service';

import { OrgEasyclaCardComponent } from './org-easycla-card/org-easycla-card.component';

/** Matches the approved design's page size. */
const PAGE_SIZE = 8;

@Component({
  selector: 'lfx-org-easycla',
  imports: [ButtonComponent, EmptyStateComponent, InputTextComponent, OpenIntercomDirective, OrgEasyclaCardComponent, SkeletonModule],
  templateUrl: './org-easycla.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  private readonly personaService = inject(PersonaService);
  private readonly orgNavigation = inject(OrgNavigationService);
  private readonly claService = inject(OrgLensClaService);
  private readonly platformId = inject(PLATFORM_ID);

  // ── Search (client-side; the upstream list takes no search parameter) ──────
  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
  });

  protected readonly fetchError = signal(false);
  private readonly claLoadingState = signal(false);
  private readonly page = signal(0);

  // ── Org context ───────────────────────────────────────────────────────────
  protected readonly companyName = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');
  protected readonly hasCompany = computed(() => !!this.accountContext.selectedAccount()?.uid);

  /**
   * True once both grant fetches have returned and the caller holds no org access. The route guard
   * only checks the dark-launch flag, so without this an unauthorized deep link would be told
   * "hasn't signed any CLAs yet" — a statement about their CLAs rather than about their access.
   *
   * Shares `hasOrgSelectorAccess` with the sidebar org-selector so the two cannot drift, and waits
   * on `personaLoaded()` as well: for users whose orgs arrive only via the async personas response,
   * role grants can return empty first and flash the no-access message. See
   * `org-overview.component.ts` for the full reasoning.
   */
  protected readonly hasNoOrgAccess: Signal<boolean> = computed(
    () => this.orgRoleGrantsService.loaded() && this.personaService.personaLoaded() && !this.accountContext.hasOrgSelectorAccess()
  );

  /**
   * No-access is a settled answer in its own right, so it does not wait behind the loading branch.
   *
   * `orgNavigation.loaded()` is part of the authorized branch because grants and personas can both
   * be loaded while the org list is still being fetched and default-selected — for a direct
   * writer/auditor whose persona payload carries no organization seed, and for LF staff, who
   * satisfy `hasOrgSelectorAccess` with an empty account list. Without it those users would see a
   * settled answer about their CLAs before any company was selected.
   */
  protected readonly orgContextLoaded: Signal<boolean> = computed(
    () => this.hasNoOrgAccess() || (this.orgNavigation.loaded() && this.orgRoleGrantsService.loaded() && this.personaService.personaLoaded())
  );

  // ── Data ──────────────────────────────────────────────────────────────────
  private readonly searchTerm: Signal<string> = this.initSearchTerm();

  // Shared with the constructor's org-switch reset below — mirrors org-groups' orgUid$.
  private readonly orgUid$ = toObservable(computed(() => this.accountContext.selectedAccount()?.uid)).pipe(
    filter((uid): uid is string => !!uid),
    distinctUntilChanged()
  );

  private readonly claData: Signal<OrgClaGroupList | null | undefined> = this.initClaData();

  /**
   * Undefined until the first response lands; `null` after a failure, which is a different state.
   * The explicit flag covers the switch: `toSignal` holds the previous organization's response
   * until the new one arrives, so `=== undefined` alone would let that organization's cards — or
   * its "signed nothing" empty state — render under the newly selected company's name.
   */
  protected readonly claLoading = computed(() => this.hasCompany() && (this.claData() === undefined || this.claLoadingState()) && !this.fetchError());

  protected readonly claGroups: Signal<OrgClaGroup[]> = computed(() => this.claData()?.claGroups ?? []);
  protected readonly filteredClaGroups: Signal<OrgClaGroup[]> = this.initFilteredClaGroups();

  // ── Paging (client-side; the upstream list is unpaged) ────────────────────
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.filteredClaGroups().length / PAGE_SIZE)));

  /**
   * Clamped rather than read raw, so a narrowing that shrinks the result set below the current
   * page cannot strand the viewer on a page that no longer exists. The reset in the constructor
   * handles the common case; this covers the rest without a second writer.
   */
  protected readonly currentPage = computed(() => Math.min(this.page(), this.pageCount() - 1));
  protected readonly pagedClaGroups: Signal<OrgClaGroup[]> = this.initPagedClaGroups();
  protected readonly showPager = computed(() => this.filteredClaGroups().length > PAGE_SIZE);
  protected readonly pageLabel: Signal<string> = this.initPageLabel();
  protected readonly onFirstPage = computed(() => this.currentPage() === 0);
  protected readonly onLastPage = computed(() => this.currentPage() >= this.pageCount() - 1);

  // ── Empty states (mutually exclusive) ─────────────────────────────────────
  private readonly settled = computed(() => this.hasCompany() && !this.claLoading() && !this.fetchError());

  /** The organization has signed nothing at all. */
  protected readonly showNoClasEmptyState = computed(() => this.settled() && this.claGroups().length === 0);

  /** The organization has CLAs but the search matched none. Never shown alongside the above. */
  protected readonly showNoMatchesEmptyState = computed(() => this.settled() && this.claGroups().length > 0 && this.filteredClaGroups().length === 0);

  protected readonly noClasTitle = computed(() => `${this.companyName()} hasn't signed any CLAs yet`);

  /**
   * The toolbar does not collapse with the list: both empty states keep the search box and the
   * Sign CLA button visible, so a viewer can revise a search or start an agreement without
   * reloading. Only the card grid and the pager hide.
   */
  protected readonly showToolbar = computed(() => this.settled() || this.fetchError());

  public constructor() {
    // A narrowed set has its own first page; keeping the old index would show the viewer an empty
    // page of a non-empty result. Driven off the raw control value rather than the trimmed term so
    // clearing a query down to trailing whitespace also returns to the top.
    this.filterForm.controls.search.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.page.set(0));

    // A query typed against the previous organization would carry over and hide the new one's
    // agreements behind the no-matches empty state, and a leftover index would open its list
    // part-way through. `skip(1)` leaves the first load alone; only an actual switch resets.
    this.orgUid$.pipe(skip(1), takeUntilDestroyed()).subscribe(() => {
      this.filterForm.reset({ search: '' });
      this.page.set(0);
    });
  }

  protected changePage(delta: number): void {
    this.page.set(Math.min(Math.max(this.currentPage() + delta, 0), this.pageCount() - 1));
  }

  private initSearchTerm(): Signal<string> {
    const value = toSignal(this.filterForm.controls.search.valueChanges, { initialValue: '' });
    return computed(() => value().trim().toLowerCase());
  }

  private initClaData(): Signal<OrgClaGroupList | null | undefined> {
    if (!isPlatformBrowser(this.platformId)) {
      return signal<OrgClaGroupList | null | undefined>(undefined);
    }

    return toSignal(
      this.orgUid$.pipe(
        tap(() => {
          this.claLoadingState.set(true);
          this.fetchError.set(false);
        }),
        switchMap((uid) =>
          this.claService.getClaGroups(uid).pipe(
            tap(() => this.claLoadingState.set(false)),
            catchError((error: unknown) => {
              // A failure must never become an empty list here. Upstream returns an empty list both
              // for an organization with no agreements and for one it has no record of, so there is
              // no signal left to distinguish "could not load" from "has signed nothing" — and only
              // one of those is a claim about the company's legal position.
              console.error('Failed to load organization CLA groups:', error);
              this.fetchError.set(true);
              this.claLoadingState.set(false);
              return of(null);
            })
          )
        ),
        takeUntilDestroyed()
      )
    );
  }

  /**
   * Matches the approved design's predicate: CLA Group name, foundation name, or any covered
   * project name.
   *
   * Signing entity is deliberately not matched. It is not in the design's predicate, and in the
   * common case where it equals the organization's own name, searching that name would match
   * every row and narrow nothing.
   */
  private initFilteredClaGroups(): Signal<OrgClaGroup[]> {
    return computed(() => {
      const term = this.searchTerm();
      if (!term) return this.claGroups();

      return this.claGroups().filter(
        (group) =>
          group.claGroupName.toLowerCase().includes(term) ||
          (group.foundationName?.toLowerCase().includes(term) ?? false) ||
          group.projects.some((project) => project.projectName.toLowerCase().includes(term))
      );
    });
  }

  private initPagedClaGroups(): Signal<OrgClaGroup[]> {
    return computed(() => {
      const start = this.currentPage() * PAGE_SIZE;
      return this.filteredClaGroups().slice(start, start + PAGE_SIZE);
    });
  }

  private initPageLabel(): Signal<string> {
    return computed(() => {
      const total = this.filteredClaGroups().length;
      if (total === 0) return '';

      const start = this.currentPage() * PAGE_SIZE;
      return `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total}`;
    });
  }
}
