// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { CLA_GROUP_SEARCH_DEBOUNCE_MS } from '@lfx-one/shared/constants';
import type { ClaGroupOption, ClaStatus, MyClaAgreement, MyClasState } from '@lfx-one/shared/interfaces';
import { claStatusLabel, claStatusSeverity, downloadFromUrl, isMyClasEmpty } from '@lfx-one/shared/utils';
import { MenuItem, MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { BehaviorSubject, catchError, debounceTime, of, Subject, switchMap, tap } from 'rxjs';

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
    ClaGroupSelectComponent,
    EmptyStateComponent,
    MenuComponent,
    MessageComponent,
    TableComponent,
    TagComponent,
    ToastModule,
  ],
  providers: [MessageService],
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
  protected readonly menuItemsMap: Signal<Map<string, MenuItem[]>> = this.initMenuItemsMap();

  protected readonly claStatusLabel = claStatusLabel;
  protected readonly claStatusSeverity = claStatusSeverity;

  // --- Sign CLA hand-off (#1251) -------------------------------------------

  /**
   * Withheld while impersonating. The server refuses the hand-off outright — impersonation is
   * read-only by platform rule, and a signature is a binding act that would be recorded against
   * the target rather than the administrator who performed it. Hiding it here just avoids
   * offering an action that cannot succeed; the server, not this flag, is the guard.
   */
  protected readonly canSign = computed(() => !this.userService.impersonating());

  protected readonly selectVisible = signal(false);
  protected readonly claGroupOptions = signal<ClaGroupOption[]>([]);
  protected readonly optionsLoading = signal(false);
  protected readonly optionsError = signal(false);

  /** True while the chosen group's hand-off URL is being resolved; also guards a double hand-off. */
  protected readonly starting = signal(false);

  private readonly search$ = new Subject<string>();

  public constructor() {
    // Searching upstream (rather than filtering the fetched list here) is what lets #1250 replace
    // the route's stub with the real four-source search without touching this page.
    this.search$
      .pipe(
        debounceTime(CLA_GROUP_SEARCH_DEBOUNCE_MS),
        tap(() => {
          this.optionsLoading.set(true);
          this.optionsError.set(false);
        }),
        switchMap((query) =>
          this.myClasService.getClaGroupOptions(query).pipe(
            catchError(() => {
              this.optionsError.set(true);
              return of<ClaGroupOption[] | null>(null);
            })
          )
        ),
        takeUntilDestroyed()
      )
      .subscribe((options) => {
        this.optionsLoading.set(false);
        if (options) this.claGroupOptions.set(options);
      });
  }

  protected retry(): void {
    this.refresh$.next();
  }

  /** Per-state leading icon for the status pill. Exhaustive against ClaStatus. */
  protected statusIcon(status: ClaStatus): string {
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
  protected statusNote(agreement: MyClaAgreement): string | undefined {
    if (agreement.kind === 'ICLA' || agreement.statusReason !== 'not_on_approval_list') {
      return undefined;
    }
    if (agreement.companyName) {
      return `No longer matches ${agreement.companyName}'s approval criteria.`;
    }
    return 'No longer matches the approval criteria.';
  }

  protected toggleRowMenu(event: Event, menu: MenuComponent): void {
    event.stopPropagation();
    menu.toggle(event);
  }

  protected openSignDialog(): void {
    this.claGroupOptions.set([]);
    this.optionsError.set(false);
    this.optionsLoading.set(false);
    this.selectVisible.set(true);
  }

  protected onClaGroupSearch(query: string): void {
    this.search$.next(query);
  }

  /**
   * Resolves the Console URL for the chosen project and leaves the page.
   *
   * A full navigation, not a new tab: the Console returns the contributor here afterwards, which
   * only reads as one continuous flow if they never left this tab.
   */
  protected onClaGroupConfirmed(option: ClaGroupOption): void {
    if (this.starting()) return;

    this.starting.set(true);

    this.myClasService
      .getSignUrl(option.claGroupId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (url) => {
          this.starting.set(false);
          this.selectVisible.set(false);
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
   * Stable per-row menu models. Binding a fresh `MenuItem[]` from the template on every
   * change-detection pass makes the PrimeNG popup overlay miss the first click.
   */
  private initMenuItemsMap(): Signal<Map<string, MenuItem[]>> {
    return computed(() => {
      const map = new Map<string, MenuItem[]>();
      for (const agreement of this.agreements()) {
        map.set(agreement.id, this.buildRowMenuItems(agreement));
      }
      return map;
    });
  }

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
