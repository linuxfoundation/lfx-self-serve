// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EventsService } from '@app/shared/services/events.service';
import { UserService } from '@app/shared/services/user.service';
import { ButtonComponent } from '@components/button/button.component';
import { MyEvent, TravelFundAboutMe, TravelFundApplication, TravelFundExpenses, TravelFundStep } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { ApplicationSuccessComponent } from '../application-success/application-success.component';
import { EventSelectionComponent } from '../event-selection/event-selection.component';
import { StepIndicatorComponent } from '../step-indicator/step-indicator.component';
import { TravelFundTermsComponent } from '../travel-fund-terms/travel-fund-terms.component';
import { AboutMeFormComponent } from '../about-me-form/about-me-form.component';
import { TravelExpensesFormComponent } from '../travel-expenses-form/travel-expenses-form.component';
import { TRAVEL_FUND_STEP_ORDER } from '@lfx-one/shared/constants/events.constants';

@Component({
  selector: 'lfx-travel-fund-application-dialog',
  imports: [
    ApplicationSuccessComponent,
    ButtonComponent,
    EventSelectionComponent,
    StepIndicatorComponent,
    TravelFundTermsComponent,
    AboutMeFormComponent,
    TravelExpensesFormComponent,
  ],
  templateUrl: './travel-fund-application-dialog.component.html',
  styleUrl: './travel-fund-application-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TravelFundApplicationDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly eventsService = inject(EventsService);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  protected step = signal<TravelFundStep>('select-event');
  protected selectedEvent = signal<MyEvent | null>(null);
  protected termsAccepted = signal(false);
  protected aboutMeFormValid = signal(false);
  protected expensesFormValid = signal(true);
  protected aboutMeData = signal<TravelFundAboutMe | null>(null);
  protected expensesData = signal<TravelFundExpenses | null>(null);
  protected submitting = signal(false);
  protected submitted = signal(false);
  protected submittedEventName = signal('');

  protected readonly isNextDisabled = computed(() => {
    if (this.step() === 'select-event') return !this.selectedEvent();
    if (this.step() === 'about-me') return !this.aboutMeFormValid();
    return false;
  });

  protected readonly steps: { id: TravelFundStep; label: string; number: number }[] = [
    { id: 'select-event', label: 'Choose an Event', number: 1 },
    { id: 'terms', label: 'Terms and Conditions', number: 2 },
    { id: 'about-me', label: 'About Me', number: 3 },
    { id: 'expenses', label: 'Expenses', number: 4 },
  ];

  protected readonly stepStates = computed(() =>
    this.steps.map((s) => ({
      ...s,
      isActive: this.step() === s.id,
      isCompleted: TRAVEL_FUND_STEP_ORDER.indexOf(s.id) < TRAVEL_FUND_STEP_ORDER.indexOf(this.step()),
    }))
  );

  public onNextStep(): void {
    if (this.step() === 'terms') {
      this.termsAccepted.set(true);
    }
    const currentIndex = TRAVEL_FUND_STEP_ORDER.indexOf(this.step());
    if (currentIndex < TRAVEL_FUND_STEP_ORDER.length - 1) {
      this.step.set(TRAVEL_FUND_STEP_ORDER[currentIndex + 1]);
    }
  }

  public onPreviousStep(): void {
    const currentIndex = TRAVEL_FUND_STEP_ORDER.indexOf(this.step());
    if (currentIndex > 0) {
      this.step.set(TRAVEL_FUND_STEP_ORDER[currentIndex - 1]);
    }
  }

  public onSubmitApplication(): void {
    const event = this.selectedEvent();
    const aboutMe = this.aboutMeData();
    const userId = this.userService.apiGatewayUserId();

    if (!event || !aboutMe || !userId) return;

    this.submitting.set(true);

    const payload: TravelFundApplication = {
      eventId: event.id,
      eventName: event.name,
      termsAccepted: this.termsAccepted(),
      userId,
      aboutMe,
      expenses: this.expensesData() ?? {
        airfareCost: 0,
        airfareNotes: '',
        hotelCost: 0,
        hotelNotes: '',
        groundTransportCost: 0,
        groundTransportNotes: '',
        estimatedTotal: 0,
      },
    };

    this.eventsService
      .submitTravelFundApplication(payload)
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
        error: () => this.submitting.set(false),
      });
  }

  public onCancel(): void {
    this.ref.close(null);
  }
}
