// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, input, output, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { SURVEY_AUTO_REMINDER_FREQUENCY_OPTIONS, SURVEY_EMAIL_PREVIEW_SAMPLE_DATA, SURVEY_TEMPLATE_OPTIONS } from '@lfx-one/shared/constants';
import { CommitteeReference, SurveyDistributionMethod, SurveyReminderType, SurveyReviewFormValue } from '@lfx-one/shared/interfaces';
import { map, startWith, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-survey-review',
  imports: [ReactiveFormsModule, DatePipe],
  templateUrl: './survey-review.component.html',
})
export class SurveyReviewComponent {
  // Inputs
  public readonly form = input.required<FormGroup>();
  public readonly isEditMode = input<boolean>(false);

  // Outputs
  public readonly editStep = output<number>();

  // Computed signals for review data
  public readonly reviewData: Signal<SurveyReviewFormValue> = this.initReviewData();
  public readonly surveyTemplateLabel: Signal<string> = this.initSurveyTemplateLabel();
  public readonly targetGroupNames: Signal<string> = this.initTargetGroupNames();
  public readonly totalParticipants: Signal<number> = this.initTotalParticipants();
  public readonly distributionLabel: Signal<string> = this.initDistributionLabel();
  public readonly reminderLabel: Signal<string> = this.initReminderLabel();
  public readonly resolvedSubject: Signal<string> = this.initResolvedSubject();
  public readonly emailParagraphs: Signal<string[]> = this.initEmailParagraphs();

  /**
   * Navigate to a specific step for editing
   */
  public onEditStep(step: number): void {
    this.editStep.emit(step);
  }

  /**
   * Check if a paragraph is the survey button placeholder
   */
  public isSurveyButton(paragraph: string): boolean {
    return paragraph.includes('{{SurveyButton}}');
  }

  /**
   * Resolve variables in a paragraph
   */
  public resolveVariables(text: string): string {
    let result = text;
    for (const [variable, value] of Object.entries(SURVEY_EMAIL_PREVIEW_SAMPLE_DATA)) {
      if (variable !== '{{SurveyButton}}') {
        result = result.replaceAll(variable, value);
      }
    }
    return result;
  }

  // Private initializer functions
  private initReviewData(): Signal<SurveyReviewFormValue> {
    return toSignal(
      toObservable(computed(() => this.form())).pipe(
        switchMap((form) => form.valueChanges.pipe(startWith(form.value))),
        map((formValue) => ({
          surveyTemplate: formValue.surveyTemplate || '',
          committees: (formValue.committees as CommitteeReference[]) || [],
          distributionMethod: (formValue.distributionMethod as SurveyDistributionMethod) || 'immediate',
          scheduledDate: formValue.scheduledDate || null,
          cutoffDate: formValue.cutoffDate || null,
          reminderType: (formValue.reminderType as SurveyReminderType) || 'automatic',
          reminderFrequency: formValue.reminderFrequency || '7',
          emailSubject: formValue.emailSubject || '',
          emailBody: formValue.emailBody || '',
        }))
      ),
      {
        initialValue: {
          surveyTemplate: '',
          committees: [],
          distributionMethod: 'immediate',
          scheduledDate: null,
          cutoffDate: null,
          reminderType: 'automatic',
          reminderFrequency: '7',
          emailSubject: '',
          emailBody: '',
        },
      }
    );
  }

  private initSurveyTemplateLabel(): Signal<string> {
    return computed(() => {
      const templateValue = this.reviewData().surveyTemplate;
      const template = SURVEY_TEMPLATE_OPTIONS.find((t) => t.value === templateValue);
      return template?.label || templateValue || 'Not selected';
    });
  }

  private initTargetGroupNames(): Signal<string> {
    return computed(() => {
      const committees = this.reviewData().committees;
      if (!committees || committees.length === 0) {
        return 'None selected';
      }
      return committees.map((c) => c.name).join(', ');
    });
  }

  private initTotalParticipants(): Signal<number> {
    return computed(() => {
      const committees = this.reviewData().committees;
      if (!committees || committees.length === 0) {
        return 0;
      }
      // Note: We don't have member count in CommitteeReference, so we show the count of committees
      // This would need to be enhanced with actual participant counts from the API
      return committees.length;
    });
  }

  private initDistributionLabel(): Signal<string> {
    return computed(() => {
      const data = this.reviewData();
      if (data.distributionMethod === 'immediate') {
        return 'Immediate';
      }
      return `Scheduled for ${data.scheduledDate ? new Date(data.scheduledDate).toLocaleDateString() : 'Not set'}`;
    });
  }

  private initReminderLabel(): Signal<string> {
    return computed(() => {
      const data = this.reviewData();
      if (data.reminderType === 'manual') {
        return 'Manual';
      }
      const frequencyOption = SURVEY_AUTO_REMINDER_FREQUENCY_OPTIONS.find((f) => f.value === data.reminderFrequency);
      return `Automatic (${frequencyOption?.label || 'Every ' + data.reminderFrequency + ' days'})`;
    });
  }

  private initResolvedSubject(): Signal<string> {
    return computed(() => {
      return this.resolveVariables(this.reviewData().emailSubject);
    });
  }

  private initEmailParagraphs(): Signal<string[]> {
    return computed(() => {
      const body = this.reviewData().emailBody;
      if (!body) {
        return [];
      }
      return body.split('\n\n').filter((p) => p.trim());
    });
  }
}
