// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CCLA_SIGN_COPY } from '@lfx-one/shared/constants';
import type { OrgClaSignHandoffDialogData, OrgClaSignResponse } from '@lfx-one/shared/interfaces';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { serverAuthoredMessage } from '@shared/utils/http-error.utils';
import { stashSignedSignatureId } from '@shared/utils/org-cla-signed-signature.util';
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

  /** Shell-dialog title per state, so the frame never contradicts the panel inside it. */
  private readonly headerFor: Record<'preparing' | 'ready' | 'failed', string> = {
    preparing: CCLA_SIGN_COPY.preparing.header,
    ready: CCLA_SIGN_COPY.ready.header,
    failed: CCLA_SIGN_COPY.failure.header,
  };

  public constructor() {
    this.enter('preparing');

    const data = this.config.data;
    if (!data) {
      this.enter('failed');
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
            this.enter('failed');
            return;
          }
          this.prepared.set(response);
          this.enter('ready');
        },
        error: (error: unknown) => {
          this.failureMessage.set(this.messageFor(error));
          this.enter('failed');
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

    // Stashed before the navigation, because after it there is no code of ours left running. The
    // signatory returns to `/org/easycla` through a cross-site redirect whose address was fixed
    // before this signature existed, so this is the only moment at which anything in the browser
    // knows which agreement they are about to sign.
    stashSignedSignatureId(prepared.signatureId);

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
   * Moves to a state and dresses the shell dialog to match, in one step.
   *
   * The shell is PrimeNG's and reads `header`, `closable` and `closeOnEscape` off this config
   * object as it renders. They are plain properties rather than signals, so nothing re-renders the
   * shell when they change: written from an effect — which runs *after* the pass that has already
   * drawn the frame — the title and the dismiss controls would describe the state before this one,
   * and stay that way until some unrelated event happened to schedule another pass. Writing them
   * with the state is what keeps the frame from contradicting the panel inside it.
   *
   * The dialog cannot be dismissed while the request is in flight, and still cannot once it
   * succeeds. The signature record and the DocuSign envelope are created by that one call, and
   * the address it returns is the only copy — so every exit before the signatory follows it
   * abandons a real agreement upstream, which this application has no way to cancel or reuse.
   * Sealing only the in-flight window would close the smaller of the two holes: the request
   * usually answers in under a second, while `ready` waits for a person.
   *
   * `failed` is the one dismissible state. There is no envelope to strand, and trapping someone
   * in a dialog that reports a failure would leave them no way out at all.
   */
  private enter(state: 'preparing' | 'ready' | 'failed'): void {
    const dismissible = state === 'failed';

    this.state.set(state);
    this.config.header = this.headerFor[state];
    this.config.closable = dismissible;
    this.config.closeOnEscape = dismissible;
  }

  /**
   * A refusal the CLA service explained is shown in its own words.
   *
   * It answers a trade-compliance hold with a sentence naming the reason and the support route,
   * and a missing signing authority with a statement about the caller's scope. Both are 403s, and
   * both are more useful than anything this layer could write — the compliance wording in
   * particular is maintained upstream and will change when the process does. Everything else
   * shares one message, because there is nothing in it the signatory could act on differently.
   *
   * Read through the shared helper rather than by hand. The BFF answers a relayed refusal with
   * the sentence under `error` (`BaseApiError#toResponse`) and its own validation replies with it
   * under `message`, so a reader that reaches for one spelling drops the other — and dropping
   * `error` is dropping every refusal this relay exists for.
   */
  private messageFor(error: unknown): string {
    if (!(error instanceof HttpErrorResponse) || error.status !== 403) return CCLA_SIGN_COPY.failure.body;
    return serverAuthoredMessage(error, CCLA_SIGN_COPY.failure.body).trim();
  }
}
