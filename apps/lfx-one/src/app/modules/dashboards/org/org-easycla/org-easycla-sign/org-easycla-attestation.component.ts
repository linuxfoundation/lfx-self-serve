// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { CCLA_SIGN_COPY } from '@lfx-one/shared/constants';
import type { OrgClaSignAttestations } from '@lfx-one/shared/interfaces';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';

/**
 * The authorization and export-compliance confirmations, ahead of the corporate signing hand-off
 * (#1983).
 *
 * Every string it renders comes from `CCLA_SIGN_COPY.attestation`, verbatim from the approved
 * design. This is the first attestation the product renders itself — every earlier CLA surface
 * handed off to another product before any attestation appeared — so the wording is a reviewed
 * artifact, not copy. Do not paraphrase it here, and do not inline a variant.
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

  protected readonly copy = CCLA_SIGN_COPY.attestation;

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
    if (!authorityAcked || !embargoAcked) return;

    const attestations: OrgClaSignAttestations = { authorityAcked, embargoAcked };
    this.ref.close(attestations);
  }

  protected onCancel(): void {
    this.ref.close(null);
  }
}
