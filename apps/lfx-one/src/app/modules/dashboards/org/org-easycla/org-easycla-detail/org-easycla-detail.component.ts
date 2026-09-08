// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import type { OrgClaDetailTab, OrgClaDetailTabView, OrgClaGroup, OrgClaGroupList, OrgClaStatusDisplay } from '@lfx-one/shared/interfaces';
import { ORG_CLA_DETAIL_TABS } from '@lfx-one/shared/constants';
import {
  downloadFromUrl,
  formatClaSignedOnInstant,
  ORG_CLA_HEADING_STATUS,
  ORG_CLA_STATUS_DISPLAY,
  orgClaCoverageChips,
  orgClaCoverageSummary,
} from '@lfx-one/shared/utils';
import { MenuItem, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, distinctUntilChanged, filter, finalize, map, of, skip, switchMap, takeUntil, tap } from 'rxjs';

import { BreadcrumbComponent } from '@components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TagComponent } from '@components/tag/tag.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { OrgNavigationService } from '@shared/services/org-navigation.service';

import { OrgEasyclaCoverageDialogComponent } from './org-easycla-coverage-dialog.component';

@Component({
  selector: 'lfx-org-easycla-detail',
  imports: [BreadcrumbComponent, ButtonComponent, EmptyStateComponent, OpenIntercomDirective, SkeletonModule, TagComponent],
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

  private readonly orgUid$ = toObservable(computed(() => this.accountContext.selectedAccount()?.uid)).pipe(
    filter((uid): uid is string => !!uid),
    distinctUntilChanged()
  );

  // Emits when the selected organization changes, skipping the value present at subscribe time.
  // Switching organizations does not destroy this component — it re-drives the list fetch — so
  // `takeUntilDestroyed` alone leaves an in-flight download running against the organization the
  // viewer has left, and its response would hand them that organization's agreement while the
  // page shows another. Cancelling drops the response and the request with it.
  private readonly orgChanged$ = this.orgUid$.pipe(skip(1));

  private readonly claData: Signal<OrgClaGroupList | null | undefined> = this.initClaData();

  protected readonly claLoading = computed(() => this.hasCompany() && (this.claData() === undefined || this.claLoadingState()) && !this.fetchError());

  protected readonly claGroup: Signal<OrgClaGroup | undefined> = computed(() => this.initClaGroup());

  protected readonly notFound = computed(() => this.hasCompany() && !this.claLoading() && !this.fetchError() && !!this.claData() && !this.claGroup());

  protected readonly status = computed(() => this.initStatus());

  protected readonly coverageChips = computed(() => this.initCoverageChips());

  protected readonly cclaHeading = computed(() => this.initCclaHeading());

  protected readonly coverageHint = computed(() => this.initCoverageHint());

  // The design offers the document on the signed and sanctioned bodies only. A not-started
  // agreement has no signed document, so the control could do nothing but fail.
  protected readonly canDownload = computed(() => !!this.claGroup() && this.claGroup()?.status !== 'not-started');

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

  protected openCoverage(): void {
    const group = this.claGroup();
    if (!group) return;

    this.dialogService.open(OrgEasyclaCoverageDialogComponent, {
      header: `Projects covered by ${group.claGroupName}`,
      modal: true,
      width: '28rem',
      data: { claGroupName: group.claGroupName, foundationName: group.foundationName, projects: group.projects },
    });
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
        takeUntil(this.orgChanged$),
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

  private initCoverageChips(): string[] {
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

    return toSignal(
      combineLatest([
        this.orgUid$,
        toObservable(this.signatureId).pipe(
          filter((id) => !!id),
          distinctUntilChanged()
        ),
      ]).pipe(
        tap(() => {
          this.claLoadingState.set(true);
          this.fetchError.set(false);
        }),
        switchMap(([uid]) =>
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
