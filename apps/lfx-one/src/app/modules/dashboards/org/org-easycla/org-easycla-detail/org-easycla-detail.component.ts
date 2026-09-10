// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import type {
  OrgClaCoverageChip,
  OrgClaDetailTab,
  OrgClaDetailTabView,
  OrgClaGroup,
  OrgClaGroupList,
  OrgClaGroupPickerResult,
  OrgClaSignAttestations,
  OrgClaStatusDisplay,
} from '@lfx-one/shared/interfaces';
import { CCLA_SIGN_COPY, ORG_CLA_DETAIL_TABS, ORG_CLA_HEADING_STATUS, ORG_CLA_NOT_STARTED_COPY, ORG_CLA_STATUS_DISPLAY } from '@lfx-one/shared/constants';
import { downloadFromUrl, formatClaSignedOnInstant, orgClaCoverageChips, orgClaCoverageSummary } from '@lfx-one/shared/utils';
import { MenuItem, MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, distinctUntilChanged, filter, finalize, map, of, skip, switchMap, take, takeUntil, tap } from 'rxjs';

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
import { OrgEasyclaAttestationComponent } from '../org-easycla-sign/org-easycla-attestation.component';
import { OrgEasyclaSignHandoffComponent } from '../org-easycla-sign/org-easycla-sign-handoff.component';

@Component({
  selector: 'lfx-org-easycla-detail',
  imports: [BreadcrumbComponent, ButtonComponent, EmptyStateComponent, MessageComponent, OpenIntercomDirective, SkeletonModule, TagComponent],
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

  /** One hand-off at a time. Also what disables Start while a flow is open. */
  protected readonly signingOpen = signal(false);

  /**
   * The attestation dialog, while it is open. Held so an organization switch can close it.
   * Never holds the hand-off — by then a signing session exists for the organization that was
   * selected when the viewer confirmed.
   */
  private uncommittedSigningDialog: DynamicDialogRef | null = null;

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

  protected readonly notStartedCopy = ORG_CLA_NOT_STARTED_COPY;

  /**
   * Read from the status rather than from `signed` being false, unlike `canDownload` above.
   * Sanctions occupy the same status slot, and a sanctioned agreement carries its own explanatory
   * body in the design — walking that viewer through how to start signing would talk past the
   * reason they cannot.
   */
  protected readonly notStarted = computed(() => this.claGroup()?.status === 'not-started');

  protected readonly notStartedLead = computed(() => this.initNotStartedLead());

  /**
   * The SFID and CLA Group this page already named, so Start can skip the picker.
   *
   * Foundation before covered project, and the order is the whole point. A CLA Group covering
   * several projects is the ordinary case, not an edge one, and the corporate signature is keyed
   * on the SFID sent with it — so taking the first covered project would open the agreement
   * against one project of the several the CLA Group covers. That is not caught downstream
   * either: the sub-project resolves back to this same CLA Group, so the mismatch guard on the
   * response sees the id it asked for and passes.
   *
   * Absent a foundation, only a CLA Group covering a single project is unambiguous. Several
   * covered projects with no foundation SFID is exactly the case search declines to name a
   * project for, and the picker greys those rows out for the same reason.
   */
  protected readonly signingChoice = computed(() => this.signingChoiceFrom(this.claGroup()));

  protected readonly startDisabled = computed(
    () => !this.hasCompany() || this.signingOpen() || this.hasNoOrgAccess() || !this.orgContextLoaded() || !this.signingChoice()
  );

  protected readonly startAriaLabel = computed(() => {
    const label = this.notStartedCopy.startLabel;
    if (this.hasNoOrgAccess()) return `${label} — Organization Lens is not available for your account`;
    if (!this.orgContextLoaded()) return `${label} — checking your organization access`;
    if (!this.hasCompany()) return `${label} — select an organization first`;
    if (this.signingOpen()) return `${label} — a signing request is already open`;
    if (!this.signingChoice()) return `${label} — ${CCLA_SIGN_COPY.picker.multiProjectDisabledReason}`;
    return label;
  });

  protected readonly signedOnLabel = computed(() => this.initSignedOnLabel());

  protected readonly signedByName = computed(() => this.initSignedByName());

  protected readonly breadcrumbItems = computed<MenuItem[]>(() => this.initBreadcrumbItems());

  protected readonly managersBadge = computed(() => String(this.claGroup()?.claManagersCount ?? 0));

  protected readonly approvalBadge = computed(() => this.initApprovalBadge());

  protected readonly tabs = computed(() => this.initTabs());

  public constructor() {
    // Switching organizations does not destroy this component — it re-drives the list fetch — so
    // without this the attestation stays open over a page that has moved on.
    this.selectedOrgUid$.pipe(skip(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.uncommittedSigningDialog?.close());
  }

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

    this.dialogService.open(OrgEasyclaCoverageDialogComponent, orgClaCoverageDialogConfig(group));
  }

  /**
   * Starts the corporate signing flow from this agreement, skipping the picker.
   *
   * The page already named the CLA Group. Asking again would be a second source of truth for
   * which agreement the viewer is looking at, and a chance to hand off a different one.
   */
  protected startClaProcess(): void {
    const orgUid = this.accountContext.selectedAccount()?.uid;
    const chosen = this.signingChoice();
    if (!orgUid || !chosen || this.signingOpen()) return;

    this.signingOpen.set(true);
    this.confirmThenHandOff(orgUid, chosen);
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

  private confirmThenHandOff(orgUid: string, chosen: OrgClaGroupPickerResult): void {
    const attestationRef = this.dialogService.open(OrgEasyclaAttestationComponent, {
      header: CCLA_SIGN_COPY.attestation.header,
      width: '42rem',
      style: { maxWidth: '90vw' },
      modal: true,
      closable: true,
      dismissableMask: true,
    }) as DynamicDialogRef;

    this.uncommittedSigningDialog = attestationRef;

    attestationRef.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((attestations: OrgClaSignAttestations | null | undefined) => {
      this.uncommittedSigningDialog = null;
      if (!attestations) {
        this.signingOpen.set(false);
        return;
      }

      this.afterDialogTornDown(attestationRef, () => this.openHandOff(orgUid, chosen, attestations));
    });
  }

  private afterDialogTornDown(dialogRef: DynamicDialogRef, next: () => void): void {
    dialogRef.onDestroy.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => next());
  }

  private openHandOff(orgUid: string, chosen: OrgClaGroupPickerResult, attestations: OrgClaSignAttestations): void {
    const handoffRef = this.dialogService.open(OrgEasyclaSignHandoffComponent, {
      header: CCLA_SIGN_COPY.preparing.header,
      width: '40rem',
      style: { maxWidth: '90vw' },
      modal: true,
      closable: false,
      closeOnEscape: false,
      dismissableMask: false,
      data: { orgUid, projectSfid: chosen.projectSfid, claGroupId: chosen.claGroupId, attestations },
    }) as DynamicDialogRef;

    handoffRef.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.signingOpen.set(false));
  }

  private signingChoiceFrom(group: OrgClaGroup | undefined): OrgClaGroupPickerResult | null {
    const claGroupId = group?.claGroupId;
    if (!group || !claGroupId) return null;

    if (group.foundationSfid) {
      return { claGroupId, projectSfid: group.foundationSfid, projectName: group.foundationName ?? group.claGroupName };
    }

    const [only] = group.projects;
    if (group.projects.length !== 1 || !only?.projectSfid) return null;

    return { claGroupId, projectSfid: only.projectSfid, projectName: only.projectName };
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

  /**
   * Withheld until both names are known rather than filled with a placeholder. The sentence names
   * the organization being bound and the agreement it would be bound to, so a gap in either is the
   * part that carries the meaning, and "— has not yet signed a CLA for —" states nothing.
   */
  private initNotStartedLead(): string {
    const group = this.claGroup();
    const company = this.companyName();
    return group && company ? this.notStartedCopy.lead(company, group.claGroupName) : '';
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
