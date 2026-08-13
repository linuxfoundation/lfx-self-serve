// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type { ClaStatus, MyClaAgreement, MyClasState } from '@lfx-one/shared/interfaces';
import { claStatusLabel, claStatusSeverity, downloadFromUrl, isMyClasEmpty } from '@lfx-one/shared/utils';
import { MenuItem, MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { BehaviorSubject, catchError, of, switchMap } from 'rxjs';

import { BadgeComponent } from '@components/badge/badge.component';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MenuComponent } from '@components/menu/menu.component';
import { MessageComponent } from '@components/message/message.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { MyClasService } from '@services/my-clas.service';

/**
 * "My CLAs" Profile tab (Me lens). Lists every signed agreement (ICLA + ECLA)
 * from `/v4/my-clas` with a status column (Valid / Needs attention / Invalidated)
 * and a per-row actions menu. Status is derived server-side from the upstream
 * `approved`/`valid` flags until #1423 publishes it on the wire.
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
  providers: [MessageService],
  templateUrl: './profile-clas.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileClasComponent {
  private readonly myClasService = inject(MyClasService);
  private readonly messageService = inject(MessageService);
  private readonly platformId = inject(PLATFORM_ID);

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
      case 'superseded':
        return 'fa-light fa-clock-rotate-left';
    }
  }

  /**
   * Explanatory note beneath the status pill. Empty until #1423 publishes a
   * cause-specific reason — the slot exists so populating it is a data change.
   */
  protected statusNote(agreement: MyClaAgreement): string | undefined {
    void agreement;
    return undefined;
  }

  protected toggleRowMenu(event: Event, menu: MenuComponent): void {
    event.stopPropagation();
    menu.toggle(event);
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
