// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, Injector, PLATFORM_ID, signal, Signal } from '@angular/core';
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
  ORG_CLA_REVIEW_COPY_FILENAME,
  ORG_CLA_SIGN_SELECTION_STATE,
  ORG_CLA_STATUS_DISPLAY,
  ORG_EASYCLA_PATH,
  ORG_EASYCLA_RETURN_ORG_PARAM,
  ORG_EASYCLA_RETURN_SIGNED_PARAM,
  ORG_EASYCLA_RETURN_SIGNED_VALUE,
  ORG_EASYCLA_SIGNATURE_PARAM,
} from '@lfx-one/shared/constants';
import {
  downloadFromUrl,
  formatClaSignedOnInstant,
  isSameClaGroup,
  orgClaCoverageChips,
  orgClaCoverageSummary,
  orgClaGroupForAddress,
  orgClaPreviewGroup,
  orgClaSignForbiddenToast,
} from '@lfx-one/shared/utils';
import { MenuItem, MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import {
  catchError,
  combineLatest,
  concatMap,
  distinctUntilChanged,
  filter,
  finalize,
  first,
  map,
  merge,
  Observable,
  of,
  skip,
  skipWhile,
  Subject,
  switchMap,
  take,
  takeUntil,
  tap,
  timeout,
  TimeoutError,
  timer,
} from 'rxjs';

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
import { OrgClaReturnService } from '@shared/services/org-cla-return.service';
import { OrgNavigationService } from '@shared/services/org-navigation.service';
import { nameDynamicDialog } from '@shared/utils/name-dynamic-dialog';

import { orgClaCoverageDialogConfig, OrgEasyclaCoverageDialogComponent } from '../org-easycla-coverage-dialog/org-easycla-coverage-dialog.component';
import { OrgEasyclaAttestationComponent } from '../org-easycla-sign/org-easycla-attestation.component';
import { OrgEasyclaSignHandoffComponent } from '../org-easycla-sign/org-easycla-sign-handoff.component';
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
  /**
   * The budget for waiting on a just-signed agreement to appear in the organization's list.
   *
   * EasyCLA writes the signature when DocuSign calls it back, and that callback races the
   * signatory's return trip — so a list that arrives without the row is "not yet", not "no". The
   * budget bounds how long the page is willing to say that: three further attempts, two seconds
   * apart.
   *
   * `perAttemptTimeoutMs` bounds the poll in wall-clock time, not only in count. Without it a
   * stalled BFF can leave each attempt waiting the gateway timeout (`API_GW_TIMEOUT_MS`, 30s), and
   * `concatMap` runs the attempts in series — so three stalled attempts would take about 90s
   * against a doc comment that says "a few seconds". A timed-out attempt is treated the same as a
   * failed one: another try if the budget still has one, otherwise the same exhausted-wait
   * settlement. Sized well below the gateway timeout so one network stall cannot swallow the whole
   * budget.
   */
  private static readonly signedRowRetryDelayMs = 2000;
  private static readonly signedRowRetries = 3;
  private static readonly signedRowPerAttemptTimeoutMs = 3000;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly accountContext = inject(AccountContextService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  private readonly personaService = inject(PersonaService);
  private readonly orgNavigation = inject(OrgNavigationService);
  private readonly claService = inject(OrgLensClaService);
  private readonly claReturn = inject(OrgClaReturnService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  // The signed-row wait is started from an adoption callback, which is outside the construction-time
  // injection context `toObservable` would otherwise take implicitly.
  private readonly injector = inject(Injector);

  protected readonly activeTab = signal<OrgClaDetailTab>('overview');
  protected readonly downloading = signal(false);
  protected readonly reviewCopyDownloading = signal(false);
  protected readonly fetchError = signal(false);
  private readonly claLoadingState = signal(false);

  /**
   * Lists fetched by the flagged wait, fed back into the page's own `claData`.
   *
   * The wait asks the service directly rather than re-driving `orgUid$`, because that stream is
   * keyed on the organization and re-raising it would put the skeleton back over a list the viewer
   * may already be reading. Its answers still have to reach the page — the row it is waiting for is
   * the one the page must then render — so they arrive here instead.
   */
  private readonly retriedList$ = new Subject<OrgClaGroupList | null>();

  /**
   * A signing trip is in flight: this address carries the flag EasyCLA was told to return with.
   *
   * Read once, at construction, from the committed address rather than as a stream. The flag is
   * spent by this visit and removed from the address when the wait settles, and a stream would read
   * that removal as the flag having been withdrawn mid-wait.
   */
  private readonly awaitingSignedRow = signal(this.readReturnFlag());

  /**
   * The organization an open flagged return is about, read straight off the address.
   *
   * Everything about a return has to be keyed on this rather than on whichever organization
   * happens to be selected. Adoption is asynchronous, so for the whole window before it lands the
   * selection is still the one the cookie restored — a different company, whose list is not
   * evidence about the agreement just signed. Read from the name and not from the adoption result
   * precisely because that window opens before there is a result to read.
   *
   * Naming still grants nothing. This value only ever *withholds*: it decides which list the page
   * is allowed to treat as an answer, never which list is fetched or which organization is
   * selected. A crafted name therefore buys a skeleton until the wait settles, which is what the
   * adoption miss already produces.
   *
   * Null for a flagged address that names nobody, which has only the selection to go on.
   */
  private readonly returnOrgUid = this.readReturnOrgUid();

  /** Set once the return is over, so neither settle path can strip the address twice. */
  private returnSettled = false;

  /**
   * The first settled list has come back without the row, so the wait is now visible.
   *
   * Separate from `awaitingSignedRow` because the ordinary fetch is already indistinguishable from
   * a wait on screen — both are the skeleton. The copy is worth showing only once the page knows it
   * is waiting on EasyCLA rather than on its own request, which is exactly the first miss.
   */
  protected readonly confirmingSignature = signal(false);

  /** The copy shown under the skeleton while the just-signed agreement is still being confirmed. */
  protected readonly confirmingSignatureCopy = CCLA_SIGN_COPY.returnWait;

  /** One hand-off at a time. Also what disables Start while a flow is open. */
  protected readonly signingOpen = signal(false);

  /**
   * Pair-level ACS Sign grant for the CLA Group on this page. `null` while unknown; Start stays
   * disabled until `true`.
   */

  /**
   * The attestation dialog, while it is open. Held so an organization switch can close it.
   * Never holds the hand-off — by then a signing session exists for the organization that was
   * selected when the viewer confirmed.
   */
  private uncommittedSigningDialog: DynamicDialogRef | null = null;

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

  /** The CLA Group this page is about. The authoritative half of the address (#2364). */
  private readonly claGroupId: Signal<string> = toSignal(
    this.route.paramMap.pipe(
      map((params) => (params.get('claGroupId') ?? '').trim()),
      distinctUntilChanged()
    ),
    { initialValue: (this.route.snapshot.paramMap.get('claGroupId') ?? '').trim() }
  );

  /**
   * Which agreement within that group, when the group id alone does not say.
   *
   * Narrows; never overrides. A signature naming a row in another group, or one no longer in the
   * list, leaves the group id to decide — see `orgClaGroupForAddress`.
   */
  private readonly signatureId: Signal<string> = toSignal(
    this.route.queryParamMap.pipe(
      map((params) => (params.get(ORG_EASYCLA_SIGNATURE_PARAM) ?? '').trim()),
      distinctUntilChanged()
    ),
    { initialValue: (this.route.snapshot.queryParamMap.get(ORG_EASYCLA_SIGNATURE_PARAM) ?? '').trim() }
  );

  /**
   * The CLA Group the picker chose, when this page was opened as the preview a signatory reads
   * before starting a corporate CLA (#1983). Null on the server, and on an address the choice does
   * not belong to.
   *
   * Carried by the navigation rather than by the address because the address cannot supply the
   * display names: the CLA service exposes no fetch-a-CLA-group-by-id endpoint, so the names would
   * have to ride along in the URL for the heading to render at all. Angular copies the non-router
   * keys of a restored `history.state` onto the navigation it synthesises, so in-app back and
   * forward arrive here with the choice still attached.
   */
  private readonly previewSelection: OrgClaSignSelection | null = this.readPreviewSelection();

  /**
   * Previewing an agreement nobody has signed, so there is no list row to find.
   *
   * Since #2364 the preview shares its address with the agreement view, so this can no longer be
   * decided at construction from the route shape alone — a signed row for the same group outranks
   * a selection. It stays a field for the one thing that *is* fixed for the life of the page (the
   * selection belongs to this address at all); whether the preview is what renders is
   * `showingPreview`, which also weighs the list.
   */
  private readonly hasPreviewSelection = !!this.previewSelection;

  // Every selection the viewer makes, including clearing it.
  private readonly selectedOrgUid$ = toObservable(computed(() => this.accountContext.selectedAccount()?.uid)).pipe(distinctUntilChanged());

  private readonly orgUid$ = this.selectedOrgUid$.pipe(filter((uid): uid is string => !!uid));

  // Emits when what the page is showing changes — the selected organization, or the agreement in
  // the address — skipping the value present at subscribe time. Neither change destroys this
  // component: switching organizations re-drives the list fetch, and Angular reuses the component
  // when the route parameters change. So `takeUntilDestroyed` alone leaves an in-flight download
  // running against a context the viewer has left, and its response would hand them one
  // organization's or agreement's document while the page shows another. Cancelling drops the
  // response and the request with it.
  //
  // Both halves of the address are watched, because either can change which agreement is on
  // screen: the group id moves to a different CLA Group, and the signature moves between two rows
  // within one group. Watching only the group id would leave the download that the *other* signing
  // entity's row started running, and hand over that entity's document.
  //
  // The organization arm is the unfiltered stream, not `orgUid$`: clearing the selection empties
  // the page just as switching does, so it must cancel too, and the non-empty filter would
  // swallow it.
  private readonly contextChanged$ = combineLatest([this.selectedOrgUid$, toObservable(this.claGroupId), toObservable(this.signatureId)]).pipe(skip(1));

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

  // The list is awaited even when a picker selection is in hand (#2364). It has to be: a signed row
  // for this group outranks the selection, and until the list lands the page cannot tell a preview
  // from the agreement that already exists. Rendering the preview first and correcting it would
  // show a signatory "not yet signed" for an agreement their organization holds.
  // The flagged wait is part of loading, not a state beside it. The signatory has come back from
  // signing and their agreement is not listed yet, so settling now would render `cannotPreview` —
  // telling them this page can say nothing about a group they have just signed for. Holding the
  // skeleton is the honest answer until the wait has either found the row or spent its budget.
  //
  // An open wait also outranks a failed request, for the same reason the wait treats a failure as a
  // not-yet and asks again: a retry can still produce the row, and one that does clears the error.
  // Without this the page would contradict its own retries — the signatory reading "we couldn't
  // load your CLAs" for the whole budget over a failure that was never terminal. Once the wait is
  // spent the override goes with it and an error that outlived it renders normally.
  protected readonly claLoading = computed(
    () =>
      this.hasCompany() &&
      (this.claData() === undefined || this.claLoadingState() || !this.claDataIsForSelectedOrg() || this.waitingOnSignedRow()) &&
      (!this.fetchError() || this.waitingOnSignedRow())
  );

  /**
   * The wait is still open and has nothing to show for it yet.
   *
   * Gated on the row being absent as well as the flag being live, so a list that already carries
   * the agreement renders immediately — the wait settles asynchronously and the page should not
   * hold a skeleton over a row it is holding.
   */
  private readonly waitingOnSignedRow = computed(() => this.awaitingSignedRow() && !this.listedGroupForAddress());

  /**
   * Whether the list in hand is the one this visit is entitled to answer from.
   *
   * Ordinarily every list the page holds is the selected organization's, so this is vacuously
   * true. While a flagged return that named an organization is open it is not: the page is still
   * showing the list of whichever organization the cookie restored, and adoption has not yet
   * replaced it.
   */
  private readonly claDataIsForReturnOrg = computed(() => {
    if (!this.awaitingSignedRow() || !this.returnOrgUid) return true;
    const data = this.claData();
    return !data || data.orgUid === this.returnOrgUid;
  });

  /**
   * The agreement this address resolves to, out of the organization's own list.
   *
   * The rule — named signature first, then newest signed, then the list's own order — lives in the
   * shared selector so it is stated once and unit-testable away from this component. Notably it is
   * *not* a `find` on the group id: an organization with two signing entities holds two agreements
   * at one group id, and first match can hand back the other entity's once it signs.
   *
   * Which is also why a list belonging to the wrong organization resolves to nothing rather than
   * being matched and corrected later. One group id carries a row per signing entity, so during a
   * return the restored organization can hold a signed agreement at the very same group — and
   * matching it would put that company's signer, date and document in front of someone who has
   * just signed for a different one. Withholding until adoption lands is the only honest answer,
   * and the wait this keeps open is the state the page is already in.
   */
  private readonly listedGroupForAddress = computed(() =>
    this.claDataIsForReturnOrg() ? orgClaGroupForAddress(this.claData()?.claGroups ?? [], this.claGroupId(), this.signatureId() || undefined) : undefined
  );

  /** The agreement resolved out of the address, or the preview's stand-in for one. */
  protected readonly claGroup: Signal<OrgClaGroup | undefined> = computed(() => this.initClaGroup());

  /**
   * Whether the preview is what this address resolves to: a selection that names this group, and
   * no signed row for it (#2364).
   *
   * The selection alone is not enough. It survives history restoration, so a signatory who signs
   * and comes back to this address still has it — and the agreement they now hold has to win.
   */
  private readonly showingPreview = computed(() => this.hasPreviewSelection && !this.listedGroupForAddress());

  /**
   * A group address that names nothing this organization has signed and nothing the picker chose
   * (#2364). A pasted or bookmarked link, or one whose selection did not survive the trip.
   *
   * Rendered in place rather than redirected to the list, which is the behaviour this issue
   * changes: the group address is the one a named signing overview will claim, so sending it to
   * the list would contradict that. It is also not `notFound` — the group may well exist and be
   * signable; what is absent is anything *this page* can say about it, because the list read
   * returns signed agreements only and there is no fetch-a-group-by-id read to fall back on.
   */
  protected readonly cannotPreview = computed(
    () => this.hasCompany() && !this.claLoading() && !this.fetchError() && !!this.claData() && !!this.claGroupId() && !this.claGroup()
  );

  // Withheld while `cannotPreview` owns the empty state, so one visit cannot render both. An
  // address with no group id at all is the only remaining way to reach this — which the router
  // cannot produce for this child, so it stays a defensive branch rather than a reachable one.
  protected readonly notFound = computed(
    () => this.hasCompany() && !this.claLoading() && !this.fetchError() && !!this.claData() && !this.claGroup() && !this.cannotPreview()
  );

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
   * out of step with the choice the preview was made for. The constructor subscribes to this same
   * signal and redirects on it, but that is asynchronous — the first render can present an enabled Start button
   * against a currently-selected organization that is not the one the choice belongs to. Reading it
   * here (and re-reading it at the action boundary) refuses the click rather than opening the
   * hand-off for the wrong company.
   */
  protected readonly previewOrgMismatch = computed(() => {
    if (!this.showingPreview() || !this.previewSelection) return false;
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

    // The choice was made under the organization the viewer has since left, and Start would open a
    // session against the one they arrived at; nothing here can be re-derived for it either, since
    // the CLA Group named may not be one the new organization can sign. So the page leaves rather
    // than re-render itself under a company the choice was never about.
    //
    // Driven by the mismatch itself rather than by the organization changing, because the two are
    // not the same moment. While a signed row for this group is in hand there is no preview to
    // leave, so a switch away from an organization that held one finds nothing to do — and the
    // mismatch only becomes real later, when the new organization's list arrives without the group
    // and the selection is all that is left to render. The organization has already emitted by
    // then and does not emit again, so a guard reading that stream spends its one chance too early
    // and the stale choice renders under a company it was never made for, over copy that names
    // that company as not having signed.
    //
    // Reading the mismatch also covers the case with no switch to witness at all: the choice
    // survives history restoration and the selected organization is a cookie another tab can
    // change, so back or reload can land here with the wrong company already in force — as the
    // initial value, which a `skip(1)` guard is precisely blind to.
    toObservable(this.previewOrgMismatch)
      .pipe(
        filter((mismatched) => mismatched),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.leaveForList());

    this.followReturnAddress();

    // No redirect for an address that resolves to nothing (#2364). A pasted or bookmarked group
    // address — or one whose picker selection did not survive the trip — stays put and renders
    // `cannotPreview`, because the group address is the one a named signing overview will claim and
    // sending it to the list would contradict that. The organization-mismatch redirect above is a
    // different case and stays: there the page *has* a selection, made for a company the viewer has
    // since left, and re-rendering it under the new one would be wrong rather than merely empty.
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
    // The mismatch redirect is asynchronous, so a click can still arrive during a brief window
    // where the button is enabled against a currently-selected organization the preview was not
    // made for. Refusing here rather than only in the disabled state keeps a race click from
    // opening the hand-off for the wrong company.
    if (this.previewSelection && this.previewSelection.orgUid !== orgUid) return;

    this.signingOpen.set(true);
    this.claService
      .checkPermission(orgUid, 'sign', chosen.projectSfid)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((allowed) => {
        // The hop is async; the selected organization or CLA Group can move before it returns.
        // `contextChanged$` cannot close a dialog that does not exist yet, and an allowed
        // response would otherwise open attestation for the pair the viewer already left.
        const currentUid = this.accountContext.selectedAccount()?.uid;
        const currentChoice = this.signingChoice();
        if (currentUid !== orgUid || currentChoice?.claGroupId !== chosen.claGroupId) {
          this.signingOpen.set(false);
          return;
        }
        if (!allowed) {
          this.signingOpen.set(false);
          this.messageService.add(orgClaSignForbiddenToast());
          return;
        }
        this.confirmThenHandOff(orgUid, chosen);
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

  /**
   * Downloads the watermarked corporate template for this CLA Group (#2317).
   *
   * Keyed on the group id, never `group.id`: the preview builds an agreement with an empty
   * signature id, and the signed-document path is a different artifact.
   */
  protected onReviewCopyDownload(): void {
    const claGroupId = this.claGroup()?.claGroupId || this.claGroupId();
    const orgUid = this.accountContext.selectedAccount()?.uid;
    if (!claGroupId || !orgUid || this.reviewCopyDownloading()) return;

    this.reviewCopyDownloading.set(true);
    this.claService
      .getCclaPreview(orgUid, claGroupId)
      .pipe(
        finalize(() => this.reviewCopyDownloading.set(false)),
        takeUntil(this.contextChanged$),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const groupName = this.claGroup()?.claGroupName;
          downloadFromUrl(url, groupName ? `${groupName}-ccla-review.pdf` : ORG_CLA_REVIEW_COPY_FILENAME);
          setTimeout(() => URL.revokeObjectURL(url), 0);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: 'Download failed',
            detail: 'Could not download a review copy of the CCLA. Please try again.',
          });
        },
      });
  }

  protected onApprovalCountChanged(count: number): void {
    this.approvalCountOverride.set({ signatureId: this.signatureId(), count });
  }

  private confirmThenHandOff(orgUid: string, chosen: OrgClaGroupPickerResult): void {
    const attestationRef = this.dialogService.open(OrgEasyclaAttestationComponent, {
      header: CCLA_SIGN_COPY.attestation.header,
      width: '42rem',
      style: { maxWidth: '90vw' },
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { orgUid, projectSfid: chosen.projectSfid },
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
    this.claService
      .checkPermission(orgUid, 'sign', chosen.projectSfid)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((allowed) => {
        if (!allowed) {
          this.signingOpen.set(false);
          this.messageService.add(orgClaSignForbiddenToast());
          return;
        }
        this.openHandOff(orgUid, chosen, attestations);
      });
  }

  private afterDialogTornDown(dialogRef: DynamicDialogRef, next: () => void): void {
    dialogRef.onDestroy.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => next());
  }

  private openHandOff(orgUid: string, chosen: OrgClaGroupPickerResult, attestations: OrgClaSignAttestations): void {
    const handoffRef = this.dialogService.open(OrgEasyclaSignHandoffComponent, {
      // No PrimeNG header — the dialog body renders its own heading.
      showHeader: false,
      width: '40rem',
      style: { maxWidth: '90vw' },
      // Uniform padding all around — PrimeNG's default content padding zeroes the top
      // (normally supplied by the header we removed), so set it explicitly here.
      contentStyle: { padding: '1.5rem' },
      modal: true,
      closable: false,
      closeOnEscape: false,
      dismissableMask: false,
      data: { orgUid, projectSfid: chosen.projectSfid, claGroupId: chosen.claGroupId, attestations },
    }) as DynamicDialogRef;

    nameDynamicDialog(this.dialogService, handoffRef, OrgEasyclaSignHandoffComponent.headingId);
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
    // A real row outranks a picker selection for the same group. The selection survives history
    // restoration, so a signatory returning to this address after signing still carries it — and
    // telling them the agreement they now hold has not been signed would be false. It also holds
    // for an unsigned row, which carries the organization's own coverage and counts where the
    // selection carries only two names.
    const listed = this.listedGroupForAddress();
    if (listed) return listed;

    // The preview's agreement does not exist yet, so there is no row to find — its shape is built
    // from the picker's choice. Gated on `showingPreview` rather than the selection alone.
    return this.showingPreview() && this.previewSelection ? orgClaPreviewGroup(this.previewSelection) : undefined;
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
    const override = this.approvalCountOverride();
    if (override && override.signatureId === this.signatureId()) return String(override.count);

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
   *
   * Gated on the selection naming *this* address's CLA Group, so a leftover history entry cannot
   * drive the page (#2364).
   *
   * That gate used to be the route shape: the preview lived at its own segment and carried no
   * `signatureId`, so the presence of that parameter was a reliable this-is-an-agreement signal.
   * Both modes now share `/org/easycla/:claGroupId`, so the signal is gone — and it was load-bearing,
   * because the previous route's `history.state` is still what `location.getState()` returns until
   * Angular has written the new entry, so the fallback below would otherwise latch a stale
   * selection under an unrelated group.
   *
   * Comparing the group is at least as strong: a selection for a different group is refused
   * outright, and a selection for *this* group is by definition about the agreement the address
   * names. A signed row for it still wins — see `showingPreview`.
   */
  private readPreviewSelection(): OrgClaSignSelection | null {
    if (!isPlatformBrowser(this.platformId)) return null;

    const state = this.router.getCurrentNavigation()?.extras?.state ?? (this.location.getState() as Record<string, unknown> | null);
    const selection = state?.[ORG_CLA_SIGN_SELECTION_STATE] as OrgClaSignSelection | undefined;
    if (!selection?.claGroupId || !selection.claGroupName || !selection.projectSfid || !selection.projectName || !selection.orgUid) return null;

    // The address decides which group the page is about; the state only names it. A mismatch is a
    // stale entry, whether or not `extras.state` was carried by the in-flight navigation.
    //
    // Canonical, so this gate and the signed-row lookup agree on what "this address is about this
    // group" means. They are two answers to one question, and a raw comparison here would refuse a
    // selection for an address the lookup next door happily resolves.
    const addressed = (this.route.snapshot.paramMap.get('claGroupId') ?? '').trim();
    if (!addressed || !isSameClaGroup(selection.claGroupId, addressed)) return null;

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
    // Requested on every browser visit since #2364, including one carrying a picker selection.
    // The list is what decides between the preview and an agreement that already exists, so
    // skipping it in preview mode would leave that question unanswerable — and would let a stale
    // selection render "not yet signed" over a signed agreement.
    if (!isPlatformBrowser(this.platformId)) {
      return signal<OrgClaGroupList | null | undefined>(undefined);
    }

    // Keyed on the organization alone. The response is the org's whole CLA list and `claGroup`
    // picks this page's row out of it, so neither half of the address may join this stream:
    // Angular reuses the component when only the route parameters change, and driving the fetch
    // from them would raise the skeleton over the full page and re-request a list already in
    // memory to arrive at the same rows.
    const fetched$ = this.orgUid$.pipe(
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
      )
    );

    // The flagged wait's own answers land here too, so the row it finds is the row this page
    // renders — one source of truth for the list rather than a second lookup after the wait ends.
    return toSignal(merge(fetched$, this.retriedList$).pipe(takeUntilDestroyed()));
  }

  /**
   * Whether this address carries the flag EasyCLA was told to return with after a corporate
   * signing.
   *
   * Browser-only: the flag exists to drive a wait and a history rewrite, neither of which the
   * server render does. Pinned to the exact value rather than treated as present-or-absent, so a
   * hand-edited `?signed=maybe` does not open a wait.
   */
  private readReturnFlag(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    return this.route.snapshot.queryParamMap.get(ORG_EASYCLA_RETURN_SIGNED_PARAM) === ORG_EASYCLA_RETURN_SIGNED_VALUE;
  }

  /**
   * The organization named on this address, but only while a return is actually open.
   *
   * Gated on the flag so an ordinary pasted `?org=` — which adopts and is then stripped — cannot
   * make the page withhold a render it should be showing.
   */
  private readReturnOrgUid(): string | null {
    if (!this.readReturnFlag()) return null;
    return this.route.snapshot.queryParamMap.get(ORG_EASYCLA_RETURN_ORG_PARAM);
  }

  /**
   * Adopts the organization named on the return address, then waits for the agreement to be listed.
   *
   * The wait starts from inside the adoption callback rather than beside it, because it is a wait
   * about the *named* organization's list — and that list is not fetched until the organization is
   * selected. Adoption is what selects it. The ordering is load-bearing twice over: started
   * alongside, the wait would be asked about an organization that is not selected yet, and the
   * guard that abandons it when the viewer leaves that organization would fire on the spot,
   * spending the trip before a single list had been asked for.
   *
   * Only the wait is ordered. An address that names an organization without carrying the flag has
   * nothing to sequence, so its clean-up stays where it is — a resolution that never emits would
   * otherwise leave the parameter on the address for the rest of the visit.
   */
  private followReturnAddress(): void {
    // Both halves are browser-only: the selection lives in a cookie the server render cannot set,
    // and the address rewrite at the end is a browser navigation.
    if (!isPlatformBrowser(this.platformId)) return;

    const named = this.route.snapshot.queryParamMap.get(ORG_EASYCLA_RETURN_ORG_PARAM);
    if (!named && !this.awaitingSignedRow()) return;

    // A flagged address with no organization on it: there is nothing to adopt and nothing to order
    // the wait behind, so it runs against the selection already in force.
    if (!named) {
      this.waitForSignedRow();
      return;
    }

    this.claReturn
      .adopt(named)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((match) => {
        // An organization the viewer does not hold is a settled miss, and no list is ever fetched
        // for it — so a wait on one would never end. Closing the wait here is what turns that
        // into an outcome instead of a hang.
        if (!match) {
          this.settleReturn();
          return;
        }

        if (this.awaitingSignedRow()) this.waitForSignedRow();
      });

    if (!this.awaitingSignedRow()) this.settleReturn();
  }

  /**
   * Waits for the just-signed agreement to appear in the organization's own list.
   *
   * The signature id is not carried across the trip and does not need to be: the address names the
   * CLA Group, and a corporate signing is for one group, so the row that appears at this group id
   * for this organization is the one that was just signed. That is what removed the session stash
   * this page's predecessor depended on.
   *
   * The first settled list is not evidence of absence — EasyCLA writes the signature when DocuSign
   * calls it back, and that callback races the return trip. So a first answer without the row opens
   * the visible wait and spends the retry budget; only an exhausted budget is taken as "no".
   *
   * A failed request is an outcome too. The page fetches once per organization, so nothing is
   * coming to replace a failure, and a wait on the list it did not return would never end. It is
   * therefore treated as a not-yet and asked again, same as a list without the row.
   */
  private waitForSignedRow(): void {
    // The organization the whole wait is keyed on. Taken from the address rather than from the
    // selection, so that every part of the wait agrees on one company even if the viewer changes
    // theirs midway. A flagged address that names nobody has only the selection to go on.
    const uid = this.returnOrgUid ?? this.accountContext.selectedAccount()?.uid;
    if (!uid) {
      this.settleReturn();
      return;
    }

    // Leaving that organization ends the trip, wherever it had got to. Built here rather than only
    // inside the retries because the retries' copy is constructed from the uid they have already
    // captured, which leaves the window before the first list settles with no guard at all — and a
    // switch inside that window is precisely what used to let the return migrate to whichever
    // company answered first.
    //
    // `skipWhile` is what makes it safe to key on the address instead of the selection. The stream
    // replays the value it last published, and adoption has only just called `setAccount`, so the
    // first thing a subscriber sees here is still the organization being left. Waiting until the
    // stream has caught up to the adopted one is the difference between a guard and an instant
    // false positive that would end every named return before it asked for a list.
    const movedOff$ = this.selectedOrgUid$.pipe(
      skipWhile((current) => current !== uid),
      filter((current) => current !== uid)
    );
    movedOff$.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.settleReturn());

    const settled$ = toObservable(
      computed(() => ({
        data: this.claData(),
        fetching: this.claLoadingState(),
        failed: this.fetchError(),
      })),
      { injector: this.injector }
      // The list has to be that organization's, not merely the selected one's. Those are the same
      // thing right up until they are not, and the moment they diverge is the moment this matters.
    ).pipe(filter(({ data, fetching, failed }) => failed || (data?.orgUid === uid && !fetching)));

    settled$.pipe(takeUntil(movedOff$), take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      // Nothing may be decided on a list that arrives after the trip is already over — acting on it
      // would flash the confirming line and spend a retry budget on a company nobody asked about.
      // The uid binding above and `movedOff$` are what close that window; this is the cheap check
      // that it stays closed if another settle path is ever added.
      if (!this.awaitingSignedRow()) return;

      if (this.listedGroupForAddress()) {
        this.settleReturn();
        return;
      }

      this.confirmingSignature.set(true);
      this.retryForSignedRow(uid, movedOff$);
    });
  }

  /**
   * Asks again for the list, a bounded number of times, while the signed row is not in it.
   *
   * Asked of the service directly rather than by re-driving the page's own fetch, which is keyed on
   * the organization and would re-raise the skeleton over a list the viewer is already reading.
   * Answers are fed back through `retriedList$` so the page renders what the wait found.
   *
   * Given up on the moment the viewer selects a different organization. This component survives
   * that switch, so an answer arriving afterwards would render an agreement belonging to the
   * company they deliberately left. Giving up still spends the trip, so the address is cleaned up
   * rather than left to reopen the wait on reload.
   *
   * `uid` and `movedOff$` are both handed down rather than rebuilt here: reading the selection
   * again would ask the same question at a later moment and can get a different answer, which is
   * the whole family of bug this keying exists to end.
   */
  private retryForSignedRow(uid: string, movedOff$: Observable<string | null | undefined>): void {
    timer(OrgEasyclaDetailComponent.signedRowRetryDelayMs, OrgEasyclaDetailComponent.signedRowRetryDelayMs)
      .pipe(
        take(OrgEasyclaDetailComponent.signedRowRetries),
        concatMap(() =>
          this.claService.getClaGroups(uid).pipe(
            // Bounds each attempt in wall-clock time, so a stalled BFF cannot spend the gateway
            // timeout per attempt. A timeout is another failed attempt: a not-yet, not a hard error.
            timeout({ each: OrgEasyclaDetailComponent.signedRowPerAttemptTimeoutMs }),
            catchError((error: unknown) => {
              // One line per failed attempt, so triage of a wait that gave up can tell a run of
              // failures from a list that genuinely never carried the row.
              if (error instanceof TimeoutError) console.warn('Waiting for the signed agreement timed out:', error);
              else console.warn('Waiting for the signed agreement failed:', error);
              return of(null);
            })
          )
        ),
        // A successful attempt is an answer about the list whether or not it carries the row, and
        // it is the one the page will show once the wait is spent. Without this, an initial failure
        // followed by a recovery would leave the error state up over a list now in hand.
        tap((list) => {
          if (!list) return;
          this.retriedList$.next(list);
          this.fetchError.set(false);
        }),
        map(() => this.listedGroupForAddress()),
        takeUntil(movedOff$),
        first((found) => !!found, undefined),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.settleReturn());
  }

  /**
   * Ends the wait and takes the return parameters back off the address.
   *
   * Whichever way it ended. A found row needs no flag, and an exhausted wait must not keep one:
   * left in place it would reopen the wait on every reload of a bookmarked or copied link, and
   * `?org=` would pin a stale organization that contradicts the viewer the moment they switch.
   *
   * `replaceUrl` because the address being left behind is the return address, and a history entry
   * for it is one Back re-enters — spending the wait again and stripping the parameters all over.
   *
   * Once the flag is gone the page settles through its ordinary discriminator: the row if the wait
   * found one, otherwise `cannotPreview` on this group's own address. It stays here rather than
   * redirecting to the list, because this address is the one the agreement will have once EasyCLA
   * catches up, and a reload is then all it takes.
   */
  private settleReturn(): void {
    // Once only. A switch away from the named organization and the wait's own answer can both land
    // — the switch tears the retries down, and they complete rather than being cancelled — so the
    // trip now has two ends and the second must not rewrite an address the first already cleaned.
    if (this.returnSettled) return;
    this.returnSettled = true;

    this.awaitingSignedRow.set(false);
    this.confirmingSignature.set(false);

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [ORG_EASYCLA_RETURN_ORG_PARAM]: null, [ORG_EASYCLA_RETURN_SIGNED_PARAM]: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
