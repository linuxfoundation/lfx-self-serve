// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import type {
  OrgClaCoverageChip,
  OrgClaDetailTab,
  OrgClaDetailTabView,
  OrgClaGroup,
  OrgClaGroupList,
  OrgClaGroupPickerResult,
  OrgClaSignAttestations,
  OrgClaSignSelection,
  OrgClaStatusDisplay,
} from '@lfx-one/shared/interfaces';
import {
  CCLA_SIGN_COPY,
  ORG_CLA_DETAIL_TABS,
  ORG_CLA_HEADING_STATUS,
  ORG_CLA_LOCKED_TAB_COPY,
  ORG_CLA_NOT_STARTED_COPY,
  ORG_CLA_SIGN_SELECTION_STATE,
  ORG_CLA_STATUS_DISPLAY,
  ORG_EASYCLA_PATH,
} from '@lfx-one/shared/constants';
import { downloadFromUrl, formatClaSignedOnInstant, orgClaCoverageChips, orgClaCoverageSummary, orgClaPreviewGroup } from '@lfx-one/shared/utils';
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
  private readonly router = inject(Router);
  private readonly location = inject(Location);
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

  /**
   * The CLA Group the picker chose, when this page was opened as the preview a signatory reads
   * before starting a corporate CLA (#1983). Null on an ordinary agreement route, and on the server.
   *
   * Carried by the navigation rather than by the address because an address holds nothing that
   * could be resolved: the CLA service exposes no fetch-a-CLA-group-by-id endpoint, so ids in the
   * URL could not be turned back into the agreement this page has to name, and the names would
   * have to ride along in the URL for the heading to render at all. Angular copies the non-router
   * keys of a restored `history.state` onto the navigation it synthesises, so in-app back and
   * forward arrive here with the choice still attached.
   */
  private readonly previewSelection: OrgClaSignSelection | null = this.readPreviewSelection();

  /** Previewing an agreement nobody has signed, so there is no list row to find and none is fetched. */
  private readonly previewing = !!this.previewSelection;

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

  // `previewing` first: no list is requested in that mode, so `claData()` stays undefined for the
  // life of the page and every other term here would hold the skeleton over a page that has
  // everything it needs.
  protected readonly claLoading = computed(
    () =>
      !this.previewing && this.hasCompany() && (this.claData() === undefined || this.claLoadingState() || !this.claDataIsForSelectedOrg()) && !this.fetchError()
  );

  protected readonly claGroup: Signal<OrgClaGroup | undefined> = computed(() => this.initClaGroup());

  protected readonly notFound = computed(() => this.hasCompany() && !this.claLoading() && !this.fetchError() && !!this.claData() && !this.claGroup());

  protected readonly status = computed(() => this.initStatus());

  protected readonly coverageChips = computed(() => this.initCoverageChips());

  protected readonly cclaHeading = computed(() => this.initCclaHeading());

  protected readonly coverageHint = computed(() => this.initCoverageHint());

  // Read from `signed` rather than the status, because this component serves two sources and only
  // the flag answers both: the preview builds an agreement nobody has signed, and `status` there
  // is `not-started` while on a sanctioned list row it says nothing about whether a document
  // exists. Offering the download on an agreement without one is a control that can only fail.
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

  /**
   * The preview mode restores from history / cookie change, so the selected organization can arrive
   * out of step with the choice the preview was made for. The `orgUid$` subscription redirects on
   * that mismatch, but it is asynchronous — the first render can present an enabled Start button
   * against a currently-selected organization that is not the one the choice belongs to. Reading it
   * here (and re-reading it at the action boundary) refuses the click rather than opening the
   * hand-off for the wrong company.
   */
  protected readonly previewOrgMismatch = computed(() => {
    if (!this.previewing || !this.previewSelection) return false;
    const uid = this.accountContext.selectedAccount()?.uid;
    return !!uid && this.previewSelection.orgUid !== uid;
  });

  protected readonly startDisabled = computed(
    () => !this.hasCompany() || this.signingOpen() || this.hasNoOrgAccess() || !this.orgContextLoaded() || !this.signingChoice() || this.previewOrgMismatch()
  );

  protected readonly startAriaLabel = computed(() => {
    const label = this.notStartedCopy.startLabel;
    if (this.hasNoOrgAccess()) return `${label} — Organization Lens is not available for your account`;
    if (!this.orgContextLoaded()) return `${label} — checking your organization access`;
    if (!this.hasCompany()) return `${label} — select an organization first`;
    if (this.signingOpen()) return `${label} — a signing request is already open`;
    if (this.previewOrgMismatch()) return `${label} — this preview was made for a different organization`;
    if (!this.signingChoice()) return `${label} — ${CCLA_SIGN_COPY.picker.multiProjectDisabledReason}`;
    return label;
  });

  protected readonly signedOnLabel = computed(() => this.initSignedOnLabel());

  protected readonly signedByName = computed(() => this.initSignedByName());

  protected readonly breadcrumbItems = computed<MenuItem[]>(() => this.initBreadcrumbItems());

  protected readonly managersBadge = computed(() => String(this.claGroup()?.claManagersCount ?? 0));

  protected readonly approvalBadge = computed(() => this.initApprovalBadge());

  protected readonly tabs = computed(() => this.initTabs());

  protected readonly lockedTab = computed(() => this.initLockedTab());

  public constructor() {
    // Either arm of the context, because neither destroys this component: an organization switch
    // re-drives the list fetch, and Angular reuses the component when `:signatureId` changes. So
    // without this the attestation stays open over a page that has moved on, and confirming it
    // would open a session for the agreement the viewer left rather than the one on screen.
    this.contextChanged$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.uncommittedSigningDialog?.close());

    // The organization alone, because only it invalidates the preview. The choice was made under
    // the organization the viewer has just left, and Start would open a session against the one
    // they arrived at; nothing here can be re-derived for it either, since the CLA Group named may
    // not be one the new organization can sign. So the page leaves rather than re-render itself
    // under a company the choice was never about.
    //
    // Compared against the choice's own organization rather than skipping the first value, because
    // the mismatch is not always a switch this page witnesses. The choice survives history
    // restoration and the selected organization is a cookie another tab can change, so back or
    // reload can land here with the wrong company already in force — as the initial value, which a
    // `skip(1)` guard is precisely blind to.
    this.orgUid$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((uid) => {
      if (this.previewing && this.previewSelection?.orgUid !== uid) this.leaveForList();
    });

    // A pasted or bookmarked preview address, or one whose selection did not survive the trip.
    // Nothing can be rehydrated — see `previewSelection` — and the list is where the picker lives,
    // so this is a redirect rather than an empty state offering to start again.
    if (isPlatformBrowser(this.platformId) && !this.previewing && !this.signatureId()) this.leaveForList();
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
    // The `orgUid$` redirect is asynchronous, so a click can still arrive during a brief window
    // where the button is enabled against a currently-selected organization the preview was not
    // made for. Refusing here rather than only in the disabled state keeps a race click from
    // opening the hand-off for the wrong company.
    if (this.previewSelection && this.previewSelection.orgUid !== orgUid) return;

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

    this.whenSigningDialogEnds(attestationRef, (attestations: OrgClaSignAttestations) => {
      // Wait for `onDestroy`, not `onClose`, because opening a second dialog while the first is
      // still tearing down leaves PrimeNG's overlay stack half-mounted — the new dialog opens
      // behind the modal mask of the old one, focus never lands on it, and Escape closes the
      // wrong one. `onDestroy` fires after the leave animation and after the ref is disposed.
      //
      // The wait is what lets the organization or the CLA Group change underneath the callback.
      // The attestation names neither — its payload is just the ticked boxes — so opening the
      // hand-off with the captured values would sign a *different* company's CCLA, or a different
      // agreement for the same company, than the one the viewer confirmed. Re-check both against
      // the live signals immediately before opening, and release the Start lock on a mismatch so
      // a subsequent click can start over cleanly.
      this.afterDialogTornDown(attestationRef, () => this.openHandOffIfContextHeld(orgUid, chosen, attestations));
    });
  }

  private openHandOffIfContextHeld(orgUid: string, chosen: OrgClaGroupPickerResult, attestations: OrgClaSignAttestations): void {
    const currentUid = this.accountContext.selectedAccount()?.uid;
    const currentChoice = this.signingChoice();
    if (currentUid !== orgUid || currentChoice?.claGroupId !== chosen.claGroupId) {
      this.signingOpen.set(false);
      return;
    }
    this.openHandOff(orgUid, chosen, attestations);
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

    this.whenSigningDialogEnds(handoffRef);
  }

  /**
   * Releases Start when a dialog ends, unless `onAdvance` is taking the lock to the next step.
   *
   * PrimeNG's header close and Escape go through `p-dialog` `onHide` → `DynamicDialogRef.destroy()`.
   * That never emits `onClose`. A listener that only watches `onClose` therefore leaves
   * `signingOpen` true after those dismissals, and the control stays disabled until reload.
   */
  private whenSigningDialogEnds<T>(dialogRef: DynamicDialogRef, onAdvance?: (value: T) => void): void {
    let handedOff = false;

    dialogRef.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value: T | null | undefined) => {
      if (this.uncommittedSigningDialog === dialogRef) this.uncommittedSigningDialog = null;
      if (value && onAdvance) {
        handedOff = true;
        onAdvance(value);
        return;
      }
      this.signingOpen.set(false);
    });

    dialogRef.onDestroy.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (!handedOff) this.signingOpen.set(false);
    });
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
    // The preview's agreement does not exist yet, so there is no row keyed by signature id to find.
    if (this.previewSelection) return orgClaPreviewGroup(this.previewSelection);

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

  /**
   * Why the open tab holds nothing, when signing is what would fill it. Null on every other tab
   * and on a signed agreement, where the panel is simply unbuilt.
   *
   * Read from `signed` rather than the status, as `canDownload` is and for the same reason:
   * sanctions occupy the single status slot, so a `sanctioned` agreement may be signed — and its
   * CLA Managers are real people who would be told they do not exist yet.
   */
  private initLockedTab(): { title: string; subtitle: string } | null {
    const group = this.claGroup();
    if (!group || group.signed) return null;
    return ORG_CLA_LOCKED_TAB_COPY[this.activeTab()] ?? null;
  }

  private tabBadge(tab: OrgClaDetailTab): string {
    if (tab === 'managers') return this.managersBadge();
    if (tab === 'approval') return this.approvalBadge();
    return '';
  }

  /**
   * The picker's choice, validated, or null when this is not the preview route.
   *
   * Validated rather than trusted: the value comes back out of a history entry, so it can be a
   * shape written by an earlier deployment or one truncated on the way. Left unchecked, a partial
   * selection would head the page with an undefined name — and it would still offer Start, because
   * a missing project SFID only disables signing once something reads it.
   *
   * Read from the history entry as well as from the navigation that is carrying it. Only the
   * in-flight navigation exposes `extras.state`, and there is no in-flight navigation on a reload
   * or a restore — the entry itself survives both, so reading only the former would abandon a
   * choice the browser still holds and send the signatory back to the list for pressing refresh.
   */
  private readPreviewSelection(): OrgClaSignSelection | null {
    if (!isPlatformBrowser(this.platformId)) return null;

    const state = this.router.getCurrentNavigation()?.extras?.state ?? (this.location.getState() as Record<string, unknown> | null);
    const selection = state?.[ORG_CLA_SIGN_SELECTION_STATE] as OrgClaSignSelection | undefined;
    if (!selection?.claGroupId || !selection.claGroupName || !selection.projectSfid || !selection.projectName || !selection.orgUid) return null;

    return selection;
  }

  /**
   * Leaves the preview for the list, replacing the address rather than pushing over it.
   *
   * Replacing is what actually closes the page: the choice lives in the history entry, so an entry
   * left behind is one Back re-renders — under whichever organization is selected by then, which on
   * the organization-switch path is precisely the wrong one.
   */
  private leaveForList(): void {
    void this.router.navigate([ORG_EASYCLA_PATH], { replaceUrl: true });
  }

  private initClaData(): Signal<OrgClaGroupList | null | undefined> {
    // Not requested while previewing: `claGroup` comes from the selection, so the response would be
    // fetched and never read. That absence is also what keeps `notFound` and `fetchError` off this
    // page — neither can be reached without a list in hand — and `notFound` firing over a preview
    // would tell a signatory the agreement they are about to sign does not exist.
    if (this.previewing || !isPlatformBrowser(this.platformId)) {
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
