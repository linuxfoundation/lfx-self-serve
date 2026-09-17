// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { CCLA_SIGN_COPY } from '@lfx-one/shared/constants';
import type { OrgClaAttestationDialogData, OrgClaSendByEmailChoice, OrgClaSignAttestations } from '@lfx-one/shared/interfaces';
import { orgClaSignForbiddenToast } from '@lfx-one/shared/utils';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { MessageService } from 'primeng/api';
import { DynamicDialog, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { take, takeUntil } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';

/**
 * The authorization and export-compliance confirmations, ahead of the corporate signing hand-off
 * (#1983).
 *
 * Every string it renders comes from `CCLA_SIGN_COPY.attestation`, verbatim from the M3
 * prototype. This is the first attestation the product renders itself — every earlier CLA surface
 * handed off to another product before any attestation appeared — so the wording is a single
 * defined artifact, not copy. Do not paraphrase it here, and do not inline a variant.
 *
 * Closes with the two confirmations as the signatory actually left them, or `null` if they backed
 * out. It deliberately does **not** close with a bare "confirmed" signal: the values are what the
 * request transmits, and reconstructing them at the caller would mean the caller asserting an
 * attestation rather than relaying one.
 */
@Component({
  selector: 'lfx-org-easycla-attestation',
  imports: [ButtonComponent, CheckboxComponent],
  templateUrl: './org-easycla-attestation.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaAttestationComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly destroyRef = inject(DestroyRef);
  /** Present in the real overlay. Tests stub it so Escape-during-animation can be pinned. */
  private readonly hostDialog = inject(DynamicDialog, { optional: true });
  private readonly config = inject<DynamicDialogConfig<OrgClaAttestationDialogData>>(DynamicDialogConfig);
  private readonly claService = inject(OrgLensClaService);
  private readonly messageService = inject(MessageService);

  protected readonly copy = CCLA_SIGN_COPY.attestation;
  /** Pair-level ACS check in flight; Continue stays disabled so a second click cannot race it. */
  protected readonly checkingPair = signal(false);

  /** Both start unticked. Nothing in this flow pre-affirms either one. */
  protected readonly form = new FormGroup({
    authorityAcked: new FormControl<boolean>(false, { nonNullable: true }),
    embargoAcked: new FormControl<boolean>(false, { nonNullable: true }),
  });

  /**
   * Mirrors the form rather than being derived in the template, so withdrawing a confirmation
   * re-disables the control on the same change that cleared it.
   */
  protected readonly bothAcked = signal(false);

  public constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.bothAcked.set(this.form.controls.authorityAcked.value === true && this.form.controls.embargoAcked.value === true);
    });
  }

  protected onContinue(): void {
    const authorityAcked = this.form.controls.authorityAcked.value === true;
    const embargoAcked = this.form.controls.embargoAcked.value === true;

    // Re-read from the controls at the moment of the click rather than trusting the disabled
    // state that led here. The disabled control is the safeguard; this is the record. If the two
    // ever disagree, the one that matters legally is what the signatory actually set, and closing
    // with a literal `true` would make that disagreement undetectable everywhere downstream.
    if (!authorityAcked || !embargoAcked || this.checkingPair()) return;

    const orgUid = this.config.data?.orgUid;
    const projectSfid = this.config.data?.projectSfid;
    if (!orgUid || !projectSfid) {
      this.messageService.add(orgClaSignForbiddenToast());
      return;
    }

    this.checkingPair.set(true);
    this.claService
      .checkPermission(orgUid, 'sign', projectSfid)
      // `close()` emits `onClose` immediately and only destroys the component after the leave
      // animation. `takeUntilDestroyed` is too late: an allow in that gap would `close` with
      // attestations and the parent would open the hand-off. Cancel emits `onClose` (null);
      // Escape / mask set `visible` false without `onClose` until we would emit one.
      .pipe(take(1), takeUntil(this.ref.onClose), takeUntilDestroyed(this.destroyRef))
      .subscribe((allowed) => {
        this.checkingPair.set(false);
        if (this.hostDialog?.visible === false) return;
        // Re-read after the hop: both boxes stay editable until this returns, and a captured
        // `{ true, true }` from the click would record an affirmation the signatory withdrew.
        const stillAcked = this.form.controls.authorityAcked.value === true && this.form.controls.embargoAcked.value === true;
        if (!allowed) {
          this.messageService.add(orgClaSignForbiddenToast());
          return;
        }
        if (!stillAcked) return;
        this.ref.close({
          authorityAcked: true,
          embargoAcked: true,
        } satisfies OrgClaSignAttestations);
      });
  }

  protected onNotAuthorized(): void {
    const choice: OrgClaSendByEmailChoice = { sendByEmail: true };
    this.ref.close(choice);
  }

  protected onCancel(): void {
    this.ref.close(null);
  }
}
