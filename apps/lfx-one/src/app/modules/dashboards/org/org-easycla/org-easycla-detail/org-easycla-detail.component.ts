// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import type { OrgClaCoverageChip, OrgClaDetailTab, OrgClaDetailTabView, OrgClaGroup, OrgClaGroupList, OrgClaStatusDisplay } from '@lfx-one/shared/interfaces';
import { ORG_CLA_DETAIL_TABS, ORG_CLA_HEADING_STATUS, ORG_CLA_STATUS_DISPLAY } from '@lfx-one/shared/constants';
import { downloadFromUrl, formatClaSignedOnInstant, orgClaCoverageChips, orgClaCoverageSummary } from '@lfx-one/shared/utils';
import { MenuItem, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, distinctUntilChanged, filter, finalize, map, of, skip, switchMap, takeUntil, tap } from 'rxjs';

import { BreadcrumbComponent } from '@components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MessageComponent } from '@components/message/message.component';
import { TagComponent } from '@components/tag/tag.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { OrgNavigationService } from '@shared/services/org-navigation.service';

import { orgClaCoverageDialogConfig, OrgEasyclaCoverageDialogComponent } from '../org-easycla-coverage-dialog/org-easycla-coverage-dialog.component';
import { OrgEasyclaApprovalListComponent } from './org-easycla-approval-list.component';

@Component({
  selector: 'lfx-org-easycla-detail',
  imports: [
    BreadcrumbComponent,
    ButtonComponent,
    EmptyStateComponent,
    MessageComponent,
    OpenIntercomDirective,
    OrgEasyclaApprovalListComponent,
    SkeletonModule,
    TagComponent,
  ],
  providers: [DialogService],
  templateUrl: './org-easycla-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly accountContext = inject(AccountContextService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  private readonly personaService = inject(PersonaService);
  private readonly orgNavigation = inject(OrgNavigationService);
  private readonly claService = inject(OrgLensClaService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly activeTab = signal<OrgClaDetailTab>('overview');
  protected readonly downloading = signal(false);
  protected readonly fetchError = signal(false);
  private readonly claLoadingState = signal(false);

  /**
   * Set by the approval tab after it writes; `null` until then, so the row's own count is used.
   *
   * Keyed on the signature rather than held as a bare number: Angular reuses this component when
   * only `:signatureId` changes, so an unkeyed override would carry one agreement's count onto the
   * next agreement's badge.
   */
  private readonly approvalCountOverride = signal<{ signatureId: string; count: number } | null>(null);

  protected readonly companyName = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');
  protected readonly hasCompany = computed(() => !!this.accountContext.selectedAccount()?.uid);

  protected readonly hasNoOrgAccess: Signal<boolean> = computed(
    () => this.orgRoleGrantsService.loaded() && this.personaService.personaLoaded() && !this.accountContext.hasOrgSelectorAccess()
  );

  protected readonly orgContextLoaded: Signal<boolean> = computed(
    () => this.hasNoOrgAccess() || (this.orgNavigation.loaded() && this.orgRoleGrantsService.loaded() && this.personaService.personaLoaded())
  );

  private readonly signatureId: Signal<string> = toSignal(
    this.route.paramMap.pipe(
      map((params) => (params.get('signatureId') ?? '').trim()),
      distinctUntilChanged()
    ),
    { initialValue: (this.route.snapshot.paramMap.get('signatureId') ?? '').trim() }
  );

  // Every selection the viewer makes, including clearing it.
  private readonly selectedOrgUid$ = toObservable(computed(() => this.accountContext.selectedAccount()?.uid)).pipe(distinctUntilChanged());

  private readonly orgUid$ = this.selectedOrgUid$.pipe(filter((uid): uid is string => !!uid));

  // Emits when what the page is showing changes — the selected organization, or the agreement in
  // the route — skipping the value present at subscribe time. Neither change destroys this
  // component: switching organizations re-drives the list fetch, and Angular reuses the component
  // when `:signatureId` changes. So `takeUntilDestroyed` alone leaves an in-flight download
  // running against a context the viewer has left, and its response would hand them one
  // organization's or agreement's document while the page shows another. Cancelling drops the
  // response and the request with it.
  //
  // The organization arm is the unfiltered stream, not `orgUid$`: clearing the selection empties
  // the page just as switching does, so it must cancel too, and the non-empty filter would
  // swallow it.
  private readonly contextChanged$ = combineLatest([this.selectedOrgUid$, toObservable(this.signatureId)]).pipe(skip(1));

  private readonly claData: Signal<OrgClaGroupList | null | undefined> = this.initClaData();

  /**
   * `toSignal` holds the previous organization's response until the new one arrives, so the
   * selection changes before the data does. Rendering that window would show one organization's
   * agreement, signer and covered projects under another organization's name. Mirrors the list
   * page, which folds the same mismatch into its loading state.
   */
  private readonly claDataIsForSelectedOrg = computed(() => {
    const data = this.claData();
    return !data || data.orgUid === this.accountContext.selectedAccount()?.uid;
  });

  protected readonly claLoading = computed(
    () => this.hasCompany() && (this.claData() === undefined || this.claLoadingState() || !this.claDataIsForSelectedOrg()) && !this.fetchError()
  );

  protected readonly claGroup: Signal<OrgClaGroup | undefined> = computed(() => this.initClaGroup());

  protected readonly notFound = computed(() => this.hasCompany() && !this.claLoading() && !this.fetchError() && !!this.claData() && !this.claGroup());

  protected readonly status = computed(() => this.initStatus());

  protected readonly coverageChips = computed(() => this.initCoverageChips());

  protected readonly cclaHeading = computed(() => this.initCclaHeading());

  protected readonly coverageHint = computed(() => this.initCoverageHint());

  // Read from `signed` rather than the status: sanctions win the single status slot, so a
  // `sanctioned` row may be signed or unsigned, and offering the document on an unsigned one
  // gives the viewer a control that can only fail.
  protected readonly canDownload = computed(() => this.claGroup()?.signed === true);

  protected readonly signedOnLabel = computed(() => this.initSignedOnLabel());

  protected readonly signedByName = computed(() => this.initSignedByName());

  protected readonly breadcrumbItems = computed<MenuItem[]>(() => this.initBreadcrumbItems());

  protected readonly managersBadge = computed(() => String(this.claGroup()?.claManagersCount ?? 0));

  protected readonly approvalBadge = computed(() => this.initApprovalBadge());

  protected readonly tabs = computed(() => this.initTabs());

  protected selectTab(tab: OrgClaDetailTab): void {
    this.activeTab.set(tab);
  }

  protected onTabKeydown(event: KeyboardEvent): void {
    const ids = ORG_CLA_DETAIL_TABS.map((tab) => tab.id);
    const current = ids.indexOf(this.activeTab());

    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (current + 1) % ids.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + ids.length) % ids.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ids.length - 1;
    if (next === null) return;

    event.preventDefault();
    this.selectTab(ids[next]);
    if (isPlatformBrowser(this.platformId)) {
      document.getElementById(`org-easycla-detail-tab-trigger-${ids[next]}`)?.focus();
    }
  }

  protected onApprovalCountChanged(count: number): void {
    this.approvalCountOverride.set({ signatureId: this.signatureId(), count });
  }

  protected openCoverage(): void {
    const group = this.claGroup();
    if (!group) return;

    this.dialogService.open(OrgEasyclaCoverageDialogComponent, orgClaCoverageDialogConfig(group));
  }

  protected onDownload(): void {
    const group = this.claGroup();
    const orgUid = this.accountContext.selectedAccount()?.uid;
    if (!group || !orgUid || this.downloading()) return;

    this.downloading.set(true);
    this.claService
      .getPdfUrl(orgUid, group.id)
      // `finalize` rather than clearing the flag in each handler: cancellation runs neither, and
      // would otherwise leave the button spinning for the rest of the page's life.
      .pipe(
        finalize(() => this.downloading.set(false)),
        takeUntil(this.contextChanged$),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: ({ url }) => {
          downloadFromUrl(url, `${group.claGroupName}-signed.pdf`);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: 'Download failed',
            detail: 'Could not download the signed document. Please try again.',
          });
        },
      });
  }

  private initClaGroup(): OrgClaGroup | undefined {
    const id = this.signatureId();
    if (!id) return undefined;
    return this.claData()?.claGroups.find((group) => group.id === id);
  }

  private initStatus(): OrgClaStatusDisplay | undefined {
    const group = this.claGroup();
    return group ? ORG_CLA_STATUS_DISPLAY[group.status] : undefined;
  }

  private initCoverageChips(): OrgClaCoverageChip[] {
    const group = this.claGroup();
    return group ? orgClaCoverageChips(group) : [];
  }

  private initCclaHeading(): string {
    const group = this.claGroup();
    return group ? `${group.claGroupName} — ${ORG_CLA_HEADING_STATUS[group.status]}` : '';
  }

  private initCoverageHint(): string {
    const group = this.claGroup();
    // The other statuses carry their own explanatory body in the design, and those bodies are not
    // part of this feature — so this line is withheld rather than shown under copy that is absent.
    if (!group || group.status !== 'signed') return '';

    const summary = orgClaCoverageSummary(group);
    const company = this.companyName();
    return summary && company ? `Covers ${summary} for ${company}'s employees.` : '';
  }

  private initSignedOnLabel(): string {
    const signedOn = this.claGroup()?.signedOn;
    if (!signedOn) return '';
    const label = formatClaSignedOnInstant(signedOn);
    return label === '—' ? '' : label;
  }

  private initSignedByName(): string {
    return this.claGroup()?.signedBy?.trim() ?? '';
  }

  private initBreadcrumbItems(): MenuItem[] {
    const name = this.claGroup()?.claGroupName;
    const root: MenuItem = { label: 'EasyCLA', routerLink: ['/org/easycla'] };
    return name ? [root, { label: name }] : [root];
  }

  private initApprovalBadge(): string {
    // The tab's own count wins once it has written, because the row's `approvalCriteriaCount` came
    // from the list fetch and does not move when the approval tab adds or removes a rule —
    // leaving the badge reporting the count from page load while the table showed another.
    const override = this.approvalCountOverride();
    if (override && override.signatureId === this.signatureId()) return String(override.count);

    const count = this.claGroup()?.approvalCriteriaCount;
    return count === undefined ? '—' : String(count);
  }

  private initTabs(): OrgClaDetailTabView[] {
    return ORG_CLA_DETAIL_TABS.map((tab) => ({ ...tab, badge: this.tabBadge(tab.id) }));
  }

  private tabBadge(tab: OrgClaDetailTab): string {
    if (tab === 'managers') return this.managersBadge();
    if (tab === 'approval') return this.approvalBadge();
    return '';
  }

  private initClaData(): Signal<OrgClaGroupList | null | undefined> {
    if (!isPlatformBrowser(this.platformId)) {
      return signal<OrgClaGroupList | null | undefined>(undefined);
    }

    // Keyed on the organization alone. The response is the org's whole CLA list and `claGroup`
    // picks this page's row out of it, so `signatureId` must stay out of this stream: Angular
    // reuses the component when only that param changes, and driving the fetch from it would
    // raise the skeleton over the full page and re-request a list already in memory to arrive at
    // the same rows.
    return toSignal(
      this.orgUid$.pipe(
        tap(() => {
          this.claLoadingState.set(true);
          this.fetchError.set(false);
        }),
        switchMap((uid) =>
          this.claService.getClaGroups(uid).pipe(
            tap(() => this.claLoadingState.set(false)),
            catchError((error: HttpErrorResponse) => {
              console.error('Failed to load organization CLA groups:', error.status, error.message);
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
}
