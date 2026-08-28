// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal, viewChildren } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { ECLA_COVERED_DOWNLOAD_LABEL, MY_CLAS_M2_ENABLED_FLAG } from '@lfx-one/shared/constants';
import type { ClaGroupOption, ClaRow, ClaStatus, GithubAccountOption, MyClaAgreement, MyClasState, PrepareSignResponse } from '@lfx-one/shared/interfaces';
import { claStatusLabel, claStatusSeverity, downloadFromUrl, isMyClasEmpty, signedAsLine } from '@lfx-one/shared/utils';
import { MenuItem, MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { ToastModule } from 'primeng/toast';
import { BehaviorSubject, catchError, of, switchMap, take } from 'rxjs';

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
import { GithubAccountSelectComponent } from './github-account-select.component';
import { buildManageInCclaConsoleMenuItems } from './manage-ccla-console-menu';

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
    if (!this.myClasM2Enabled() || this.impersonating() || this.starting() || this.signDialogOpen()) return;
    this.signDialogOpen.set(true);

    const dialogRef = this.dialogService.open(ClaGroupSelectComponent, {
      header: 'Sign a CLA',
      width: '32rem',
      modal: true,
      closable: true,
      dismissableMask: true,
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
   * Settles which GitHub account the signature will be recorded against, then leaves for the
   * Console (#1252).
   *
   * The account step comes before the hand-off rather than after because the association is
   * what the Console's signature is recorded against; deciding it afterwards would mean the
   * contributor had already signed by the time anyone knew as whom.
   */
  private handOffToConsole(option: ClaGroupOption): void {
    this.starting.set(true);
    this.myClasService
      .getGithubAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ accounts }) => this.chooseAccountThenSign(option, accounts),
        error: () => {
          this.starting.set(false);
          // Explicitly not treated as "no accounts linked". The two are indistinguishable in
          // the payload but not in consequence: sending someone who already linked an account
          // into account-linking asks them to fix something that is not broken.
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
   * Routes on whether any account is linked at all: none goes to linking, any number is asked.
   *
   * A single account is asked for too. What the screen carries is which identity the signature
   * will be recorded against, and a list of one says that as plainly as a list of two — so there
   * is something to show even where there is nothing to choose between.
   */
  private chooseAccountThenSign(option: ClaGroupOption, accounts: GithubAccountOption[]): void {
    if (accounts.length === 0) {
      this.starting.set(false);
      this.sendToAccountLinking();
      return;
    }

    this.starting.set(false);
    this.signDialogOpen.set(true);

    const dialogRef = this.dialogService.open(GithubAccountSelectComponent, {
      header: 'Choose a GitHub account',
      width: '32rem',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { accounts },
    }) as DynamicDialogRef;

    this.whenDialogSettles<string>(dialogRef, (githubId) => {
      this.signDialogOpen.set(false);
      if (!githubId) {
        this.starting.set(false);
        return;
      }

      // Resolved from the list the server served rather than taken from the dialog, so the
      // account submitted is always one of the accounts linked to this session. Ownership
      // verification upstream passes for every account the contributor holds, which is what
      // makes where this value came from matter.
      const chosen = accounts.find((account) => account.githubId === githubId);
      if (!chosen) {
        this.starting.set(false);
        this.reportRecordedMismatch();
        return;
      }

      this.prepareThenHandOff(option, chosen);
    });
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

  private sendToAccountLinking(): void {
    this.messageService.add({
      severity: 'info',
      summary: 'Link a GitHub account',
      detail: 'Connect the GitHub account you contribute with, then start signing again.',
    });
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
