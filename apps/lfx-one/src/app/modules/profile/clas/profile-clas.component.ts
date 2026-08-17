// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type { ClaGroupOption, ClaStatus, MyClaAgreement, MyClasState, TagSeverity } from '@lfx-one/shared/interfaces';
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
 * One My CLAs table row, fully resolved before the template sees it. The template binds these
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
 * "My CLAs" Profile tab (Me lens). Lists every signed agreement (ICLA + ECLA)
 * from `/v4/my-clas` with a status column (Valid / Needs attention / Invalidated /
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
    const dialogRef = this.dialogService.open(ClaGroupSelectComponent, {
      header: 'Sign a CLA',
      width: '32rem',
      modal: true,
      closable: true,
      dismissableMask: true,
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((option: ClaGroupOption | null | undefined) => {
      if (option) this.handOffToConsole(option);
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
   * Resolves the Console URL for the chosen project and leaves the page.
   *
   * A full navigation, not a new tab: the Console returns the contributor here afterwards, which
   * only reads as one continuous flow if they never left this tab.
   */
  private handOffToConsole(option: ClaGroupOption): void {
    if (this.starting()) return;

    this.starting.set(true);

    this.myClasService
      .getSignUrl(option.claGroupId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (url) => {
          this.starting.set(false);
          this.document.location.href = url;
        },
        error: () => {
          this.starting.set(false);
          this.messageService.add({
            severity: 'error',
            summary: 'Could not start signing',
            detail: 'We could not open the CLA signing page. Please try again.',
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
