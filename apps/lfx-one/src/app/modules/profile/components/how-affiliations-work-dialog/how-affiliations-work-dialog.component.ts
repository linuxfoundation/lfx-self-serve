// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-how-affiliations-work-dialog',
  imports: [ButtonComponent],
  templateUrl: './how-affiliations-work-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HowAffiliationsWorkDialogComponent {
  private readonly ref = inject(DynamicDialogRef);

  public close(): void {
    this.ref.close();
  }
}
