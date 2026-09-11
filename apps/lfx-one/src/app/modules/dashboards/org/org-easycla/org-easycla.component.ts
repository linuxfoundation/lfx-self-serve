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
import type { Account, OrgClaGroup, OrgClaGroupList, OrgClaSignSelection, OrgItem } from '@lfx-one/shared/interfaces';
import { orgClaOpenLabel } from '@lfx-one/shared/utils';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import {
  catchError,
  combineLatest,
  concatMap,
  distinctUntilChanged,
  filter,
  first,
  map,
  merge,
  Observable,
  of,
  shareReplay,
  skip,
  skipWhile,
  switchMap,
  take,
  takeUntil,
  tap,
  timeout,
  TimeoutError,
  timer,
} from 'rxjs';

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
   *
   * `perAttemptTimeoutMs` bounds the whole poll in wall-clock time, not only in count. Without it,
   * a stalled BFF can leave each attempt waiting the gateway timeout (`API_GW_TIMEOUT_MS`, 30s),
   * and `concatMap` runs the retries in series — so three stalled attempts would take about 90s
   * against a doc comment that says "a few seconds". A timed-out attempt is treated the same as
   * a failed one: another try if the budget still has one, otherwise the same not-found cleanup
   * as any exhausted poll. Sized well below the gateway timeout so a genuine network stall
   * cannot swallow the whole retry budget on a single attempt.
   */
  private static readonly signedAgreementRetryDelayMs = 2000;
  private static readonly signedAgreementRetries = 3;
  private static readonly signedAgreementPerAttemptTimeoutMs = 3000;

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

  private namedOrganizationResolved$: Observable<Account | null> | null = null;

  // ── Search (client-side; the upstream list takes no search parameter) ──────
  protected readonly orgClaOpenLabel = orgClaOpenLabel;

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
  });

  protected readonly fetchError = signal(false);

  /**
   * The organization whose list request failed, which `claData` cannot say.
   *
   * A failure is stored as `null`, and a `null` carries no `orgUid` — so on a return trip, where
   * one request is in flight for the organization being left and another for the one signed with,
   * the failure of either is indistinguishable from the failure of the other.
   */
  private readonly failedOrgUid = signal<string | null>(null);
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

  /**
   * The organization's CLA list.
   *
   * Written from two places: the main fetch keyed on `orgUid$`, and the return-trip retry which
   * asks upstream directly and pushes what it hears back in. Without the second the retry could
   * recover the list without the row and still leave "we couldn't load your CLAs" on screen — the
   * error state having been set by the failed initial attempt and never cleared.
   */
  private readonly claData = signal<OrgClaGroupList | null | undefined>(undefined);

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

    this.subscribeClaData();
    // Landing before adoption is deliberate: `landOnSignedAgreement` sets `returnLandingPending`
    // synchronously before it subscribes, and only that ordering makes the flag observable to
    // adoption no matter how the schedulers interleave. The previous order relied on
    // `toObservable` deferring adoption's first emission until after landing's synchronous prelude
    // ran; safe on the current scheduler but scheduler-dependent, and not the arbitration we mean.
    this.landOnSignedAgreement();
    this.adoptOrganizationFromReturnAddress();
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
   */
  private adoptOrganizationFromReturnAddress(): void {
    // The address is only followed in a browser, and the strip below is a browser navigation.
    if (!isPlatformBrowser(this.platformId)) return;

    const named = this.route.snapshot.queryParamMap.get(ORG_EASYCLA_RETURN_ORG_PARAM);
    if (!named) return;

    this.organizationNamedOnReturn(named)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((match) => {
        // `setAccount` also rewrites the cookie, so the round trip repairs the selection that went
        // missing rather than leaving the next reload to fall back all over again.
        if (match) this.accountContext.setAccount(match);

        // Not when a landing is intended. `landOnSignedAgreement` navigates off this route, and the
        // navigation below is relative to it, so both in flight means Angular cancels whichever
        // started first — leaving the signatory on the list either way.
        if (this.returnLandingPending) return;

        this.stripReturnOrganizationFromAddress();
      });
  }

  private organizationNamedOnReturn(named: string): Observable<Account | null> {
    this.namedOrganizationResolved$ ??= this.resolveNamedOrganization(named).pipe(shareReplay({ bufferSize: 1, refCount: true }));
    return this.namedOrganizationResolved$;
  }

  private resolveNamedOrganization(named: string): Observable<Account | null> {
    const items$ = toObservable(this.orgNavigation.items);
    const loaded$ = toObservable(this.orgNavigation.loaded);
    const noAccess$ = toObservable(this.hasNoOrgAccess);

    return combineLatest([items$, loaded$, noAccess$]).pipe(
      filter(([, loaded, noAccess]) => noAccess || loaded),
      take(1),
      switchMap(([items, , noAccess]) => {
        if (noAccess) return of(null);
        const immediate = this.catalogueAccountNamed(items, named);
        if (immediate) return of(immediate);
        this.orgNavigation.resetAndReload(named);
        return combineLatest([items$, loaded$]).pipe(
          skip(1),
          filter(([, loaded]) => loaded),
          map(([current]) => this.catalogueAccountNamed(current, named)),
          take(1)
        );
      })
    );
  }

  private catalogueAccountNamed(items: OrgItem[], named: string): Account | null {
    const match = items.find((item: OrgItem) => item.uid === named || item.accountId === named);
    if (!match) return null;
    return {
      accountId: match.accountId ?? named,
      accountName: match.name,
      accountSlug: '',
      membershipTier: '',
      logoUrl: match.logoUrl ?? null,
      uid: named,
    };
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
   * Waiting on that list also has to be able to give up, and there are two ways it never arrives.
   * No list is ever fetched for an organization the viewer does not hold, so a crafted or stale
   * return address would otherwise wait for one forever; and a request that fails is not retried by
   * the page, so the wait outlives the only attempt that could have ended it. Either would leave the
   * organization on the address — the one thing FR-027a says must not survive the visit. Both are
   * therefore outcomes rather than hangs: the first settles, the second is asked again.
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

    type Outcome = { kind: 'list'; list: OrgClaGroupList | null } | { kind: 'failed' } | { kind: 'unreachable' } | { kind: 'cancelled' };

    const outcome$ = combineLatest([toObservable(this.claData), this.organizationNamedOnReturn(named), toObservable(this.failedOrgUid)]).pipe(
      map(([data, account, failedFor]): Outcome | null => {
        // A failed request answers nothing about the row, but it does answer the question of
        // whether to keep waiting. The page fetches once per organization, so nothing is coming
        // to replace the failure, and a wait for the list it did not return never ends — leaving
        // the signatory on an error page with the parameter still on the address and the stash
        // already spent, so not even a reload could recover the landing.
        //
        // Only this organization's failure counts, which is why it is read from the request's own
        // record of what it asked for rather than inferred from `claData`. Two requests are made
        // on a return trip — one for the organization being left, one for the organization signed
        // with — and a stored `null` belongs to neither in particular. Reading the failure as this
        // organization's would start the retry while the real request is still in flight, and
        // before adoption on the trip where the first request is the one that failed.
        if (failedFor === named) return { kind: 'failed' };
        // Nothing will ever fetch a list for an organization the viewer does not hold, so once the
        // context has settled without it there is no list coming and waiting on one would leave
        // the parameter on the address for good.
        if (!account) return { kind: 'unreachable' };
        if (data?.orgUid === named) return { kind: 'list', list: data };
        return null;
      }),
      filter((outcome): outcome is Outcome => outcome !== null)
    );

    // A "selection moved off" that fires post-adoption is `resetAndReload` clearing the account
    // after its own upstream call came back empty or failed, or the viewer walking away while the
    // list is in flight. Either way the wait is over, and reading a later list response would land
    // the signatory on a detail page with no context.
    const cancelled$ = this.selectionMovedOff(named).pipe(map((): Outcome => ({ kind: 'cancelled' })));

    merge(outcome$, cancelled$)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((outcome) => {
        if (outcome.kind === 'list' && outcome.list?.claGroups.some((group) => group.id === signatureId)) {
          this.landOnIfSelectionMatches(named, signatureId);
          return;
        }

        // An organization the viewer does not hold, or one the viewer has moved off, is a case no
        // amount of asking again can fix. Staying on the list, so the address still has to be
        // cleaned up — the sibling flow stood down on the strength of the flag and will not do it.
        if (outcome.kind === 'unreachable' || outcome.kind === 'cancelled') {
          this.stripReturnOrganizationFromAddress();
          return;
        }

        // Everything else — the list without the row yet, and the request that failed — is asked
        // again, of upstream directly, and cleans the address up itself once the budget is spent.
        this.retryForSignedAgreement(named, signatureId);
      });
  }

  /**
   * Lands only if the selection is still this organization at the moment of landing, otherwise
   * strips the return address and leaves the signatory on the list.
   *
   * The wait's `cancelled$` branch reads the selection stream, so a clear that reaches it before
   * the list does turns into a `cancelled` outcome. A clear that reaches the observers in the same
   * flush as a row-bearing list, though, presents the row-bearing outcome first — and reading it as
   * "landing is safe" would take the signatory to the detail page keyed on a company that is no
   * longer selected. This is the synchronous re-check that closes that window.
   */
  private landOnIfSelectionMatches(named: string, signatureId: string): void {
    if (this.accountContext.selectedAccount()?.uid !== named) {
      this.stripReturnOrganizationFromAddress();
      return;
    }
    this.landOn(signatureId);
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
   *
   * Given up on the moment the viewer selects a different organization. This page survives that
   * switch, so an answer arriving afterwards would take a viewer who has deliberately moved on to
   * an agreement belonging to the company they left — and the detail page, keyed on the selection,
   * would look it up under the new one and report it missing. Giving up still spends the trip, so
   * the return address is cleaned up rather than left to contradict the viewer on reload.
   */
  private retryForSignedAgreement(orgUid: string, signatureId: string): void {
    timer(OrgEasyclaComponent.signedAgreementRetryDelayMs, OrgEasyclaComponent.signedAgreementRetryDelayMs)
      .pipe(
        take(OrgEasyclaComponent.signedAgreementRetries),
        // One line per failed attempt, so triage of a stranded landing can see whether the retries
        // failed or found nothing. Silence here was inconsistent with the initial fetch's log line
        // and left the retry invisible to the console.
        concatMap(() =>
          this.claService.getClaGroups(orgUid).pipe(
            // Bounds each attempt in wall-clock time. Without it, a stalled BFF can wait the full
            // gateway timeout (30s) per attempt and three retries would take about 90s against a
            // doc comment that describes a few-second budget. A timeout is treated as another
            // failed attempt: a not-yet, not a hard error.
            timeout({ each: OrgEasyclaComponent.signedAgreementPerAttemptTimeoutMs }),
            catchError((error: unknown) => {
              if (error instanceof TimeoutError) {
                console.warn('Retry for signed agreement timed out:', error);
              } else {
                console.warn('Retry for signed agreement failed:', error);
              }
              return of(null);
            })
          )
        ),
        // A retry that succeeds without the row is still an answer about the list, and the one the
        // page will show once this trip is spent. Without this, an initial failure followed by a
        // recovery leaves the error state on the template even though the list is now in hand.
        tap((list) => {
          if (!list) return;
          this.claData.set(list);
          this.fetchError.set(false);
          this.failedOrgUid.set(null);
        }),
        map((list) => !!list?.claGroups.some((group) => group.id === signatureId)),
        takeUntil(this.selectionMovedOff(orgUid)),
        first((found) => found, false),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((found) => {
        if (found) {
          this.landOnIfSelectionMatches(orgUid, signatureId);
          return;
        }

        this.stripReturnOrganizationFromAddress();
      });
  }

  /**
   * Fires once the selection has moved off this organization, whether onto a different one or onto
   * nothing at all.
   *
   * Waits for the selection to be this organization first. Adoption on a return trip is itself a
   * change of selection, and one arriving late would otherwise read as the viewer walking away
   * from the very organization being adopted.
   *
   * An empty selection is treated the same as a switch, because `resetAndReload` clears the account
   * when its own page comes back empty or upstream fails. Left counted as still-this-one, the
   * signatory would be landed on the detail page for the organization they signed for, then read as
   * having no context there and greeted with the very "no company selected" message the return trip
   * exists to avoid.
   */
  private selectionMovedOff(orgUid: string): Observable<string | null | undefined> {
    return this.selectedOrgUid$.pipe(
      skipWhile((uid) => uid !== orgUid),
      filter((uid) => uid !== orgUid)
    );
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

  private subscribeClaData(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.orgUid$
      .pipe(
        tap(() => {
          this.claLoadingState.set(true);
          this.fetchError.set(false);
          this.failedOrgUid.set(null);
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
              this.failedOrgUid.set(uid);
              this.claLoadingState.set(false);
              return of(null);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((list) => this.claData.set(list));
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
