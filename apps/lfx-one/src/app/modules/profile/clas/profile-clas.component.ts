// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { MyClaAgreement, MyClasResponse } from '@lfx-one/shared/interfaces';
import { isMyClasEmpty, shouldShowGithubCta, splitAgreementsByKind } from '@lfx-one/shared/utils';
import { environment } from '@environments/environment';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { BehaviorSubject, catchError, of, switchMap } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MessageComponent } from '@components/message/message.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { MyClasService } from '@services/my-clas.service';
import { AgreementCardComponent } from './agreement-card/agreement-card.component';

interface MyClasState {
  data: MyClasResponse | null;
  error: boolean;
  loaded: boolean;
}

/**
 * Read-only "My CLAs" Profile tab (Me lens). Lists the user's signed ICLAs (any status,
 * labeled) and currently valid ECLAs, resolved server-side from the session identity.
 * Signing links out to the EasyCLA Contributor Console; ICLA PDFs open via short-lived URLs.
 */
@Component({
  selector: 'lfx-profile-clas',
  imports: [RouterLink, AgreementCardComponent, ButtonComponent, CardComponent, EmptyStateComponent, MessageComponent, RouteLoadingComponent, ToastModule],
  providers: [MessageService],
  templateUrl: './profile-clas.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileClasComponent {
  private readonly myClasService = inject(MyClasService);
  private readonly messageService = inject(MessageService);

  protected readonly contributorConsoleUrl = environment.urls.contributorConsole;

  // signatureID currently resolving a PDF URL (drives the row's spinner + guards double-clicks).
  protected readonly downloadingId = signal<string | null>(null);

  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  private readonly state = toSignal(
    this.refresh$.pipe(
      switchMap(() =>
        this.myClasService.getMyClas().pipe(
          switchMap((data) => of<MyClasState>({ data, error: false, loaded: true })),
          catchError(() => of<MyClasState>({ data: null, error: true, loaded: true }))
        )
      )
    ),
    { initialValue: { data: null, error: false, loaded: false } as MyClasState }
  );

  protected readonly loading = computed(() => !this.state().loaded);
  protected readonly error = computed(() => this.state().error);
  protected readonly identity = computed(() => this.state().data?.identity);

  private readonly agreements = computed<MyClaAgreement[]>(() => this.state().data?.agreements ?? []);
  protected readonly iclas = computed(() => splitAgreementsByKind(this.agreements()).iclas);
  protected readonly eclas = computed(() => splitAgreementsByKind(this.agreements()).eclas);
  protected readonly isEmpty = computed(() => isMyClasEmpty(this.state().loaded, this.state().error, this.agreements().length));
  protected readonly showGithubCta = computed(() => shouldShowGithubCta(this.identity()));

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
