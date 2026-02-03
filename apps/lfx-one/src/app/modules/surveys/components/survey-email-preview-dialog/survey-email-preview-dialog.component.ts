// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { SURVEY_EMAIL_PREVIEW_SAMPLE_DATA } from '@lfx-one/shared/constants';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

export interface SurveyEmailPreviewData {
  subject: string;
  body: string;
}

@Component({
  selector: 'lfx-survey-email-preview-dialog',
  imports: [ButtonComponent],
  templateUrl: './survey-email-preview-dialog.component.html',
})
export class SurveyEmailPreviewDialogComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);

  // Resolved preview data
  public readonly previewSubject: string;
  public readonly previewBody: string;

  public constructor() {
    const data = this.config.data as SurveyEmailPreviewData;
    this.previewSubject = this.resolveVariables(data?.subject || '');
    this.previewBody = this.resolveVariables(data?.body || '');
  }

  /**
   * Close the dialog
   */
  public close(): void {
    this.dialogRef.close();
  }

  /**
   * Replace template variables with sample data
   */
  private resolveVariables(text: string): string {
    let result = text;
    for (const [variable, value] of Object.entries(SURVEY_EMAIL_PREVIEW_SAMPLE_DATA)) {
      result = result.replaceAll(variable, value);
    }
    return result;
  }
}
