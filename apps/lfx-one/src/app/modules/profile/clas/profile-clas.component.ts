// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal, viewChildren } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { ECLA_COVERED_DOWNLOAD_LABEL, GITLAB_UNSUPPORTED_HEADER, MY_CLAS_M2_ENABLED_FLAG, MY_CLAS_PATH, SIGN_IDENTITY_COPY } from '@lfx-one/shared/constants';
import type {
  ClaGroupOption,
  ClaRow,
  ClaSignRoute,
  ClaStatus,
  GithubAccountOption,
  MyClaAgreement,
  MyClasState,
  PrepareSignResponse,
  SignIdentityDialogData,
  SignIdentitySelectResult,
  SignIdentityVariant,
} from '@lfx-one/shared/interfaces';
import {
  alreadySignedAgreementsForGroup,
  claSignRoute,
  claStatusLabel,
  claStatusSeverity,
  downloadFromUrl,
  gerritSignUrl,
  isMyClasEmpty,
  signedAsLine,
} from '@lfx-one/shared/utils';
import { MenuItem, MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { ToastModule } from 'primeng/toast';
import { BehaviorSubject, catchError, of, switchMap, take } from 'rxjs';

import { environment } from '@environments/environment';

import { BadgeComponent } from '@components/badge/badge.component';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MenuComponent } from '@components/menu/menu.component';
import { MessageComponent } from '@components/message/message.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { FeatureFlagService } from '@services/feature-flag.service';
import { MyClasService } from '@services/my-clas.service';
import { UserService } from '@services/user.service';

import { ClaGroupSelectComponent } from './cla-group-select.component';
import { buildContactClaManagerMenuItems } from './contact-cla-manager-menu';
import { GitlabUnsupportedComponent } from './gitlab-unsupported.component';
import { buildManageInCclaConsoleMenuItems } from './manage-ccla-console-menu';
import { SignIdentitySelectComponent } from './sign-identity-select.component';

/**
 * "CLAs" Profile tab (Me lens). Lists every signed agreement (ICLA + ECLA)
 * from `/v4/my-clas`. The M2 overlay (status column, per-row kebab, Signed as,
 * Sign CLA) is dark-launched behind `my-clas-m2-enabled`; off, this is the M1
 * list (project / type / signed date / document). Status and reason are copied from the
 * producer; this component does not derive standing from `approved`/`valid`.
 *
 * Also the entry point for signing a new CLA (#1251), which leaves the page for the EasyCLA
 * Contributor Console. That action is page-level rather than per-row: signing a *new* CLA has no
 * row to act on, since the row is what signing produces.
 */
@Component({
  selector: 'lfx-profile-clas',
  imports: [
    DatePipe,
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    EmptyStateComponent,
    MenuComponent,
    MessageComponent,
    TableComponent,
    TagComponent,
    ToastModule,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './profile-clas.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileClasComponent {
  private readonly myClasService = inject(MyClasService);
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly userService = inject(UserService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogService = inject(DialogService);
  private readonly router = inject(Router);
  private readonly featureFlagService = inject(FeatureFlagService);

  /** Dark-launch for the M2 overlay. Default off — LaunchDarkly targeting is the rollout switch. */
  protected readonly myClasM2Enabled = this.featureFlagService.getBooleanFlag(MY_CLAS_M2_ENABLED_FLAG, false);

  /**
   * Read-only when impersonating — a signature and a CLA-manager request are binding acts that
   * would be recorded against the target rather than the administrator, so the server refuses
   * them (`blockDuringImpersonation` on `POST /api/me/clas/prepare-sign` and
   * `POST /api/me/clas/:signatureId/cla-manager-requests`).
   *
   * Sign CLA and the row's write actions are therefore disabled rather than withheld, so an
   * administrator can see the action exists and read why it is unavailable — the treatment every
   * other impersonation-blocked control on the profile gets. Download PDF stays enabled: it is a
   * read, and retrieving the signed document is the one thing an administrator legitimately
   * needs on someone else's row.
   */
  protected readonly impersonating = this.userService.impersonating;

  // signatureID currently resolving a PDF URL (drives the row's spinner + guards double-clicks).
  protected readonly downloadingId = signal<string | null>(null);

  /** True while the chosen group's hand-off URL is being resolved; also guards a double hand-off. */
  protected readonly starting = signal(false);

  private readonly signDialogOpen = signal(false);

  private readonly rowMenus = viewChildren(MenuComponent);

  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  private readonly state = this.initState();

  protected readonly loading = computed(() => !this.state().loaded);
  protected readonly error = computed(() => this.state().error);

  protected readonly agreements = computed<MyClaAgreement[]>(() => this.state().data?.agreements ?? []);
  protected readonly isEmpty = computed(() => isMyClasEmpty(this.state().loaded, this.state().error, this.agreements().length));

  /**
   * The table's only binding source. Recomputes when the agreement list or the two session flags
   * it reads change, and not otherwise, which is what keeps each row's `MenuItem[]` referentially
   * stable — a fresh model per change-detection pass makes the PrimeNG popup miss the first click.
   */
  protected readonly rows: Signal<ClaRow[]> = this.initRows();

  // --- Sign CLA hand-off (#1251) -------------------------------------------

  /**
   * Also disabled until the list has loaded, and while it has failed to load (#1914). Both dialogs
   * read the loaded agreements — the picker to tag a group they already signed, the identity step
   * to gray out the identity that signed it — and in both states the list is empty, which is
   * indistinguishable from having signed nothing. Offering the flow then would walk them into the
   * duplicate signing this change exists to prevent.
   */
  protected readonly signDisabled = computed(() => this.impersonating() || this.loading() || this.error());

  /**
   * Reads as the button's accessible name while it is disabled, so it has to name the action
   * before the reason — an aria-label replaces the label rather than adding to it, and a reason
   * on its own would leave a screen reader with no idea which action is unavailable.
   */
  protected readonly signDisabledReason = computed<string | undefined>(() => {
    if (this.impersonating()) return 'Sign CLA — unavailable while impersonating another user';
    if (this.loading()) return 'Sign CLA — available once your CLAs have loaded';
    if (this.error()) return 'Sign CLA — available once your CLAs load; select Retry to reload them';
    return undefined;
  });

  protected retry(): void {
    this.refresh$.next();
  }

  protected toggleRowMenu(event: Event, menu: MenuComponent): void {
    // Each row owns its own popup overlay. The click is stopped so the kebab
    // does not close immediately, which also means PrimeNG never sees a document
    // click that would hide the previous overlay.
    event.stopPropagation();
    for (const other of this.rowMenus()) {
      if (other !== menu) {
        other.hide();
      }
    }
    menu.toggle(event);
  }

  /**
   * Opens the picker, then hands off to whatever it closes with.
   *
   * A dynamic dialog rather than a `<p-dialog>` in this template, per the frontend checklist's
   * dialog rule and the sibling profile tabs.
   */
  protected openSignDialog(): void {
    // `impersonating()` is re-checked here and not only on the button: the button is now rendered
    // rather than withheld, so a keyboard or programmatic activation can reach this method, and
    // opening the picker would walk the administrator to a prepare the server refuses.
    if (!this.myClasM2Enabled() || this.signDisabled() || this.starting() || this.signDialogOpen()) return;
    this.signDialogOpen.set(true);

    const dialogRef = this.dialogService.open(ClaGroupSelectComponent, {
      header: 'Sign a CLA',
      width: '32rem',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { agreements: this.agreements() },
    }) as DynamicDialogRef;

    this.whenDialogSettles<ClaGroupOption>(dialogRef, (option) => {
      this.signDialogOpen.set(false);
      if (!option) {
        this.starting.set(false);
        return;
      }
      this.handOffToConsole(option);
    });
  }

  /**
   * Resolves the ICLA's short-lived PDF URL and triggers a file download (no new tab).
   * Origin-tab spinner stays on the ⋮ trigger while the presigned URL resolves; see #1228.
   * Filename includes project/CLA-group name so multi-project downloads don't collide.
   */
  protected onDownload(agreement: MyClaAgreement): void {
    if (this.downloadingId()) return;

    this.downloadingId.set(agreement.id);

    this.myClasService.getPdfUrl(agreement.id).subscribe({
      next: ({ url }) => {
        this.downloadingId.set(null);
        const label = agreement.projectName || agreement.claGroupName || 'cla';
        downloadFromUrl(url, `${label}-signed.pdf`);
      },
      error: () => {
        this.downloadingId.set(null);
        this.messageService.add({
          severity: 'error',
          summary: 'Download failed',
          detail: 'Could not download the signed document. Please try again.',
        });
      },
    });
  }

  /**
   * Settles which identity the signature will be recorded against, then leaves for the
   * Console (#1252, #2002).
   *
   * The identity step comes before the hand-off rather than after because the association is
   * what the Console's signature is recorded against; deciding it afterwards would mean the
   * contributor had already signed by the time anyone knew as whom.
   *
   * Which identities that step offers depends on what the selected group is linked to, and
   * that is the whole of what the source decides — the step itself is never skipped. A
   * contributor signing a Gerrit group under their LF identity should know that is what they
   * are doing, which a silent hand-off would not tell them.
   *
   * GitLab is the one source with no identity to offer, so it is answered with a block rather
   * than a step.
   */
  private handOffToConsole(option: ClaGroupOption): void {
    const route: ClaSignRoute = claSignRoute(option.organizations);

    if (route === 'gitlab-unsupported') {
      this.showGitlabUnsupported();
      return;
    }

    if (route === 'gerrit') {
      // No linked-account lookup: nothing on this path consults a GitHub account, and asking
      // for one would let a failure to read them block a signature that never needed them.
      this.chooseIdentityThenSign(option, 'gerrit', []);
      return;
    }

    this.starting.set(true);
    this.myClasService
      .getGithubAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ accounts }) => this.chooseIdentityThenSign(option, route, accounts),
        error: () => {
          this.starting.set(false);
          // Explicitly not treated as "no accounts linked". The two are indistinguishable in
          // the payload but not in consequence: showing the step's empty state to someone
          // who already linked an account asks them to fix something that is not broken.
          //
          // A mixed group fails here too, rather than quietly falling back to its Gerrit
          // identity. Dropping an option because a lookup failed would hide that the option
          // existed, and this failure is transient — the contributor can simply try again.
          this.messageService.add({
            severity: 'error',
            summary: 'Could not start signing',
            detail: 'We could not check your linked GitHub accounts. Please try again.',
          });
        },
      });
  }

  /** Per-state leading icon for the status pill. Exhaustive against ClaStatus. */
  private statusIcon(status: ClaStatus): string {
    switch (status) {
      case 'valid':
        return 'fa-light fa-circle-check';
      case 'needs_attention':
        return 'fa-light fa-triangle-exclamation';
      case 'revoked':
        return 'fa-light fa-ban';
      case 'invalidated':
        return 'fa-light fa-circle-xmark';
      case 'unknown':
        return 'fa-light fa-minus';
      case 'superseded':
        return 'fa-light fa-clock-rotate-left';
    }
  }

  /**
   * Asks which identity the signature will be recorded against. Every list reaches the step,
   * whatever its length.
   *
   * A single identity is asked for too, because what the screen carries is the identity rather
   * than the choice, and a list of one says that as plainly as a list of two. An empty one is
   * shown as well, as the step's own blocking empty state (#1917) — the contributor is stopped
   * where they are instead of being moved off the page, which would drop the CLA group they had
   * already chosen. Either way nothing reaches the Console without a confirmed identity.
   *
   * A Gerrit identity is offered whenever the group is linked to Gerrit, and it always resolves,
   * so a variant carrying one cannot reach that empty state. That matters most on a mixed group
   * whose contributor has no linked GitHub account: they are offered Gerrit rather than blocked
   * on the GitHub account they do not need.
   */
  private chooseIdentityThenSign(option: ClaGroupOption, variant: SignIdentityVariant, accounts: GithubAccountOption[]): void {
    const gerritUsername = variant === 'github' ? undefined : this.userService.viewerUsername()?.trim() || undefined;

    // Nothing to show and nothing to fall back on. Only reachable if the session lost the
    // identity it was resolved from, so it is reported rather than rendered as an empty step.
    if (variant === 'gerrit' && !gerritUsername) {
      this.starting.set(false);
      this.reportGerritIdentityUnresolved();
      return;
    }

    // A mixed group whose Gerrit identity will not resolve is still signable through GitHub,
    // so it degrades to the GitHub step — copy included — rather than offering a blank card.
    const effectiveVariant: SignIdentityVariant = variant === 'github-or-gerrit' && !gerritUsername ? 'github' : variant;

    this.starting.set(false);
    this.signDialogOpen.set(true);

    // What they already hold for *this* group, so the step can gray out the identity that signed
    // it. Passed as agreements rather than a precomputed verdict because only the step knows
    // which identities it ended up offering.
    const claGroupAgreements = alreadySignedAgreementsForGroup(this.agreements(), option.claGroupId);

    const data: SignIdentityDialogData = {
      variant: effectiveVariant,
      accounts,
      ...(gerritUsername ? { gerritUsername } : {}),
      ...(claGroupAgreements.length > 0 ? { claGroupAgreements } : {}),
    };

    const dialogRef = this.dialogService.open(SignIdentitySelectComponent, {
      header: SIGN_IDENTITY_COPY[effectiveVariant].header,
      width: '32rem',
      modal: true,
      closable: true,
      dismissableMask: true,
      data,
    }) as DynamicDialogRef;

    this.whenDialogSettles<SignIdentitySelectResult>(dialogRef, (result) => {
      this.signDialogOpen.set(false);
      this.starting.set(false);

      if (!result) return;

      if ('linkAccounts' in result) {
        this.sendToAccountLinking();
        return;
      }

      if (result.kind === 'gerrit') {
        this.handOffToGerrit(option);
        return;
      }

      // Resolved from the list the server served rather than taken from the dialog, so the
      // account submitted is always one of the accounts linked to this session. Ownership
      // verification upstream passes for every account the contributor holds, which is what
      // makes where this value came from matter.
      const chosen = accounts.find((account) => account.githubId === result.githubId);
      if (!chosen) {
        this.reportRecordedMismatch();
        return;
      }

      this.prepareThenHandOff(option, chosen);
    });
  }

  /** The GitLab block. Closes with nothing; every exit from it is the same exit. */
  private showGitlabUnsupported(): void {
    this.signDialogOpen.set(true);

    const dialogRef = this.dialogService.open(GitlabUnsupportedComponent, {
      header: GITLAB_UNSUPPORTED_HEADER,
      width: '32rem',
      modal: true,
      closable: true,
      dismissableMask: true,
    }) as DynamicDialogRef;

    this.whenDialogSettles(dialogRef, () => {
      this.signDialogOpen.set(false);
      this.starting.set(false);
    });
  }

  /**
   * Leaves for the Console's Gerrit signing route (#2002).
   *
   * No prepare-sign call, and no identity of any kind on the wire. The Console resolves the
   * EasyCLA user from the LF SSO token on this route, and its Gerrit branch takes its return
   * address from the query string rather than from a stored session — so a prepare would open
   * a session nothing ever reads, and would need a GitHub account this path does not have.
   * The mis-resolution guards therefore stay on the GitHub path, where there is an account to
   * mis-resolve; they are neither weakened there nor stretched to cover a path without one.
   *
   * A full navigation, not a new tab, for the same reason as the GitHub hand-off: the Console
   * returns the contributor here afterwards, which only reads as one continuous flow if they
   * never left this tab.
   */
  private handOffToGerrit(option: ClaGroupOption): void {
    this.starting.set(true);

    // Read here rather than held as a field: this runs only from the contributor's click, so
    // the browser-only value is never touched during server-side rendering. The address is our
    // own origin, which is the same value the server derives from the request host for
    // prepare-sign — arrived at without needing that host to be checked against a trusted list.
    const returnUrl = `${this.document.location.origin}${MY_CLAS_PATH}`;
    const url = gerritSignUrl(environment.urls.contributorConsole, option.claGroupId, returnUrl);

    if (!url) {
      this.starting.set(false);
      this.reportGerritDestinationUnresolved();
      return;
    }

    this.starting.set(false);
    this.document.location.href = url;
  }

  private whenDialogSettles<T>(dialogRef: DynamicDialogRef, onSettle: (value: T | null | undefined) => void): void {
    let closed = false;

    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((value: T | null | undefined) => {
      closed = true;
      onSettle(value);
    });

    dialogRef.onDestroy.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      queueMicrotask(() => {
        if (!closed) {
          onSettle(undefined);
        }
      });
    });
  }

  /**
   * Opens the signing session, then navigates to the address that came back from it.
   *
   * A full navigation, not a new tab: the Console returns the contributor here afterwards, which
   * only reads as one continuous flow if they never left this tab.
   */
  private prepareThenHandOff(option: ClaGroupOption, account: GithubAccountOption): void {
    this.starting.set(true);

    this.myClasService
      .prepareSign({ githubId: account.githubId, claGroupId: option.claGroupId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (prepared: PrepareSignResponse) => {
          this.starting.set(false);

          // The account that came back must be the account that went in. Upstream verifies the
          // identity belongs to the caller, which every one of the contributor's own accounts
          // satisfies — so it cannot detect this layer having sent the wrong one. This
          // comparison is the only one that answers "will they sign as the account they picked",
          // and it is the reason the response carries the account at all.
          if (prepared.githubId !== account.githubId) {
            this.reportRecordedMismatch();
            return;
          }

          // Navigated to as returned. Composing this address from a console base, the group and
          // the user id would ignore the session the prepare just opened.
          this.document.location.href = prepared.signUrl;
        },
        error: (error: unknown) => {
          this.starting.set(false);
          this.reportPrepareFailure(error);
        },
      });
  }

  /**
   * Reports a failed prepare.
   *
   * An ownership refusal is repeated in the CLA backend's own words, because that endpoint ships
   * no machine-readable reason and inventing per-reason copy from its prose would put words in
   * its mouth. Every other failure — a missing CLA group, a rejected return address, an outage —
   * says nothing the contributor can act on differently, so they share one line.
   *
   * No refusal is ever recovered from by submitting a different account: that would open the
   * session against an account they did not choose, which is the failure this feature exists to
   * stop.
   */
  private reportPrepareFailure(error: unknown): void {
    const response = error as { status?: number; error?: { error?: unknown } } | undefined;
    const refusal = response?.status === 403 ? response.error?.error : undefined;

    this.messageService.add({
      severity: 'error',
      summary: 'Could not start signing',
      detail: typeof refusal === 'string' && refusal.trim() ? refusal : 'We could not open the CLA signing page. Please try again.',
    });
  }

  /**
   * Stops the hand-off when the account the CLA backend verified is not the chosen one.
   *
   * Its own message rather than the generic failure: nothing upstream went wrong, so telling the
   * contributor to try again is the honest instruction and "we could not open the page" is not.
   */
  private reportRecordedMismatch(): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Could not start signing',
      detail: "We couldn't confirm the account was recorded correctly, so we stopped before signing. Please try again.",
    });
  }

  /**
   * Stops a Gerrit hand-off whose destination could not be composed — an unset or unusable
   * Console address. Reported rather than navigated to: a malformed address would take the
   * contributor somewhere that cannot sign anything and cannot bring them back.
   */
  private reportGerritDestinationUnresolved(): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Could not start signing',
      detail: 'We could not open the CLA signing page. Please try again.',
    });
  }

  /** Stops a Gerrit hand-off when the session carries no username to show the contributor. */
  private reportGerritIdentityUnresolved(): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Could not start signing',
      detail: 'We could not confirm which identity you would sign with. Please try again.',
    });
  }

  /**
   * Takes the contributor to Identities, having asked for it from the picker's empty state.
   *
   * No accompanying message: the empty state they just acted on says the same thing, and a toast
   * repeating it on arrival reads as though something went wrong.
   */
  private sendToAccountLinking(): void {
    void this.router.navigate(['/profile/identities']);
  }

  /**
   * Explanatory note beneath the status pill. Only a completed Approved List
   * miss (`not_on_approval_list`) gets copy; unknown and omitted reasons do not.
   */
  private statusNote(agreement: MyClaAgreement): string | undefined {
    if (agreement.kind === 'ICLA' || agreement.statusReason !== 'not_on_approval_list') {
      return undefined;
    }
    if (agreement.companyName) {
      return `No longer matches ${agreement.companyName}'s approval criteria.`;
    }
    return 'No longer matches the approval criteria.';
  }

  /**
   * An ICLA with no retrievable document yields no items — the row then renders no ⋮ trigger,
   * rather than one that opens an empty overlay (`contracts/my-clas-row-actions.md`: nothing is
   * offered on such a row).
   *
   * A `revoked` row takes that path deliberately: it is read-only, and the ECLA fallback below
   * would otherwise tell someone whose employer failed sanctions screening that they are still
   * covered by a Corporate CLA.
   *
   * An invalidated ICLA also has no ⋮, matching the v17-after-legal HTML (FDC3): empty
   * `actionscell` even when a PDF exists. Invalidated ECLA is not drawn there and still
   * keeps Request Removal.
   *
   * `impersonating` greys out the write actions the two factories emit; Download PDF is built
   * without it, so the one action an administrator needs on someone else's row survives.
   */
  private buildRowMenuItems(agreement: MyClaAgreement, impersonating: boolean): MenuItem[] {
    if (agreement.status === 'revoked' || (agreement.kind === 'ICLA' && agreement.status === 'invalidated')) {
      return [];
    }
    if (agreement.pdfAvailable) {
      return [
        {
          label: 'Download PDF',
          icon: 'fa-light fa-download',
          command: () => this.onDownload(agreement),
        },
      ];
    }
    if (agreement.kind === 'ECLA') {
      return [
        {
          label: ECLA_COVERED_DOWNLOAD_LABEL,
          escape: false,
          icon: 'fa-light fa-download',
          disabled: true,
        },
        ...buildContactClaManagerMenuItems(agreement, this.dialogService, impersonating),
        ...buildManageInCclaConsoleMenuItems(agreement, impersonating),
      ];
    }
    return [];
  }

  private initState(): Signal<MyClasState> {
    return toSignal(
      this.refresh$.pipe(
        switchMap(() => {
          // Skip the fetch during SSR. The server's HTTP call doesn't carry the user's session
          // cookie reliably, so it tends to fail and bakes a false "Couldn't load your CLAs" error
          // into the SSR HTML — a red-banner flash on hydration before the browser fetch resolves.
          if (!isPlatformBrowser(this.platformId)) {
            return of<MyClasState>({ data: null, error: false, loaded: false });
          }

          return this.myClasService.getMyClas().pipe(
            switchMap((data) => of<MyClasState>({ data, error: false, loaded: true })),
            catchError(() => of<MyClasState>({ data: null, error: true, loaded: true }))
          );
        })
      ),
      { initialValue: { data: null, error: false, loaded: false } as MyClasState }
    );
  }

  private initRows(): Signal<ClaRow[]> {
    return computed(() => {
      const m2 = this.myClasM2Enabled();
      const impersonating = this.impersonating();
      return this.agreements().map((agreement) => {
        const menuItems = m2 ? this.buildRowMenuItems(agreement, impersonating) : [];
        return {
          id: agreement.id,
          agreement,
          status: {
            plainText: agreement.status === 'unknown',
            label: claStatusLabel(agreement.status),
            severity: claStatusSeverity(agreement.status),
            icon: this.statusIcon(agreement.status),
            note: this.statusNote(agreement),
          },
          signedAsLine: m2 ? signedAsLine(agreement.signedVia, agreement.signedAs) : undefined,
          menuItems,
          hasActions: menuItems.length > 0,
        };
      });
    });
  }
}
