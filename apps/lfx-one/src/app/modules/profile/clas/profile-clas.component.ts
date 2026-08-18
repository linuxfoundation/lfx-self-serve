// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import type {
  ClaGroupOption,
  ClaStatus,
  GithubAccountOption,
  MyClaAgreement,
  MyClasState,
  SigningIdentityRefusal,
  SigningIdentityResponse,
  TagSeverity,
} from '@lfx-one/shared/interfaces';
import { claStatusLabel, claStatusSeverity, downloadFromUrl, isMyClasEmpty } from '@lfx-one/shared/utils';
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
import { MyClasService } from '@services/my-clas.service';
import { UserService } from '@services/user.service';

import { ClaGroupSelectComponent } from './cla-group-select.component';
import { GithubAccountSelectComponent } from './github-account-select.component';

/** Precomputed status cell for one row. */
interface ClaRowStatus {
  /** True for `unknown`, which renders as a plain-text em dash rather than a fourth named pill. */
  plainText: boolean;
  label: string;
  severity: TagSeverity;
  icon: string;
  /** Explanatory sentence beneath the pill; absent on every row that has nothing to explain. */
  note?: string;
}

/**
 * One CLAs table row, fully resolved before the template sees it. The template binds these
 * fields and calls nothing — per the frontend checklist's no-template-functions rule
 * (`docs/reviews/frontend-checklist.md`), which a per-cell `claStatusLabel(...)` /
 * `statusNote(...)` call would re-run on every change-detection pass.
 */
interface ClaRow {
  id: string;
  agreement: MyClaAgreement;
  status: ClaRowStatus;
  menuItems: MenuItem[];
  /** False ⇒ render no ⋮ trigger at all, rather than one that opens an empty menu. */
  hasActions: boolean;
}

/**
 * "CLAs" Profile tab (Me lens). Lists every signed agreement (ICLA + ECLA)
 * from `/v4/my-clas` with a status column (Valid / Needs attention / Revoked /
 * unknown as plain-text —) and a per-row actions menu. Status and reason are
 * copied from the producer; this component does not derive standing from
 * `approved`/`valid`.
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

  // signatureID currently resolving a PDF URL (drives the row's spinner + guards double-clicks).
  protected readonly downloadingId = signal<string | null>(null);

  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  private readonly state = toSignal(
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

  protected readonly loading = computed(() => !this.state().loaded);
  protected readonly error = computed(() => this.state().error);

  protected readonly agreements = computed<MyClaAgreement[]>(() => this.state().data?.agreements ?? []);
  protected readonly isEmpty = computed(() => isMyClasEmpty(this.state().loaded, this.state().error, this.agreements().length));

  /**
   * The table's only binding source. Recomputes when the agreement list changes and not
   * otherwise, which is also what keeps each row's `MenuItem[]` referentially stable —
   * a fresh model per change-detection pass makes the PrimeNG popup miss the first click.
   */
  protected readonly rows = computed<ClaRow[]>(() =>
    this.agreements().map((agreement) => {
      const menuItems = this.buildRowMenuItems(agreement);
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
        menuItems,
        hasActions: menuItems.length > 0,
      };
    })
  );

  // --- Sign CLA hand-off (#1251) -------------------------------------------

  /**
   * Withheld while impersonating. The server refuses the hand-off outright — impersonation is
   * read-only by platform rule, and a signature is a binding act that would be recorded against
   * the target rather than the administrator who performed it. Hiding it here just avoids
   * offering an action that cannot succeed; the server, not this flag, is the guard.
   */
  protected readonly canSign = computed(() => !this.userService.impersonating());

  /** True while the chosen group's hand-off URL is being resolved; also guards a double hand-off. */
  protected readonly starting = signal(false);

  protected retry(): void {
    this.refresh$.next();
  }

  protected toggleRowMenu(event: Event, menu: MenuComponent): void {
    event.stopPropagation();
    menu.toggle(event);
  }

  /**
   * Opens the picker, then hands off to whatever it closes with.
   *
   * A dynamic dialog rather than a `<p-dialog>` in this template, per the frontend checklist's
   * dialog rule and the sibling profile tabs.
   */
  protected openSignDialog(): void {
    // Guarded from the moment the picker opens, not from when a group is chosen. `starting` is
    // only set once the hand-off begins, which leaves the button live for as long as the picker
    // is open — long enough to open a second one and bind twice.
    if (this.starting()) return;
    this.starting.set(true);

    const dialogRef = this.dialogService.open(ClaGroupSelectComponent, {
      header: 'Sign a CLA',
      width: '32rem',
      modal: true,
      closable: true,
      dismissableMask: true,
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((option: ClaGroupOption | null | undefined) => {
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
    // Already flagged as in flight by `openSignDialog`, which owns the guard because the window
    // worth guarding opens with the picker rather than with this call.
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
      case 'invalidated':
        return 'fa-light fa-circle-xmark';
      case 'unknown':
        return 'fa-light fa-minus';
      case 'superseded':
        return 'fa-light fa-clock-rotate-left';
    }
  }

  /**
   * Routes on how many accounts are linked.
   *
   * One account skips the dialog but still binds — the screen is what is unnecessary when
   * there is nothing to choose between, not the confirmation. Dropping the binding too would
   * leave exactly the contributors this feature was built for on the old unpredictable path.
   */
  private chooseAccountThenSign(option: ClaGroupOption, accounts: GithubAccountOption[]): void {
    if (accounts.length === 0) {
      this.starting.set(false);
      this.sendToAccountLinking();
      return;
    }

    if (accounts.length === 1) {
      this.bindThenHandOff(option, accounts[0]);
      return;
    }

    const dialogRef = this.dialogService.open(GithubAccountSelectComponent, {
      header: 'Choose a GitHub account',
      width: '32rem',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { accounts },
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((githubId: string | null | undefined) => {
      if (!githubId) {
        this.starting.set(false);
        return;
      }

      // Resolved from the list the server served rather than taken from the dialog, so the
      // account submitted is always one of the accounts linked to this session. The upstream
      // records what it is sent, which is what makes where this value came from matter.
      const chosen = accounts.find((account) => account.githubId === githubId);
      if (!chosen) {
        this.starting.set(false);
        this.reportRecordedMismatch();
        return;
      }

      this.bindThenHandOff(option, chosen);
    });
  }

  /**
   * Records the choice, then navigates with the identifier that came back from it.
   *
   * A full navigation, not a new tab: the Console returns the contributor here afterwards, which
   * only reads as one continuous flow if they never left this tab.
   */
  private bindThenHandOff(option: ClaGroupOption, account: GithubAccountOption): void {
    this.starting.set(true);

    this.myClasService
      .bindSigningIdentity(account.githubId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (identity: SigningIdentityResponse) => {
          this.starting.set(false);

          // The account that came back must be the account that went in. Upstream confirms
          // the record holds the account it was sent, which cannot detect this layer having
          // sent the wrong one of the contributor's accounts in the first place. This
          // comparison is the only one that answers "did we sign as the account they
          // picked", and it is the reason the response carries the account at all.
          if (identity.githubId !== account.githubId) {
            this.reportRecordedMismatch();
            return;
          }

          this.document.location.href = this.myClasService.buildSignUrlFor(option.claGroupId, identity);
        },
        error: (error: unknown) => {
          this.starting.set(false);
          this.reportBindingRefusal(error);
        },
      });
  }

  /**
   * Turns a refusal into the message that fits it.
   *
   * Each reason calls for a different response from the contributor, so they are not collapsed
   * into one failure notice. In particular no refusal is ever recovered from by submitting a
   * different account — that would record the signature against an account they did not
   * choose, which is the failure this feature exists to stop.
   */
  private reportBindingRefusal(error: unknown): void {
    const reason = (error as { error?: { upstreamCode?: SigningIdentityRefusal } } | undefined)?.error?.upstreamCode;

    this.messageService.add({
      severity: 'error',
      summary: 'Could not start signing',
      detail: this.refusalDetail(reason),
    });
  }

  /**
   * Stops the hand-off when the recorded account is not the chosen one.
   *
   * Deliberately the same message the service's own mismatch refusal produces: from the
   * contributor's side it is the same event, and the difference — which layer noticed —
   * belongs in the logs rather than on screen.
   */
  private reportRecordedMismatch(): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Could not start signing',
      detail: this.refusalDetail('recorded_mismatch'),
    });
  }

  private refusalDetail(reason: SigningIdentityRefusal | undefined): string {
    switch (reason) {
      case 'identity_unavailable':
      case 'identity_mismatch':
        return 'We could not confirm who is signed in. Please sign in again and retry.';
      case 'record_conflict':
      case 'duplicate_github_id':
      case 'record_unclaimed':
        // Distinct upstream, deliberately one message here. All three mean an existing CLA
        // record stands in the way and only a human can say whose it is; the contributor can
        // do nothing differently, so naming the difference would only ask them to.
        return 'That GitHub account is already associated with a different CLA record. Please contact support.';
      case 'lf_record_already_bound':
        // Kept apart from the three above even though it also ends in support, because it points
        // the opposite way: there the account belongs to another record, here the contributor's
        // own record already holds a different account. Only one is recordable at a time.
        return 'Your CLA record already has a different GitHub account. Signing with a second account is not supported yet — please contact support.';
      case 'recorded_mismatch':
        return "We couldn't confirm the account was recorded correctly, so we stopped before signing. Please try again.";
      default:
        return 'We could not open the CLA signing page. Please try again.';
    }
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
   */
  private buildRowMenuItems(agreement: MyClaAgreement): MenuItem[] {
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
          label: 'Covered by Corporate CLA (CCLA)',
          disabled: true,
        },
      ];
    }
    return [];
  }
}
