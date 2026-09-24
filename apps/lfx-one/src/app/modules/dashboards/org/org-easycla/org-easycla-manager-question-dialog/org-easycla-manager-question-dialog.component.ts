// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ORG_CLA_MANAGER_QUESTION_COPY } from '@lfx-one/shared/constants';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';

/** What the viewer answered. Dismissing the dialog closes with `undefined`, which answers neither. */
export type OrgEasyclaManagerAnswer = 'yes' | 'no';

export function orgClaManagerQuestionDialogConfig(): DynamicDialogConfig {
  return {
    header: ORG_CLA_MANAGER_QUESTION_COPY.title,
    modal: true,
    width: '32rem',
    style: { maxWidth: '90vw' },
  };
}

/**
 * Corporate Console's "Are you authorized to be a CLA Manager?" before Start (#2780). It only
 * collects the answer; the detail page performs the assignment, so a dismissed dialog assigns
 * nothing.
 */
@Component({
  selector: 'lfx-org-easycla-manager-question-dialog',
  imports: [ButtonComponent],
  templateUrl: './org-easycla-manager-question-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaManagerQuestionDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);

  protected readonly copy = ORG_CLA_MANAGER_QUESTION_COPY;

  protected answer(answer: OrgEasyclaManagerAnswer): void {
    this.dialogRef.close(answer);
  }
}
