// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import {
  SCHEDULE_SURVEY_CONFIRMATION,
  SEND_SURVEY_CONFIRMATION,
  SURVEY_AUTO_REMINDER_FREQUENCY_OPTIONS,
  SURVEY_LABEL,
  SURVEY_MANAGE_TOTAL_STEPS,
} from '@lfx-one/shared/constants';
import { CommitteeReference, SurveyDistributionMethod, SurveyReminderType } from '@lfx-one/shared/interfaces';
import { markFormControlsAsTouched } from '@lfx-one/shared/utils';
import { trimmedRequired } from '@lfx-one/shared/validators';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { StepperModule } from 'primeng/stepper';
import { combineLatest, distinctUntilChanged, of, switchMap } from 'rxjs';

import { SurveyAudienceTypeComponent } from '../components/survey-audience-type/survey-audience-type.component';
import { SurveyEmailDraftComponent } from '../components/survey-email-draft/survey-email-draft.component';
import { SurveyReviewComponent } from '../components/survey-review/survey-review.component';
import { SurveyTimingRemindersComponent } from '../components/survey-timing-reminders/survey-timing-reminders.component';

@Component({
  selector: 'lfx-survey-manage',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    ConfirmDialogModule,
    StepperModule,
    SurveyAudienceTypeComponent,
    SurveyTimingRemindersComponent,
    SurveyEmailDraftComponent,
    SurveyReviewComponent,
  ],
  templateUrl: './survey-manage.component.html',
  styleUrl: './survey-manage.component.scss',
})
export class SurveyManageComponent {
  // Private injections
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);

  // Protected constants
  public readonly totalSteps = SURVEY_MANAGE_TOTAL_STEPS;
  public readonly surveyLabel = SURVEY_LABEL;

  // Form
  public readonly form = signal<FormGroup>(this.createFormGroup());

  // Simple WritableSignals
  public readonly mode = signal<'create' | 'edit'>('create');
  public readonly surveyId = signal<string | null>(null);
  public readonly submitting = signal<boolean>(false);
  private readonly internalStep = signal<number>(1);

  // Complex computed/toSignal signals
  public readonly isEditMode: Signal<boolean> = this.initIsEditMode();
  public readonly formValue: Signal<Record<string, unknown>> = this.initFormValue();
  public readonly canGoPrevious: Signal<boolean> = this.initCanGoPrevious();
  public readonly canGoNext: Signal<boolean> = this.initCanGoNext();
  public readonly isFirstStep: Signal<boolean> = this.initIsFirstStep();
  public readonly isLastStep: Signal<boolean> = this.initIsLastStep();
  public currentStep: Signal<number> = this.initCurrentStep();
  public readonly submitButtonLabel: Signal<string> = this.initSubmitButtonLabel();

  public nextStep(): void {
    const next = this.currentStep() + 1;
    if (next <= this.totalSteps && this.canNavigateToStep(next)) {
      if (this.isEditMode()) {
        this.router.navigate([], { queryParams: { step: next } });
      } else {
        this.internalStep.set(next);
      }
    }
  }

  public previousStep(): void {
    const previous = this.currentStep() - 1;
    if (previous >= 1) {
      if (this.isEditMode()) {
        this.router.navigate([], { queryParams: { step: previous } });
      } else {
        this.internalStep.set(previous);
      }
    }
  }

  public goToStep(step: number | undefined): void {
    if (step !== undefined && step >= 1 && step <= this.totalSteps) {
      if (this.isEditMode()) {
        this.router.navigate([], { queryParams: { step } });
      } else {
        if (step <= this.currentStep() || this.canNavigateToStep(step)) {
          this.internalStep.set(step);
        }
      }
    }
  }

  public onCancel(): void {
    this.router.navigate(['/surveys']);
  }

  public onSaveAsDraft(): void {
    // TODO: Implement save as draft functionality
    this.messageService.add({
      severity: 'info',
      summary: 'Draft',
      detail: `${this.surveyLabel.singular} saved as draft`,
    });
  }

  public onSubmit(): void {
    // Validate all steps - form().invalid only checks fields with defined validators,
    // but some fields like scheduledDate have conditional requirements enforced in isStepValid
    if (this.form().invalid || !this.areAllStepsValid()) {
      this.markAllFormControlsAsTouched();
      return;
    }

    if (!this.isEditMode()) {
      const confirmation = this.buildConfirmationConfig();

      this.confirmationService.confirm({
        header: confirmation.header,
        message: confirmation.message,
        acceptLabel: confirmation.acceptLabel,
        rejectLabel: confirmation.rejectLabel,
        acceptButtonStyleClass: 'p-button-info p-button-sm',
        rejectButtonStyleClass: 'p-button-text p-button-sm',
        accept: () => this.submitSurvey(),
      });
    } else {
      this.submitSurvey();
    }
  }

  public isCurrentStepValid(): boolean {
    return this.isStepValid(this.currentStep());
  }

  /**
   * Validates all steps before submission
   * This is necessary because form().invalid only checks fields with defined validators,
   * but conditional requirements (like scheduledDate when distributionMethod is 'scheduled')
   * are enforced in isStepValid and would otherwise be bypassed during submission
   */
  private areAllStepsValid(): boolean {
    for (let step = 1; step <= this.totalSteps; step++) {
      if (!this.isStepValid(step)) {
        return false;
      }
    }
    return true;
  }

  // Private methods
  private buildConfirmationConfig(): { header: string; message: string; acceptLabel: string; rejectLabel: string } {
    const form = this.form();
    const distributionMethod = form.get('distributionMethod')?.value as SurveyDistributionMethod;
    const committees = form.get('committees')?.value as CommitteeReference[];
    const reminderType = form.get('reminderType')?.value as SurveyReminderType;
    const reminderFrequency = form.get('reminderFrequency')?.value as string;
    const cutoffDate = form.get('cutoffDate')?.value as Date | null;

    const isScheduled = distributionMethod === 'scheduled';
    const groupCount = committees?.length || 0;
    const participantCount = committees?.length || 0; // TODO: Replace with actual participant count from API

    const groupText = groupCount === 1 ? '1 group' : `${groupCount} groups`;
    const participantText = participantCount === 1 ? '1 participant' : `${participantCount} participants`;

    const cutoffDateText = cutoffDate ? this.formatDate(cutoffDate) : 'the cutoff date';

    let reminderText = '';
    if (reminderType === 'automatic') {
      const frequencyOption = SURVEY_AUTO_REMINDER_FREQUENCY_OPTIONS.find((f) => f.value === reminderFrequency);
      reminderText = `Automatic reminders will be sent ${frequencyOption?.label?.toLowerCase() || `every ${reminderFrequency} days`} until the survey closes on ${cutoffDateText}.`;
    } else {
      reminderText = `The survey will close on ${cutoffDateText}.`;
    }

    if (isScheduled) {
      const scheduledDate = form.get('scheduledDate')?.value as Date | null;
      const scheduledDateText = scheduledDate ? this.formatDate(scheduledDate) : 'the scheduled date';

      return {
        header: SCHEDULE_SURVEY_CONFIRMATION.header,
        message: `This survey will be sent on ${scheduledDateText} to ${participantText} across ${groupText}. ${reminderText}`,
        acceptLabel: SCHEDULE_SURVEY_CONFIRMATION.acceptLabel,
        rejectLabel: SCHEDULE_SURVEY_CONFIRMATION.rejectLabel,
      };
    }

    return {
      header: SEND_SURVEY_CONFIRMATION.header,
      message: `This survey will be sent immediately to ${participantText} across ${groupText}. ${reminderText}`,
      acceptLabel: SEND_SURVEY_CONFIRMATION.acceptLabel,
      rejectLabel: SEND_SURVEY_CONFIRMATION.rejectLabel,
    };
  }

  private formatDate(date: Date): string {
    return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(date));
  }

  private getSubmitAction(): string {
    if (this.isEditMode()) {
      return 'updated';
    }
    const distributionMethod = this.form().get('distributionMethod')?.value as SurveyDistributionMethod;
    return distributionMethod === 'scheduled' ? 'scheduled' : 'sent';
  }

  private submitSurvey(): void {
    this.submitting.set(true);

    // TODO: Implement actual API call
    setTimeout(() => {
      const action = this.getSubmitAction();

      this.messageService.add({
        severity: 'success',
        summary: 'Success',
        detail: `${this.surveyLabel.singular} ${action} successfully`,
      });
      this.submitting.set(false);
      this.router.navigate(['/surveys']);
    }, 1000);
  }

  // Private initializer functions
  private createFormGroup(): FormGroup {
    return new FormGroup({
      // Step 1: Audience & Type
      committees: new FormControl<CommitteeReference[]>([], [Validators.required, Validators.minLength(1)]),
      surveyTemplate: new FormControl<string>('', [Validators.required]),

      // Step 2: Timing & Reminders
      distributionMethod: new FormControl<SurveyDistributionMethod>('immediate', [Validators.required]),
      scheduledDate: new FormControl<Date | null>(null),
      cutoffDate: new FormControl<Date | null>(null, [Validators.required]),
      reminderType: new FormControl<SurveyReminderType>('automatic', [Validators.required]),
      reminderFrequency: new FormControl<string>('7', [Validators.required]),

      // Step 3: Email Draft
      emailSubject: new FormControl('{{FirstName}}, Your Feedback as a {{ProjectName}} Maintainer Matters!', [trimmedRequired(), Validators.maxLength(200)]),
      emailBody: new FormControl(
        `Thank you for being a valuable member of the {{CommitteeName}}. We respect your opinion as your feedback helps us get better every day.

Please share your experience by clicking the button below and completing a short survey. It will take under a minute.

{{SurveyButton}}

Thank you,
{{ExecutiveDirectorName}}`,
        [trimmedRequired()]
      ),
    });
  }

  private initIsEditMode(): Signal<boolean> {
    return computed(() => this.mode() === 'edit');
  }

  private initFormValue(): Signal<Record<string, unknown>> {
    return toSignal(this.form().valueChanges, { initialValue: this.form().value });
  }

  private initCanGoPrevious(): Signal<boolean> {
    return computed(() => this.currentStep() > 1);
  }

  private initCanGoNext(): Signal<boolean> {
    return computed(() => {
      this.formValue();
      return this.currentStep() < this.totalSteps && this.canNavigateToStep(this.currentStep() + 1);
    });
  }

  private initIsFirstStep(): Signal<boolean> {
    return computed(() => this.currentStep() === 1);
  }

  private initIsLastStep(): Signal<boolean> {
    return computed(() => this.currentStep() === this.totalSteps);
  }

  private initSubmitButtonLabel(): Signal<string> {
    return computed(() => {
      if (this.isEditMode()) {
        return 'Save Changes';
      }
      const formValue = this.formValue();
      const distributionMethod = formValue['distributionMethod'] as SurveyDistributionMethod;
      return distributionMethod === 'scheduled' ? `Schedule ${this.surveyLabel.singular}` : `Send ${this.surveyLabel.singular}`;
    });
  }

  private initCurrentStep(): Signal<number> {
    return toSignal(
      combineLatest([this.route.paramMap, this.route.queryParamMap, toObservable(this.internalStep)]).pipe(
        switchMap(([params, queryParams, internalStep]) => {
          const surveyId = params.get('id');
          if (surveyId) {
            this.mode.set('edit');
            this.surveyId.set(surveyId);
            const stepParam = queryParams.get('step');
            if (stepParam) {
              const step = parseInt(stepParam, 10);
              if (step >= 1 && step <= this.totalSteps) {
                return of(step);
              }
            }
            return of(1);
          }
          this.mode.set('create');
          return of(internalStep);
        }),
        distinctUntilChanged()
      ),
      { initialValue: 1 }
    );
  }

  private canNavigateToStep(step: number): boolean {
    if (step <= this.currentStep()) {
      return true;
    }

    for (let i = 1; i < step; i++) {
      if (!this.isStepValid(i)) {
        return false;
      }
    }
    return true;
  }

  private isStepValid(step: number): boolean {
    const form = this.form();

    switch (step) {
      case 1: {
        // Committees must have at least one selection
        const committeesValue = form.get('committees')?.value as CommitteeReference[] | null;
        const committeesValid = Array.isArray(committeesValue) && committeesValue.length > 0;
        const surveyTemplateValid = !!form.get('surveyTemplate')?.valid && !!form.get('surveyTemplate')?.value;
        return committeesValid && surveyTemplateValid;
      }
      case 2: {
        const distributionMethod = form.get('distributionMethod')?.value as SurveyDistributionMethod;
        const distributionMethodValid = !!form.get('distributionMethod')?.valid;

        // Scheduled date is required only when distribution method is 'scheduled'
        const scheduledDateValid = distributionMethod === 'scheduled' ? !!form.get('scheduledDate')?.value : true;

        const cutoffDateValid = !!form.get('cutoffDate')?.value;
        const reminderTypeValid = !!form.get('reminderType')?.valid;

        // Reminder frequency is required only when reminder type is 'automatic'
        const reminderType = form.get('reminderType')?.value as SurveyReminderType;
        const reminderFrequencyValid = reminderType === 'automatic' ? !!form.get('reminderFrequency')?.valid : true;

        return distributionMethodValid && scheduledDateValid && cutoffDateValid && reminderTypeValid && reminderFrequencyValid;
      }
      case 3: {
        const emailSubjectValid = !!form.get('emailSubject')?.valid;
        const emailBodyValid = !!form.get('emailBody')?.valid;
        return emailSubjectValid && emailBodyValid;
      }
      case 4:
        return true;
      default:
        return false;
    }
  }

  private markAllFormControlsAsTouched(): void {
    markFormControlsAsTouched(this.form());
  }
}
