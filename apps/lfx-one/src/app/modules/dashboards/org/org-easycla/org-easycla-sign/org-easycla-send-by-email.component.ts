// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, HostListener, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CCLA_SIGN_COPY, ORG_CLA_AUTHORITY_NAME_MAX_LENGTH, ORG_CLA_AUTHORITY_NAME_MIN_LENGTH } from '@lfx-one/shared/constants';
import type { OrgClaSendByEmailDialogData } from '@lfx-one/shared/interfaces';
import { isEmailShape, isSendableAuthorityName } from '@lfx-one/shared/utils';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { isBffValidationError, serverAuthoredMessage } from '@shared/utils/http-error.utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';

/**
 * Names a signatory and emails them the CCLA (#2365).
 *
 * Two entry points share this dialog: attestation **I am not authorized**, and the unsigned
 * Overview **Identify someone else**. It does not collect the self-sign attestation checkboxes,
 * and it does not send hardcoded `true` for them. The POST carries `sendAsEmail`, the name, and
 * the email — nothing else. Empty `signUrl` is success here; this dialog never navigates to
 * DocuSign.
 *
 * Distinct from the #1984 CLA Manager modal, which names a manager rather than a signatory.
 */
@Component({
  selector: 'lfx-org-easycla-send-by-email',
  imports: [ButtonComponent, InputTextComponent, ReactiveFormsModule],
  templateUrl: './org-easycla-send-by-email.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaSendByEmailComponent {
  public static readonly headingId = 'org-easycla-send-by-email-heading';

  private readonly ref = inject(DynamicDialogRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly claService = inject(OrgLensClaService);
  private readonly config = inject<DynamicDialogConfig<OrgClaSendByEmailDialogData>>(DynamicDialogConfig);

  protected readonly copy = CCLA_SIGN_COPY.sendByEmail;
  protected readonly headingId = OrgEasyclaSendByEmailComponent.headingId;
  protected readonly nameMaxLength = ORG_CLA_AUTHORITY_NAME_MAX_LENGTH;

  protected readonly state = signal<'identify' | 'sending' | 'sent' | 'failed'>('identify');
  protected readonly failureMessage = signal<string>(this.copy.failureBody);
  protected readonly sentTo = signal<string>('');

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(ORG_CLA_AUTHORITY_NAME_MIN_LENGTH), Validators.maxLength(ORG_CLA_AUTHORITY_NAME_MAX_LENGTH)],
    }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  protected readonly canSend = signal(false);

  /**
   * Per-field error text, or null while the field has nothing to complain about.
   *
   * Keyed off content rather than the control's touched flag, which is deliberate: the case these
   * exist for is a value that looks finished and is not — a one-character name, a half-typed
   * address — and waiting for blur would leave Send dead while the manager is still looking at
   * the field. An empty field stays silent, so a form nobody has filled in yet is not scolded.
   */
  protected readonly nameError = signal<string | null>(null);
  protected readonly emailError = signal<string | null>(null);

  protected readonly companyName = this.config.data?.companyName ?? '';
  protected readonly body = computed(() => this.copy.body(this.companyName));
  protected readonly successBody = computed(() => this.copy.successBody(this.sentTo()));
  protected readonly heading = computed(() => {
    switch (this.state()) {
      case 'sending':
        return this.copy.sendingHeader;
      case 'sent':
        return this.copy.successHeader;
      case 'failed':
        return this.copy.failureHeader;
      default:
        return this.copy.header;
    }
  });

  public constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      const name = this.form.controls.name.value.trim();
      const email = this.form.controls.email.value.trim();
      this.canSend.set(isSendableAuthorityName(name) && isEmailShape(email));
      this.nameError.set(name.length > 0 && !isSendableAuthorityName(name) ? this.copy.nameError(ORG_CLA_AUTHORITY_NAME_MIN_LENGTH) : null);
      this.emailError.set(email.length > 0 && !isEmailShape(email) ? this.copy.emailError : null);
    });
  }

  protected onSend(): void {
    const data = this.config.data;
    // Identify only. The Send control is `type="submit"` with both `(ngSubmit)` and `(onClick)`,
    // so a click can enter here twice. A `sending` guard is not enough: a synchronous success
    // (`of(...)`) has already moved the state to `sent` before the second entry, which would
    // post a second copy.
    if (!data || this.state() !== 'identify') return;

    const authorityName = this.form.controls.name.value.trim();
    const authorityEmail = this.form.controls.email.value.trim();
    if (!isSendableAuthorityName(authorityName) || !isEmailShape(authorityEmail)) return;

    // Drop the opener's uncommitted-context guard before the POST. Closing this on an
    // organization switch after Send would unsubscribe a request EasyCLA may already have
    // accepted, hide Email Sent, and let the manager send a second copy.
    this.config.data?.onRequestStarted?.();
    this.state.set('sending');
    this.claService
      .requestCorporateSignature(data.orgUid, {
        projectSfid: data.projectSfid,
        claGroupId: data.claGroupId,
        sendAsEmail: true,
        authorityName,
        authorityEmail,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // Stay in Org Lens. An empty signing address is success on this path (mail sent). A
          // https address would still not be navigated to — the named person signs, not this
          // browser.
          this.sentTo.set(authorityEmail);
          this.state.set('sent');
          this.config.data?.onMailed?.();
        },
        error: (error: unknown) => {
          this.failureMessage.set(this.messageFor(error));
          this.state.set('failed');
        },
      });
  }

  protected onCancel(): void {
    if (this.state() === 'sending') return;
    this.ref.close(null);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.state() === 'sending') return;
    this.ref.close(null);
  }

  /**
   * A 403 is a producer refusal written for the manager, and a 400 this BFF authored names the
   * field at fault. Both are shown in their own words. Everything else uses the generic send
   * fallback, matching the self-sign handoff's rule that only an actionable refusal is relayed.
   *
   * The 400 is matched on `VALIDATION_ERROR` rather than on the status, because the status alone
   * does not say who wrote the message. `gatewayFetch` rethrows an upstream refusal under the
   * upstream's own status, and `withProducerRefusalMessage` supplies a readable sentence only for
   * a 403 — so an upstream 400 arrives here with the message `gatewayFetch` built from the wire,
   * `Failed to request the corporate CLA signature: 400 Bad Request`. That path is reachable:
   * the producer's `authority_email` pattern refuses addresses this dialog deliberately allows,
   * such as an apostrophe in the local part or a TLD past ten letters. The code is the only thing
   * that distinguishes the two, and `ServiceValidationError` is the sole source of this one.
   */
  private messageFor(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return this.copy.failureBody;
    if (error.status !== 403 && !isBffValidationError(error)) return this.copy.failureBody;
    return serverAuthoredMessage(error, this.copy.failureBody).trim();
  }
}
