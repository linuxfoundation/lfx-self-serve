// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CCLA_SIGN_COPY } from '@lfx-one/shared/constants';
import type { OrgClaSignHandoffDialogData, OrgClaSignResponse } from '@lfx-one/shared/interfaces';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';

/**
 * Opens the corporate signing session, then hands the signatory off to it (#1983).
 *
 * The request is made when this dialog opens — that is, on the signatory's Continue from the
 * attestation step — rather than on the Review and Sign control below. It is not a rehearsal: the
 * CLA service persists a signature record and opens a DocuSign envelope in the same call, and
 * there is no shape of the request that yields a signing address without doing so. Given that,
 * every failure it can produce is better surfaced *before* the signatory's final commitment than
 * after it. Waiting would not avoid the envelope; it would only mean telling somebody who has
 * just pressed "sign" that nothing happened.
 *
 * The consequence is that backing out here leaves a sent envelope behind. That belongs to the CLA
 * service, which already voids them, and is not cleaned up from this side.
 */
@Component({
  selector: 'lfx-org-easycla-sign-handoff',
  imports: [ButtonComponent],
  templateUrl: './org-easycla-sign-handoff.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaSignHandoffComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly claService = inject(OrgLensClaService);
  private readonly document = inject(DOCUMENT);
  private readonly config = inject<DynamicDialogConfig<OrgClaSignHandoffDialogData>>(DynamicDialogConfig);

  protected readonly copy = CCLA_SIGN_COPY;

  protected readonly state = signal<'preparing' | 'ready' | 'failed'>('preparing');
  /** The CLA service's own words for a refusal it explained; the generic copy otherwise. */
  protected readonly failureMessage = signal<string>(CCLA_SIGN_COPY.failure.body);

  private readonly prepared = signal<OrgClaSignResponse | null>(null);

  public constructor() {
    const data = this.config.data;
    if (!data) {
      this.state.set('failed');
      return;
    }

    this.claService
      .requestCorporateSignature(data.orgUid, {
        projectSfid: data.projectSfid,
        claGroupId: data.claGroupId,
        // Relayed exactly as the attestation step recorded them. Writing `true` here would make
        // the client's own disabled state the only record that the signatory ever confirmed
        // anything, and would keep sending an affirmation after that state regressed.
        authorityAcked: data.attestations.authorityAcked,
        embargoAcked: data.attestations.embargoAcked,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          // The server already rejects an empty address as a failed hand-off; this is the second
          // line, because the cost of being wrong is navigating to this application's own root
          // and reading as a completed signature.
          if (!response.signUrl) {
            this.state.set('failed');
            return;
          }
          this.prepared.set(response);
          this.state.set('ready');
        },
        error: (error: unknown) => {
          this.failureMessage.set(this.messageFor(error));
          this.state.set('failed');
        },
      });
  }

  /**
   * A full navigation, not a new context: EasyCLA returns the signatory to the Organization Lens
   * afterwards, which only reads as one flow if they never left this tab.
   */
  protected onReviewAndSign(): void {
    const prepared = this.prepared();
    if (!prepared?.signUrl) return;

    // Closed before the navigation, which releases the page's single-flight flag. A full-page
    // navigation is not a teardown: a Back out of DocuSign can restore this page from bfcache
    // exactly as it left it, and a flag still set there disables Sign CLA until a manual reload.
    this.ref.close(prepared);

    // Navigated to as returned. Composing this from a console base and the identifiers would
    // ignore the session the request just opened.
    this.document.location.href = prepared.signUrl;
  }

  protected onCancel(): void {
    this.ref.close(null);
  }

  /**
   * A refusal the CLA service explained is shown in its own words.
   *
   * It answers a trade-compliance hold with a sentence naming the reason and the support route,
   * and a missing signing authority with a statement about the caller's scope. Both are 403s, and
   * both are more useful than anything this layer could write — the compliance wording in
   * particular is maintained upstream and will change when the process does. Everything else
   * shares one message, because there is nothing in it the signatory could act on differently.
   */
  private messageFor(error: unknown): string {
    const message = (error as { error?: { message?: unknown } } | null)?.error?.message;
    const status = (error as { status?: unknown } | null)?.status;

    if (status === 403 && typeof message === 'string' && message.trim()) {
      return message.trim();
    }
    return CCLA_SIGN_COPY.failure.body;
  }
}
