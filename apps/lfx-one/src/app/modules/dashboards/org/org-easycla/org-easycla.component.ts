// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CCLA_SIGN_COPY } from '@lfx-one/shared/constants';
import type { OrgClaGroup, OrgClaGroupList, OrgClaGroupPickerResult, OrgClaSignAttestations } from '@lfx-one/shared/interfaces';
import { orgClaOpenLabel } from '@lfx-one/shared/utils';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
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
import { orgClaCoverageDialogConfig, OrgEasyclaCoverageDialogComponent } from './org-easycla-coverage-dialog/org-easycla-coverage-dialog.component';
import { OrgEasyclaAttestationComponent } from './org-easycla-sign/org-easycla-attestation.component';
import { OrgEasyclaGroupSelectComponent } from './org-easycla-sign/org-easycla-group-select.component';
import { OrgEasyclaSignHandoffComponent } from './org-easycla-sign/org-easycla-sign-handoff.component';

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

  private readonly accountContext = inject(AccountContextService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  private readonly personaService = inject(PersonaService);
  private readonly orgNavigation = inject(OrgNavigationService);
  private readonly claService = inject(OrgLensClaService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  /** One hand-off at a time. Also what disables the Sign CLA control while a flow is open. */
  protected readonly signingOpen = signal(false);

  /**
   * Whichever signing dialog is open before a signature has been asked for — the picker, then the
   * attestation. Held so an organization switch can close it; see `abandonUncommittedSigning`.
   * Never holds the hand-off, which is why the field is named for the uncommitted half.
   */
  private uncommittedSigningDialog: DynamicDialogRef | null = null;

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
    this.orgChanged$.pipe(takeUntilDestroyed()).subscribe(() => this.abandonUncommittedSigning());
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
   * Starts the corporate signing flow (#1983): pick a CLA Group, confirm authorization and export
   * compliance, then hand off.
   *
   * Three dialogs in sequence rather than one stepped component, matching the Me-lens hand-off:
   * each step closes with what the next one needs, so no step can read a value another step was
   * responsible for collecting. In particular the attestation dialog closes with the two
   * confirmations themselves, and this method passes them straight through — it never
   * reconstructs them from the fact that the dialog closed with something.
   */
  protected startSigning(): void {
    const orgUid = this.accountContext.selectedAccount()?.uid;
    // Single-flight: the control is disabled while a flow is open, and this is the second line.
    if (!orgUid || this.signingOpen()) return;

    this.signingOpen.set(true);

    const pickerRef = this.dialogService.open(OrgEasyclaGroupSelectComponent, {
      header: CCLA_SIGN_COPY.picker.header,
      width: '40rem',
      // The Aura dialog preset caps nothing, so a fixed width alone runs off a 360-390px phone,
      // taking the controls at its edges with it. Same cap the sibling coverage dialog documents.
      style: { maxWidth: '90vw' },
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { orgUid },
    }) as DynamicDialogRef;

    this.uncommittedSigningDialog = pickerRef;

    pickerRef.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((chosen: OrgClaGroupPickerResult | null | undefined) => {
      this.uncommittedSigningDialog = null;
      if (!chosen) {
        this.signingOpen.set(false);
        return;
      }
      this.confirmThenHandOff(orgUid, chosen);
    });
  }

  /**
   * Closes a signing flow that has not yet asked for a signature, on an organization switch.
   *
   * `orgUid` is read once when the flow starts and threaded through all three dialogs, and
   * switching organizations does not destroy this component — it re-drives the list fetch. So
   * without this, the picker and the attestation dialog stay open over a page that has moved on,
   * still carrying the organization the viewer left, and confirming would open a signing session
   * against that company's legal position. This is the download path's stale-response failure on
   * the detail page, arriving at a legal agreement instead of a PDF.
   *
   * Only the two dialogs before the request is issued. The hand-off is deliberately left alone:
   * by the time it is open a signing session exists for the organization that was selected when
   * the viewer confirmed, which is the one they meant, and the address it returns is the only
   * thing that reaches them. Closing it on a switch would orphan an envelope to save nothing.
   */
  private abandonUncommittedSigning(): void {
    this.uncommittedSigningDialog?.close();
  }

  private confirmThenHandOff(orgUid: string, chosen: OrgClaGroupPickerResult): void {
    const attestationRef = this.dialogService.open(OrgEasyclaAttestationComponent, {
      header: CCLA_SIGN_COPY.attestation.header,
      width: '42rem',
      // The Aura dialog preset caps nothing, so a fixed width alone runs off a 360-390px phone,
      // taking the controls at its edges with it. Same cap the sibling coverage dialog documents.
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

      const handoffRef = this.dialogService.open(OrgEasyclaSignHandoffComponent, {
        // Opened locked, and the component unlocks it — including this header, which it keeps in
        // step with the state it is showing. A real signing session is opened behind this dialog
        // as it appears, and the address it returns is the only thing that reaches the signatory:
        // dismissing it before then, by mask, header control or Escape, leaves an envelope that
        // exists and that nobody was handed. These three are the initial values only.
        header: CCLA_SIGN_COPY.preparing.header,
        width: '40rem',
        // The Aura dialog preset caps nothing, so a fixed width alone runs off a 360-390px phone,
        // taking the controls at its edges with it. Same cap the sibling coverage dialog documents.
        style: { maxWidth: '90vw' },
        modal: true,
        closable: false,
        closeOnEscape: false,
        dismissableMask: false,
        data: { orgUid, projectSfid: chosen.projectSfid, claGroupId: chosen.claGroupId, attestations },
      }) as DynamicDialogRef;

      handoffRef.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.signingOpen.set(false));
    });
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
