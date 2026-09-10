// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  CCLA_SIGN_COPY,
  ORG_CLA_SIGN_SELECTION_STATE,
  ORG_EASYCLA_NEW_SEGMENT,
  ORG_EASYCLA_PATH,
  ORG_EASYCLA_RETURN_ORG_PARAM,
} from '@lfx-one/shared/constants';
import type { Account, OrgClaGroup, OrgClaGroupList, OrgClaSignSelection } from '@lfx-one/shared/interfaces';
import { orgClaOpenLabel } from '@lfx-one/shared/utils';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, concatMap, distinctUntilChanged, filter, first, map, of, skip, switchMap, take, tap, timer } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonaService } from '@services/persona.service';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { OrgNavigationService } from '@shared/services/org-navigation.service';
import { takeStashedSignedSignatureId } from '@shared/utils/org-cla-signed-signature.util';

import { OrgEasyclaCardComponent } from './org-easycla-card/org-easycla-card.component';
import { orgClaCoverageDialogConfig, OrgEasyclaCoverageDialogComponent } from './org-easycla-coverage-dialog/org-easycla-coverage-dialog.component';
import { OrgEasyclaGroupSelectComponent } from './org-easycla-sign/org-easycla-group-select.component';

@Component({
  selector: 'lfx-org-easycla',
  imports: [ButtonComponent, EmptyStateComponent, InputTextComponent, OpenIntercomDirective, OrgEasyclaCardComponent, RouterLink, SkeletonModule],
  providers: [DialogService],
  templateUrl: './org-easycla.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaComponent {
  /** Matches the approved design's page size. */
  private static readonly pageSize = 8;

  /**
   * How long the return leg keeps asking for the agreement that was just signed.
   *
   * EasyCLA writes the signature when DocuSign calls it back, and that callback races the
   * signatory's own return trip — so the first list can legitimately not have the row yet. Bounded
   * rather than open-ended: past a few seconds the likelier explanations are ones no amount of
   * waiting fixes, and the list is a reasonable place to be left.
   */
  private static readonly signedAgreementRetryDelayMs = 2000;
  private static readonly signedAgreementRetries = 3;

  private readonly accountContext = inject(AccountContextService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  private readonly personaService = inject(PersonaService);
  private readonly orgNavigation = inject(OrgNavigationService);
  private readonly claService = inject(OrgLensClaService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** One hand-off at a time. Also what disables the Sign CLA control while a flow is open. */
  protected readonly signingOpen = signal(false);

  /**
   * The CLA Group picker, while it is open. Held so an organization switch can close it; see
   * `abandonOpenPicker`.
   *
   * The only signing dialog this page owns. The steps that follow — the attestation and the
   * hand-off — belong to the preview page the picker navigates to, which names the agreement they
   * are about.
   */
  private openPickerDialog: DynamicDialogRef | null = null;

  /**
   * Whether this page load is a return from a signing ceremony that intends to land on an
   * agreement, which makes the return organization on the address `landOnSignedAgreement`'s to
   * remove rather than `adoptOrganizationFromReturnAddress`'s.
   *
   * Both flows start in the constructor and both navigate, and Angular cancels an in-flight
   * navigation when another begins — so unarbitrated they take turns cancelling each other and the
   * signatory stays on the list. The committed address cannot arbitrate them, being still the return
   * address at the moment either decides; this is set synchronously instead, before anything is
   * awaited, so it reads true no matter which of them resolves first.
   */
  private returnLandingPending = false;

  // ── Search (client-side; the upstream list takes no search parameter) ──────
  protected readonly orgClaOpenLabel = orgClaOpenLabel;

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
   * Names the reason when Sign CLA is disabled, so a screen reader hears one instead of a bare
   * "disabled". Computed rather than a template ternary — the control has three distinct reasons.
   *
   * No-access is checked first: it is the one reason the viewer can do nothing about, and it also
   * subsumes the others, since a viewer without access has no organization to select either.
   */
  protected readonly signClaAriaLabel = computed(() => {
    if (this.hasNoOrgAccess()) return 'Sign a corporate CLA — Organization Lens is not available for your account';
    // Every reason the control is disabled needs a branch here, or assistive technology announces
    // "disabled" with no explanation. Loading sits above the company check because it is why the
    // company is not known yet.
    if (!this.orgContextLoaded()) return 'Sign a corporate CLA — checking your organization access';
    if (!this.hasCompany()) return 'Sign a corporate CLA — select an organization first';
    if (this.signingOpen()) return 'Sign a corporate CLA — a signing request is already open';
    if (this.fetchError()) return 'Sign a corporate CLA — this organization’s agreements could not be loaded';
    if (!this.claListReady()) return 'Sign a corporate CLA — loading the agreements this organization already holds';
    return 'Sign a corporate CLA';
  });

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

  // Every selection the viewer makes, including clearing it.
  private readonly selectedOrgUid$ = toObservable(computed(() => this.accountContext.selectedAccount()?.uid)).pipe(distinctUntilChanged());

  // Shared with the constructor's org-switch reset below — mirrors org-groups' orgUid$.
  private readonly orgUid$ = this.selectedOrgUid$.pipe(filter((uid): uid is string => !!uid));

  /**
   * Emits when the viewer leaves the organization a signing flow was started for, skipping the
   * value present at subscribe time.
   *
   * Derived from the unfiltered stream, not `orgUid$`, for the reason the CLA Group detail page
   * found on its download stream: clearing the selection empties the page just as switching does,
   * and the non-empty filter would swallow it — leaving exactly the stale thing the stream exists
   * to cancel. Here that stale thing is a signing flow still pointed at the previous company.
   */
  private readonly orgChanged$ = this.selectedOrgUid$.pipe(skip(1));

  private readonly claData: Signal<OrgClaGroupList | null | undefined> = this.initClaData();

  /**
   * True while the response in hand does not belong to the organization named in the header.
   *
   * The server echoes the `orgUid` it served precisely so the client can key on it. Timing alone
   * does not hold the invariant: `companyName()` reacts to `selectedAccount` immediately, while
   * `orgUid$` re-emits only when `toObservable`'s effect flushes — after the template pass — so
   * `claLoadingState` is still false for one cycle after a switch. Comparing identity closes that
   * window regardless of when the flush lands.
   */
  private readonly claDataIsForSelectedOrg = computed(() => {
    const data = this.claData();
    return !data || data.orgUid === this.accountContext.selectedAccount()?.uid;
  });

  /**
   * Undefined until the first response lands; `null` after a failure, which is a different state.
   * The explicit flag covers the switch: `toSignal` holds the previous organization's response
   * until the new one arrives, so `=== undefined` alone would let that organization's cards — or
   * its "signed nothing" empty state — render under the newly selected company's name.
   *
   * The mismatch is folded in here rather than emptying `claGroups()`, because an empty list on a
   * settled page is not a neutral value — it is the "hasn't signed any CLAs yet" claim. Holding the
   * loading state instead shows a skeleton, which asserts nothing.
   */
  protected readonly claLoading = computed(
    () => this.hasCompany() && (this.claData() === undefined || this.claLoadingState() || !this.claDataIsForSelectedOrg()) && !this.fetchError()
  );

  /**
   * True once the selected organization's own list is in hand, which is what Sign CLA waits for.
   *
   * The picker is given `claGroups()` so it can grey out the agreements the organization already
   * holds. Until the list lands that is `[]` — indistinguishable from holding nothing — so a picker
   * opened early offers a held agreement as choosable, and choosing it creates a second envelope
   * against an agreement already signed. A failed load is the same case with no recovery: there is
   * no list to check against, so the control waits rather than checking against nothing.
   */
  protected readonly claListReady = computed(() => !!this.claData() && this.claDataIsForSelectedOrg() && !this.claLoadingState() && !this.fetchError());

  protected readonly claGroups: Signal<OrgClaGroup[]> = computed(() => this.claData()?.claGroups ?? []);
  protected readonly filteredClaGroups: Signal<OrgClaGroup[]> = this.initFilteredClaGroups();

  // ── Paging (client-side; the upstream list is unpaged) ────────────────────
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.filteredClaGroups().length / OrgEasyclaComponent.pageSize)));

  /**
   * Clamped rather than read raw, so a narrowing that shrinks the result set below the current
   * page cannot strand the viewer on a page that no longer exists. The reset in the constructor
   * handles the common case; this covers the rest without a second writer.
   */
  protected readonly currentPage = computed(() => Math.min(this.page(), this.pageCount() - 1));
  protected readonly pagedClaGroups: Signal<OrgClaGroup[]> = this.initPagedClaGroups();
  protected readonly showPager = computed(() => this.filteredClaGroups().length > OrgEasyclaComponent.pageSize);
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
   * The toolbar holds the search box and nothing else — the Sign CLA button lives in the header and
   * renders unconditionally, so it is not what keeps this visible.
   *
   * It does not collapse with the list: a viewer whose search matched nothing needs the box to
   * revise it. It is withheld on the failure state, where `claGroups()` is empty and
   * `showNoMatchesEmptyState` cannot fire, so typing would filter nothing and change nothing — a
   * field that looks interactive and is inert reads as a second, unexplained fault.
   */
  protected readonly showToolbar = computed(() => this.settled());

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

    // Separate from the reset above because it listens on the unfiltered stream: a cleared
    // selection has no list to re-filter but does have a signing flow to abandon.
    this.orgChanged$.pipe(takeUntilDestroyed()).subscribe(() => this.abandonOpenPicker());

    this.adoptOrganizationFromReturnAddress();
    this.landOnSignedAgreement();
  }

  protected changePage(delta: number): void {
    this.page.set(Math.min(Math.max(this.currentPage() + delta, 0), this.pageCount() - 1));
  }

  /**
   * Shows what one row covers, without leaving the list.
   *
   * The row is handed back by the card rather than looked up by id: the card was rendered from this
   * page's own filtered-and-paged slice, so re-finding it here would be a second source of truth
   * for which agreement the viewer just pointed at.
   */
  protected openCoverage(claGroup: OrgClaGroup): void {
    this.dialogService.open(OrgEasyclaCoverageDialogComponent, orgClaCoverageDialogConfig(claGroup));
  }

  /**
   * Starts the corporate signing flow (#1983): pick a CLA Group, then hand that choice to the
   * preview page, where the signatory reads what they are about to sign.
   *
   * This page stops at the picker. The attestation and the hand-off follow on the preview page,
   * which is the arrangement the M3 prototype draws and also the one that puts the two legally
   * operative steps — the confirmations, and the request that opens a real envelope — on a page
   * that names the agreement they apply to rather than in a dialog stack over a list.
   */
  protected startSigning(): void {
    const orgUid = this.accountContext.selectedAccount()?.uid;
    // Single-flight: the control is disabled while a flow is open, and this is the second line.
    if (!orgUid || this.signingOpen()) return;

    this.signingOpen.set(true);

    // The agreements this organization already holds, so the picker can refuse a CLA Group it has
    // one for. Handed down rather than fetched: this page has the list, and a second request would
    // be a second answer to the same question.
    //
    // Keyed on the `orgUid` the server echoed, not on the response merely being present. A response
    // that belongs to the organization the viewer just left would refuse rows this organization has
    // never signed, and an empty list is the safe reading of "not known yet".
    const claData = this.claData();
    const claGroups = claData?.orgUid === orgUid ? claData.claGroups : [];

    const pickerRef = this.dialogService.open(OrgEasyclaGroupSelectComponent, {
      header: CCLA_SIGN_COPY.picker.header,
      width: '40rem',
      // The Aura dialog preset caps nothing, so a fixed width alone runs off a 360-390px phone,
      // taking the controls at its edges with it. Same cap the sibling coverage dialog documents.
      style: { maxWidth: '90vw' },
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { orgUid, claGroups },
    }) as DynamicDialogRef;

    this.openPickerDialog = pickerRef;

    this.whenSigningDialogEnds(pickerRef, (chosen: OrgClaSignSelection) => {
      // The choice comes from `onClose`, which carries it; the navigation waits for teardown.
      // `signingOpen` stays true across that gap, so the control cannot start a second flow in it.
      this.afterDialogTornDown(pickerRef, () => this.openPreview(chosen));
    });
  }

  /**
   * Closes the CLA Group picker on an organization switch.
   *
   * The picker is opened for one organization — `orgUid` is read once when the flow starts and
   * handed to it as dialog data — and switching organizations does not destroy this component; it
   * re-drives the list fetch. So without this the picker stays open over a page that has moved on,
   * still listing the previous organization's CLA Groups, and choosing one would carry that company
   * into a signing session. This is the download path's stale-response failure on the detail page,
   * arriving at a legal agreement instead of a PDF.
   *
   * The steps that can actually create something are past the navigation and are not this page's to
   * close: the preview page leaves for the list on a switch of its own accord, and the hand-off is
   * deliberately left standing once a session exists behind it.
   */
  private abandonOpenPicker(): void {
    this.openPickerDialog?.close();
  }

  /**
   * Hands the chosen CLA Group to the preview page.
   *
   * The choice travels in the navigation's state rather than the address. The CLA service exposes
   * no fetch-a-CLA-group-by-id endpoint, so ids in a URL could not be resolved back into the
   * agreement the preview has to name — the display names would have to ride along in the URL too,
   * leaving that page to render its heading from text taken out of the address.
   */
  private openPreview(selection: OrgClaSignSelection): void {
    void this.router
      .navigate([ORG_EASYCLA_PATH, ORG_EASYCLA_NEW_SEGMENT], { state: { [ORG_CLA_SIGN_SELECTION_STATE]: selection } })
      // Released at the navigation rather than at the dialog's close, so the control stays disabled
      // across the teardown gap and a navigation that never lands — refused by a guard, or
      // superseded by another — cannot leave Sign CLA disabled until a reload. On the ordinary path
      // this page is already gone by the time this runs.
      .finally(() => this.signingOpen.set(false));
  }

  /**
   * Runs `next` once a dialog is not merely closed but torn down.
   *
   * `DynamicDialogRef.close()` emits `onClose` synchronously and starts the leave animation from
   * that same emission, and the end of that animation is what drops `p-overflow-hidden` from the
   * body. A dialog opened from inside `onClose` therefore has its own scroll lock stripped a
   * moment after it appears, and the page scrolls behind it. `onDestroy` fires after that
   * teardown, which is the boundary a follow-on step has to wait for.
   *
   * The Me-lens hand-off found this first (#2066) and carries the same helper. This chain opens
   * two dialogs from inside a close, so it had the defect twice.
   */
  private afterDialogTornDown(dialogRef: DynamicDialogRef, next: () => void): void {
    dialogRef.onDestroy.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => next());
  }

  /**
   * Releases Sign CLA when a dialog ends, unless `onAdvance` is taking the lock to the next step.
   *
   * PrimeNG's header close and Escape go through `p-dialog` `onHide` → `DynamicDialogRef.destroy()`.
   * That never emits `onClose`. A listener that only watches `onClose` therefore leaves
   * `signingOpen` true after those dismissals, and the control stays disabled until reload.
   */
  private whenSigningDialogEnds<T>(dialogRef: DynamicDialogRef, onAdvance?: (value: T) => void): void {
    let handedOff = false;

    dialogRef.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value: T | null | undefined) => {
      if (this.openPickerDialog === dialogRef) this.openPickerDialog = null;
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

  /**
   * Selects the organization EasyCLA named on the return address after a corporate signing.
   *
   * The signatory comes back through a cross-site navigation, and which organization is selected
   * survives that only in a `SameSite=Lax` cookie. When it does not come back, bootstrap falls to
   * the first organization in the viewer's list — so signing for one company returns them looking
   * at another, with their new agreement nowhere in sight. The return address names the
   * organization the session was opened for so this page does not have to guess.
   *
   * **The parameter names an organization; it does not grant one.** It is resolved against the
   * viewer's own authorized accounts and anything absent from that list is ignored, so a crafted
   * link cannot select a company they do not hold. Deliberately no stub is built from the value —
   * that is how the cookie path hydrates an id it trusts, and doing it here would render an
   * arbitrary organization's name from the URL.
   */
  private adoptOrganizationFromReturnAddress(): void {
    // The address is only followed in a browser, and the strip below is a browser navigation.
    if (!isPlatformBrowser(this.platformId)) return;

    const named = this.route.snapshot.queryParamMap.get(ORG_EASYCLA_RETURN_ORG_PARAM);
    if (!named) return;

    // The authorized list arrives after this component is constructed, so resolving immediately
    // would discard a legitimate hand-off against an empty list. Waits for whichever comes first:
    // the organization appearing, or the org context settling without it.
    combineLatest([toObservable(this.accountContext.availableAccounts), toObservable(this.orgContextLoaded)])
      .pipe(
        map(([accounts, loaded]) => ({ match: accounts.find((account: Account) => account.uid === named) ?? null, loaded })),
        filter(({ match, loaded }) => !!match || loaded),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ match }) => {
        // `setAccount` also rewrites the cookie, so the round trip repairs the selection that went
        // missing rather than leaving the next reload to fall back all over again.
        //
        // Selecting it is not enough to keep it. The org selector bootstraps its catalogue with
        // whichever organization was current at the time, which on a cold return is still the stale
        // cookie — so the first page comes back pinned to that one. When it lands, the pending
        // default selection asks whether the *current* selection is on the page it received, and
        // reassigns to the first row when it is not. Adopting early therefore gets overwritten a
        // beat later by a page that was requested before the adoption happened.
        //
        // Re-pinning refetches that page for the organization actually selected, which both
        // supersedes the in-flight one and satisfies the check when the replacement arrives.
        if (match) {
          this.accountContext.setAccount(match);
          this.orgNavigation.resetAndReload(match.uid);
        }

        // Not when a landing is intended. `landOnSignedAgreement` navigates off this route, and the
        // navigation below is relative to it, so both in flight means Angular cancels whichever
        // started first — leaving the signatory on the list either way.
        //
        // A flag rather than a look at `this.router.url`, which is the *committed* address: both
        // flows start from this constructor and `navigate` resolves later, so at this point the
        // committed address is still the return address whichever one goes on to win. The flag is
        // set synchronously, before anything is awaited, so it is already true here. Removing the
        // parameter then belongs to the landing, which does it if it declines to navigate.
        if (this.returnLandingPending) return;

        this.stripReturnOrganizationFromAddress();
      });
  }

  /**
   * Takes the organization back off the address once it has been acted on.
   *
   * Whether or not it matched: left in place it would pin a stale organization on reload and on any
   * copied link, and would contradict the viewer the moment they switch.
   */
  private stripReturnOrganizationFromAddress(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [ORG_EASYCLA_RETURN_ORG_PARAM]: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /**
   * Lands the signatory on the agreement they just signed, instead of the list they left.
   *
   * The return address cannot name it: `return_url` is an *input* to the upstream signing request
   * and so is fixed before a signature exists, while the signature id only comes back on the
   * response. The client carries it across the trip in `sessionStorage`, and this spends it.
   *
   * Three conditions, each of which is a way of not being wrong:
   *
   * - **Only when the return parameter is present**, so an abandoned ceremony followed by an
   *   ordinary visit to the list does not teleport the viewer into a detail page. The stash is
   *   spent either way, which is what makes it single-use whichever visit finds it.
   * - **Only once the named organization's own list has landed.** Whichever organization was
   *   selected at boot settles first and cannot contain the new agreement, so a decision taken
   *   against that list would spend the trip on a row that was never going to be in it.
   * - **Only if the row is actually there.** EasyCLA may not have finished processing the DocuSign
   *   callback by the time the signatory is back, and navigating blind would land them on "This CLA
   *   was not found" — strictly worse than the list. A first answer without the row is treated as
   *   too early rather than as no, and asked again on a budget; see `retryForSignedAgreement`.
   *
   * Matching the row by the CLA Group instead would need none of the stash, and is not equivalent:
   * the upstream grain is (signing entity x CLA Group), so one organization can hold two rows for
   * the same CLA Group, and the match is ambiguous exactly where it matters.
   *
   * Waiting on that list also has to be able to give up. No list is ever fetched for an organization
   * the viewer does not hold, so a crafted or stale return address would otherwise wait for one
   * forever and leave the organization on the address — which is the one thing FR-027a says must not
   * survive the visit. Settling without the organization is therefore an outcome, not a hang.
   *
   * From the moment a landing is intended this method owns that parameter: it removes it itself when
   * it decides to stay on the list, because `adoptOrganizationFromReturnAddress` stands down as soon
   * as the intent is claimed. Leaving both to strip it is what made the two cancel each other.
   */
  private landOnSignedAgreement(): void {
    // Same browser-only boundary the return-address adoption above documents: `sessionStorage` is
    // one, and the navigation below is the other.
    if (!isPlatformBrowser(this.platformId)) return;

    const signatureId = takeStashedSignedSignatureId();
    const named = this.route.snapshot.queryParamMap.get(ORG_EASYCLA_RETURN_ORG_PARAM);
    if (!signatureId || !named) return;

    // Claimed before anything is awaited, so the sibling flow above sees it however the two
    // interleave. From here the parameter is this method's to remove.
    this.returnLandingPending = true;

    combineLatest([toObservable(this.claData), toObservable(this.accountContext.availableAccounts), toObservable(this.orgContextLoaded)])
      .pipe(
        map(([data, accounts, loaded]) => ({
          list: data?.orgUid === named ? data : null,
          // Nothing will ever fetch a list for an organization the viewer does not hold, so once the
          // context has settled without it there is no list coming and waiting on one would leave
          // the parameter on the address for good.
          unreachable: loaded && !accounts.some((account: Account) => account.uid === named),
        })),
        filter(({ list, unreachable }) => !!list || unreachable),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ list }) => {
        if (list?.claGroups.some((group) => group.id === signatureId)) {
          this.landOn(signatureId);
          return;
        }

        // No list at all means the organization is not the viewer's, and no amount of asking again
        // will produce one. Staying on the list, so the address still has to be cleaned up — the
        // sibling flow stood down on the strength of the flag and will not do it.
        if (!list) {
          this.stripReturnOrganizationFromAddress();
          return;
        }

        this.retryForSignedAgreement(named, signatureId);
      });
  }

  /**
   * Asks again for the list, a bounded number of times, when the signed agreement is not in it.
   *
   * The list arriving without the row is not evidence that it will never have one: EasyCLA writes
   * the signature when DocuSign calls it back, and that callback races the signatory's return trip.
   * Nothing else would ever bring the row in either — the page fetches once per organization, and
   * the stash has already been spent, so without this the trip ends on the list and even a reload
   * cannot recover it.
   *
   * Asked of the service directly rather than through the page's own stream, which is keyed on the
   * organization and would re-raise the skeleton over a list the viewer is already reading. A
   * failed attempt is treated as "not yet" and simply costs one of the tries.
   */
  private retryForSignedAgreement(orgUid: string, signatureId: string): void {
    timer(OrgEasyclaComponent.signedAgreementRetryDelayMs, OrgEasyclaComponent.signedAgreementRetryDelayMs)
      .pipe(
        take(OrgEasyclaComponent.signedAgreementRetries),
        concatMap(() => this.claService.getClaGroups(orgUid).pipe(catchError(() => of(null)))),
        map((list) => !!list?.claGroups.some((group) => group.id === signatureId)),
        first((found) => found, false),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((found) => {
        if (found) {
          this.landOn(signatureId);
          return;
        }

        this.stripReturnOrganizationFromAddress();
      });
  }

  /**
   * Replaces rather than pushes: the address being left behind is the return address, and an entry
   * for it in the viewer's history is one Back re-enters, spending nothing and stripping a
   * parameter all over again. The parameter needs no separate removal — this leaves the route it
   * sits on, and query parameters are not carried across.
   */
  private landOn(signatureId: string): void {
    void this.router.navigate([ORG_EASYCLA_PATH, signatureId], { replaceUrl: true });
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
      const start = this.currentPage() * OrgEasyclaComponent.pageSize;
      return this.filteredClaGroups().slice(start, start + OrgEasyclaComponent.pageSize);
    });
  }

  private initPageLabel(): Signal<string> {
    return computed(() => {
      const total = this.filteredClaGroups().length;
      if (total === 0) return '';

      const start = this.currentPage() * OrgEasyclaComponent.pageSize;
      return `Showing ${start + 1}–${Math.min(start + OrgEasyclaComponent.pageSize, total)} of ${total}`;
    });
  }
}
