// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { CHARTER_URL_MAX_LENGTH, CHARTER_URL_PATTERN } from '@lfx-one/shared/constants';
import { CharterDialogData } from '@lfx-one/shared/interfaces';
import { maxCodePointsValidator } from '@lfx-one/shared/validators';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-charter-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent],
  templateUrl: './charter-dialog.component.html',
})
export class CharterDialogComponent {
  private readonly config = inject(DynamicDialogConfig<CharterDialogData>);
  private readonly ref = inject(DynamicDialogRef);

  public readonly url = this.config.data.url;

  // CHARTER_URL_PATTERN/CHARTER_URL_MAX_LENGTH mirror the backend's contract exactly, so a
  // client-valid value is guaranteed API-valid. Validators.pattern treats an empty value as valid
  // regardless of the pattern, so clearing the field (the charter-removal signal) is never blocked
  // by this validator. The length bound uses maxCodePointsValidator, not Validators.maxLength: the
  // backend's Goa MaxLength(2048) counts Unicode code points (utf8.RuneCountInString), not the
  // UTF-16 code units Validators.maxLength counts, so a non-BMP-heavy URL could be upstream-valid
  // yet wrongly rejected here.
  public charterForm = new FormGroup({
    url: new FormControl(this.url, [Validators.pattern(CHARTER_URL_PATTERN), maxCodePointsValidator(CHARTER_URL_MAX_LENGTH)]),
  });

  public cancel(): void {
    this.ref.close();
  }

  public save(): void {
    if (this.charterForm.invalid) {
      return;
    }
    const newUrl = this.charterForm.get('url')?.value || '';
    this.ref.close(newUrl);
  }
}
