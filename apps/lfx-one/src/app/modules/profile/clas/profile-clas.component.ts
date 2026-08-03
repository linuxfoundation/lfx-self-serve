// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, PLATFORM_ID, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type { MyClaAgreement, MyClasState } from '@lfx-one/shared/interfaces';
import { isMyClasEmpty } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { BehaviorSubject, catchError, of, switchMap } from 'rxjs';

import { BadgeComponent } from '@components/badge/badge.component';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MessageComponent } from '@components/message/message.component';
import { TableComponent } from '@components/table/table.component';
import { MyClasService } from '@services/my-clas.service';

/**
 * Read-only "My CLAs" Profile tab (Me lens). Renders the user's currently-valid signed CLAs
 * (ICLA + ECLA) from `/v4/my-clas` in a single table (Project / Type / Signed / Document) per
 * the approved M1 mockup — no status column, because the BFF filters to valid-only so every row
 * is valid. Agreements are resolved server-side from the session identity; ICLA PDFs open via
 * short-lived URLs.
 */
@Component({
  selector: 'lfx-profile-clas',
  imports: [DatePipe, RouterLink, BadgeComponent, ButtonComponent, EmptyStateComponent, MessageComponent, TableComponent, ToastModule],
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

  protected retry(): void {
    this.refresh$.next();
  }

  /**
   * Resolves the ICLA's short-lived PDF URL and opens it. A blank tab is opened
   * synchronously on click (before the async request) so the browser attributes it to the
   * user gesture and does not block the popup; its location is set once the URL resolves.
   */
  protected onDownload(signatureId: string): void {
    if (this.downloadingId()) return;

    // Open the blank tab WITHOUT `noopener` so we retain the window handle to redirect once the
    // URL resolves (`noopener` makes window.open return null). Sever the opener link manually for
    // the same reverse-tabnabbing protection `noopener` would provide.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    this.downloadingId.set(signatureId);

    this.myClasService.getPdfUrl(signatureId).subscribe({
      next: ({ url }) => {
        this.downloadingId.set(null);
        if (tab) {
          tab.location.href = url;
        } else {
          // Popup was blocked despite the synchronous open — fall back to a same-tab navigation.
          window.location.href = url;
        }
      },
      error: () => {
        this.downloadingId.set(null);
        tab?.close();
        this.messageService.add({ severity: 'error', summary: 'Download failed', detail: 'Could not open the signed document. Please try again.' });
      },
    });
  }
}
