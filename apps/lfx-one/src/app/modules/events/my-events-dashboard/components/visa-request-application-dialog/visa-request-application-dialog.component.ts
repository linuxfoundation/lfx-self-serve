// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EventsService } from '@app/shared/services/events.service';
import { UserService } from '@app/shared/services/user.service';
import { ButtonComponent } from '@components/button/button.component';
import { MyEvent, VisaRequestApplicantInfo, VisaRequestApplication, VisaRequestStep } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { ApplicationSuccessComponent } from '../application-success/application-success.component';
import { EventSelectionComponent } from '../event-selection/event-selection.component';
import { StepIndicatorComponent } from '../step-indicator/step-indicator.component';
import { VisaRequestApplyFormComponent } from '../visa-request-apply-form/visa-request-apply-form.component';
import { VisaRequestTermsComponent } from '../visa-request-terms/visa-request-terms.component';
import { VIS_REQUEST_STEP_ORDER } from '@lfx-one/shared/constants/events.constants';

@Component({
  selector: 'lfx-visa-request-application-dialog',
  imports: [
    ApplicationSuccessComponent,
    ButtonComponent,
    EventSelectionComponent,
    StepIndicatorComponent,
    VisaRequestTermsComponent,
    VisaRequestApplyFormComponent,
  ],
  templateUrl: './visa-request-application-dialog.component.html',
  styleUrl: './visa-request-application-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisaRequestApplicationDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly eventsService = inject(EventsService);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  protected step = signal<VisaRequestStep>('select-event');
  protected selectedEvent = signal<MyEvent | null>(null);
  protected termsAccepted = signal(false);
  protected applyFormValid = signal(false);
  protected applicantData = signal<VisaRequestApplicantInfo | null>(null);
  protected submitting = signal(false);
  protected submitted = signal(false);
  protected submittedEventName = signal('');

  protected readonly isNextDisabled = computed(() => {
    if (this.step() === 'select-event') return !this.selectedEvent();
    if (this.step() === 'apply') return !this.applyFormValid();
    return false;
  });

  protected readonly steps: { id: VisaRequestStep; label: string; number: number }[] = [
    { id: 'select-event', label: 'Choose an Event', number: 1 },
    { id: 'terms', label: 'Terms and Conditions', number: 2 },
    { id: 'apply', label: 'Apply', number: 3 },
  ];

  protected readonly stepStates = computed(() =>
    this.steps.map((s) => ({
      ...s,
      isActive: this.step() === s.id,
      isCompleted: VIS_REQUEST_STEP_ORDER.indexOf(s.id) < VIS_REQUEST_STEP_ORDER.indexOf(this.step()),
    }))
  );

  public onNextStep(): void {
    if (this.step() === 'terms') {
      this.termsAccepted.set(true);
    }
    const currentIndex = VIS_REQUEST_STEP_ORDER.indexOf(this.step());
    if (currentIndex < VIS_REQUEST_STEP_ORDER.length - 1) {
      this.step.set(VIS_REQUEST_STEP_ORDER[currentIndex + 1]);
    }
  }

  public onPreviousStep(): void {
    const currentIndex = VIS_REQUEST_STEP_ORDER.indexOf(this.step());
    if (currentIndex > 0) {
      this.step.set(VIS_REQUEST_STEP_ORDER[currentIndex - 1]);
    }
  }

  public onSubmitApplication(): void {
    const event = this.selectedEvent();
    const applicantInfo = this.applicantData();
    const userId = this.userService.apiGatewayUserId();

    if (!event || !applicantInfo || !userId) return;

    this.submitting.set(true);

    const payload: VisaRequestApplication = {
      eventId: event.id,
      eventName: event.name,
      termsAccepted: this.termsAccepted(),
      userId,
      applicantInfo,
    };

    this.eventsService
      .submitVisaRequestApplication(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.submittedEventName.set(event.name);
            this.submitted.set(true);
          } else {
            this.messageService.add({
              severity: 'error',
              summary: 'Submission Failed',
              detail: response.message ?? 'Unable to submit your application. Please try again.',
            });
            this.submitting.set(false);
          }
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'An unexpected error occurred. Please try again.',
          });
          this.submitting.set(false);
        },
      });
  }

  public onCancel(): void {
    this.ref.close(null);
  }
}
