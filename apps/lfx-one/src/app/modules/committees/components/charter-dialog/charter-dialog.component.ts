// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { CharterDialogData } from '@lfx-one/shared/interfaces';
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

  // Mirrors the backend's charterURLPattern/MaxLength(2048) exactly (cmd/committee-api/design/type.go
  // in lfx-v2-committee-service) so a client-valid value is guaranteed API-valid -- no bare-host
  // rejection (`http://committee/charter` is contract-valid, unlike the general `website` field's
  // pattern) and no whitespace/length values that would pass here but fail upstream. Validators.pattern
  // treats an empty value as valid regardless of the pattern, so clearing the field (the
  // charter-removal signal) is never blocked by this validator.
  public charterForm = new FormGroup({
    url: new FormControl(this.url, [Validators.pattern(/^https?:\/\/[^\s/$.?#][^\s]*$/), Validators.maxLength(2048)]),
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
