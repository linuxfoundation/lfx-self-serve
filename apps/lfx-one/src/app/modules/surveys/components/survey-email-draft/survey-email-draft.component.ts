// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, input, signal, Signal } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { SURVEY_EMAIL_TEMPLATE_VARIABLES } from '@lfx-one/shared/constants';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import { SurveyEmailPreviewData, SurveyEmailPreviewDialogComponent } from '../survey-email-preview-dialog/survey-email-preview-dialog.component';

@Component({
  selector: 'lfx-survey-email-draft',
  imports: [ReactiveFormsModule, InputTextComponent, TextareaComponent, ButtonComponent],
  templateUrl: './survey-email-draft.component.html',
  providers: [DialogService],
})
export class SurveyEmailDraftComponent {
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);

  // Inputs
  public readonly form = input.required<FormGroup>();
  public readonly formValue = input.required<Signal<Record<string, unknown>>>();
  public readonly isEditMode = input<boolean>(false);

  // Constants for template
  public readonly templateVariables = SURVEY_EMAIL_TEMPLATE_VARIABLES;
  public readonly variableGroups = Object.keys(SURVEY_EMAIL_TEMPLATE_VARIABLES) as (keyof typeof SURVEY_EMAIL_TEMPLATE_VARIABLES)[];

  // State for copied variable feedback
  public readonly copiedVariable = signal<string | null>(null);

  /**
   * Copy variable to clipboard and show feedback
   */
  public async copyVariable(variable: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(variable);
      this.copiedVariable.set(variable);

      // Reset after 2 seconds
      setTimeout(() => {
        this.copiedVariable.set(null);
      }, 2000);
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Failed to copy to clipboard',
      });
    }
  }

  /**
   * Open email preview dialog
   */
  public openPreview(): void {
    // Double invocation is intentional: formValue is an input.required<Signal<Record<string, unknown>>>()
    // First () unwraps the InputSignal to get the Signal, second () invokes that Signal to get the value
    const emailPreviewData: SurveyEmailPreviewData = {
      subject: this.form().get('emailSubject')?.value as string,
      body: this.form().get('emailBody')?.value as string,
    };

    this.dialogService.open(SurveyEmailPreviewDialogComponent, {
      header: 'Email Preview',
      width: '600px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: emailPreviewData,
      draggable: false,
    });
  }
}
