// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

// The approve dialog's buttons, in the dialog's own footer, outside the
// scrolling body, so they stay in view however long the report's list is.
// Rendered by the dialog service with the dialog's injector: the ref is the
// one the dialog's content shares, so closing here answers the same opener.
@Component({
  selector: 'lfx-mktg-approve-gaps-footer',
  imports: [ButtonComponent],
  template: `
    <div class="flex justify-end gap-2" data-testid="mktg-document-view-approve-footer">
      <lfx-button label="Cancel" severity="secondary" [outlined]="true" data-testid="mktg-document-view-approve-cancel" (onClick)="close(false)" />
      <lfx-button label="Approve anyway" severity="primary" data-testid="mktg-document-view-approve-anyway" (onClick)="close(true)" />
    </div>
  `,
})
export class MktgApproveGapsFooterComponent {
  private readonly ref = inject(DynamicDialogRef);

  protected close(approve: boolean): void {
    this.ref.close(approve);
  }
}
