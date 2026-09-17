// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, HostListener, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CCLA_SIGN_COPY, ORG_CLA_AUTHORITY_NAME_MAX_LENGTH, ORG_CLA_AUTHORITY_NAME_MIN_LENGTH } from '@lfx-one/shared/constants';
import type { OrgClaSendByEmailDialogData } from '@lfx-one/shared/interfaces';
import { codePointLength, isEmailShape, isSendableAuthorityName } from '@lfx-one/shared/utils';
import { maxCodePointsValidator } from '@lfx-one/shared/validators';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { isBffValidationError, serverAuthoredMessage } from '@shared/utils/http-error.utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

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
  /** True once the overlay is gone; the POST may still complete and must still lock the opener. */
  private destroyed = false;

  protected readonly copy = CCLA_SIGN_COPY.sendByEmail;
  protected readonly headingId = OrgEasyclaSendByEmailComponent.headingId;

  protected readonly state = signal<'identify' | 'sending' | 'sent' | 'failed'>('identify');
  protected readonly failureMessage = signal<string>(this.copy.failureBody);
  protected readonly sentTo = signal<string>('');

  // The length bound uses maxCodePointsValidator, not Validators.maxLength: the producer's
  // `authority_name` MaxLength counts Unicode code points, not the UTF-16 code units
  // Validators.maxLength counts, so a non-BMP name could be upstream-valid yet refused here.
  // `isSendableAuthorityName` owns the floor, for the same reason — Validators.minLength would
  // read a single non-BMP character as two and admit a name the producer counts as one.
  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, maxCodePointsValidator(ORG_CLA_AUTHORITY_NAME_MAX_LENGTH)] }),
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
  // Mirrors the self-sign hand-off's `headerFor`, keeping the two signing dialogs structurally
  // identical. Exhaustive over the state union, so a state added without a header fails to compile
  // rather than silently falling through to the identify heading.
  private readonly headerFor: Record<'identify' | 'sending' | 'sent' | 'failed', string> = {
    identify: this.copy.header,
    sending: this.copy.sendingHeader,
    sent: this.copy.successHeader,
    failed: this.copy.failureHeader,
  };

  protected readonly heading = computed(() => this.headerFor[this.state()]);

  public constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      const name = this.form.controls.name.value.trim();
      const email = this.form.controls.email.value.trim();
      this.canSend.set(isSendableAuthorityName(name) && isEmailShape(email));
      this.nameError.set(this.nameErrorFor(name));
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
    // organization switch after Send would hide Email Sent. The POST itself survives
    // destroy (`take(1)` below); the manager should still see the result.
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
      // take(1), not takeUntilDestroyed. Unsubscribing cancels the in-flight POST, so EasyCLA can
      // still mail the signatory while onMailed never runs — Close then offers Identify someone
      // else again. The overlay may be gone by the time this returns; the opener lock still must
      // land. Same shape as the approval-list write: the request completes, local UI is skipped.
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.config.data?.onMailed?.();
          if (this.destroyed) return;
          // Stay in Org Lens. An empty signing address is success on this path (mail sent). A
          // https address would still not be navigated to — the named person signs, not this
          // browser.
          this.sentTo.set(authorityEmail);
          this.state.set('sent');
        },
        error: (error: unknown) => {
          if (this.destroyed) return;
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
  /**
   * Which bound the name missed, or null while it has nothing to complain about.
   *
   * Both bounds are counted in code points, matching `isSendableAuthorityName` and the producer.
   * The upper one is reachable from this form: nothing truncates the input, because a native
   * `maxlength` counts UTF-16 units and would cut a non-BMP name off at half the real cap.
   */
  private nameErrorFor(trimmedName: string): string | null {
    if (trimmedName.length === 0 || isSendableAuthorityName(trimmedName)) return null;
    if (codePointLength(trimmedName) > ORG_CLA_AUTHORITY_NAME_MAX_LENGTH) return this.copy.nameTooLongError(ORG_CLA_AUTHORITY_NAME_MAX_LENGTH);
    return this.copy.nameError(ORG_CLA_AUTHORITY_NAME_MIN_LENGTH);
  }

  private messageFor(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return this.copy.failureBody;
    if (error.status !== 403 && !isBffValidationError(error)) return this.copy.failureBody;
    return serverAuthoredMessage(error, this.copy.failureBody).trim();
  }
}
