// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormArray, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { MeetingVisibility, RecurrenceType } from '@lfx-pcc/shared/enums';
import { CreateMeetingRequest, MeetingAttachment, MeetingRecurrence, PendingAttachment } from '@lfx-pcc/shared/interfaces';
import { getUserTimezone } from '@lfx-pcc/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { StepperModule } from 'primeng/stepper';
import { forkJoin, Observable, of, take } from 'rxjs';

import { MeetingDetailsComponent } from '../meeting-details/meeting-details.component';
import { MeetingPlatformFeaturesComponent } from '../meeting-platform-features/meeting-platform-features.component';
import { MeetingResourcesSummaryComponent } from '../meeting-resources-summary/meeting-resources-summary.component';
import { MeetingTypeSelectionComponent } from '../meeting-type-selection/meeting-type-selection.component';

@Component({
  selector: 'lfx-meeting-create',
  standalone: true,
  imports: [
    CommonModule,
    StepperModule,
    ButtonComponent,
    ReactiveFormsModule,
    MeetingTypeSelectionComponent,
    MeetingDetailsComponent,
    MeetingPlatformFeaturesComponent,
    MeetingResourcesSummaryComponent,
  ],
  templateUrl: './meeting-create.component.html',
})
export class MeetingCreateComponent {
  private readonly router = inject(Router);
  private readonly meetingService = inject(MeetingService);
  private readonly projectService = inject(ProjectService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  // Stepper state
  public currentStep = signal<number>(0);
  public readonly totalSteps = 4;

  // Form state
  public form = signal<FormGroup>(this.createMeetingFormGroup());
  public submitting = signal<boolean>(false);

  // Get pending attachments from the form
  private get pendingAttachments(): PendingAttachment[] {
    return this.form().get('attachments')?.value || [];
  }

  // Validation signals for template
  public readonly canProceed = signal<boolean>(false);
  public readonly canGoNext = computed(() => {
    const next = this.currentStep() + 1;
    return next < this.totalSteps && this.canNavigateToStep(next);
  });
  public readonly canGoPrevious = computed(() => this.currentStep() > 0);
  public readonly isFirstStep = computed(() => this.currentStep() === 0);
  public readonly isLastStep = computed(() => this.currentStep() === this.totalSteps - 1);
  public readonly currentStepTitle = computed(() => this.getStepTitle(this.currentStep()));

  public constructor() {
    // Subscribe to form value changes and update validation signals
    this.form()
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.updateCanProceed();
      });

    // Use effect to watch for step changes and re-validate
    effect(() => {
      // Access the signal to create dependency
      this.currentStep();
      // Update validation when step changes
      this.updateCanProceed();
    });
  }

  // Navigation methods
  public goToStep(step: number | undefined): void {
    if (step !== undefined && this.canNavigateToStep(step)) {
      this.currentStep.set(step);
      this.scrollToStepper();
    }
  }

  public nextStep(): void {
    const next = this.currentStep() + 1;
    if (next < this.totalSteps && this.canNavigateToStep(next)) {
      // Auto-generate title when moving from step 1 to step 2
      if (this.currentStep() === 0 && next === 1) {
        this.generateMeetingTitle();
      }

      this.currentStep.set(next);
      this.scrollToStepper();
    }
  }

  public previousStep(): void {
    const previous = this.currentStep() - 1;
    if (previous >= 0) {
      this.currentStep.set(previous);
      this.scrollToStepper();
    }
  }

  public onCancel(): void {
    const project = this.projectService.project();
    if (project?.slug) {
      this.router.navigate(['/project', project.slug, 'meetings']);
    }
  }

  public onSubmit(): void {
    // Mark all form controls as touched to show validation errors
    Object.keys(this.form().controls).forEach((key) => {
      const control = this.form().get(key);
      control?.markAsTouched();
      control?.markAsDirty();
    });

    if (this.form().invalid) {
      return;
    }

    const project = this.projectService.project();
    if (!project) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Project information is required to create a meeting.',
      });
      return;
    }

    this.submitting.set(true);
    const formValue = this.form().value;

    // Process duration value - ensure it's always a number
    const duration = formValue.duration === 'custom' ? Number(formValue.customDuration) : Number(formValue.duration);

    // Combine date and time for start_time
    const startDateTime = this.combineDateTime(formValue.startDate, formValue.startTime);

    // Generate recurrence object if needed
    const recurrenceObject = this.generateRecurrenceObject(formValue.recurrence, formValue.startDate);

    // Create meeting data
    const meetingData: CreateMeetingRequest = {
      project_uid: project.uid,
      topic: formValue.topic,
      agenda: formValue.agenda || '',
      start_time: startDateTime,
      duration: duration,
      timezone: formValue.timezone,
      meeting_type: formValue.meeting_type || 'None',
      early_join_time: formValue.early_join_time || 10,
      visibility: formValue.show_in_public_calendar ? MeetingVisibility.PUBLIC : MeetingVisibility.PRIVATE,
      restricted: formValue.restricted || false,
      recording_enabled: formValue.recording_enabled || false,
      transcripts_enabled: formValue.transcripts_enabled || false,
      youtube_enabled: formValue.youtube_enabled || false,
      zoom_ai_enabled: formValue.zoom_ai_enabled || false,
      require_ai_summary_approval: formValue.require_ai_summary_approval || false,
      ai_summary_access: formValue.ai_summary_access || 'PCC',
      recording_access: formValue.recording_access || 'Members',
      recurrence: recurrenceObject,
      important_links: (this.form().get('important_links') as FormArray).value || [],
    };

    this.meetingService.createMeeting(meetingData).subscribe({
      next: (meeting) => {
        // If we have pending attachments, save them to the database
        if (this.pendingAttachments.length > 0) {
          this.savePendingAttachments(meeting.id)
            .pipe(take(1))
            .subscribe({
              next: () => {
                this.messageService.add({
                  severity: 'success',
                  summary: 'Success',
                  detail: `Meeting created successfully with ${this.pendingAttachments.length} attachment(s)`,
                });
                this.router.navigate(['/project', project.slug, 'meetings']);
              },
              error: (attachmentError: any) => {
                console.error('Error saving attachments:', attachmentError);
                this.messageService.add({
                  severity: 'warn',
                  summary: 'Meeting Created',
                  detail: 'Meeting created but some attachments failed to save. You can add them later.',
                });
                this.router.navigate(['/project', project.slug, 'meetings']);
              },
            });
        } else {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Meeting created successfully',
          });
          this.router.navigate(['/project', project.slug, 'meetings']);
        }
      },
      error: (error) => {
        console.error('Error creating meeting:', error);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to create meeting. Please try again.',
        });
        this.submitting.set(false);
      },
    });
  }

  private canNavigateToStep(step: number): boolean {
    // Allow navigation to previous steps or current step
    if (step <= this.currentStep()) {
      return true;
    }

    // For forward navigation, validate all previous steps
    for (let i = 0; i < step; i++) {
      if (!this.isStepValid(i)) {
        return false;
      }
    }
    return true;
  }

  private updateCanProceed(): void {
    const isValid = this.isStepValid(this.currentStep());
    this.canProceed.set(isValid);
  }

  private isStepValid(step: number): boolean {
    const form = this.form();

    switch (step) {
      case 0: // Meeting Type
        return !!form.get('meeting_type')?.value && form.get('meeting_type')?.value !== '';

      case 1: // Meeting Details
        return !!(
          form.get('topic')?.value &&
          form.get('agenda')?.value &&
          form.get('startDate')?.value &&
          form.get('startTime')?.value &&
          form.get('timezone')?.value &&
          form.get('topic')?.valid &&
          form.get('startDate')?.valid &&
          form.get('startTime')?.valid &&
          !form.errors?.['futureDateTime']
        );

      case 2: // Platform & Features
        return !!form.get('meetingTool')?.value;

      case 3: // Resources & Summary (optional)
        return true;

      default:
        return false;
    }
  }

  private createMeetingFormGroup(): FormGroup {
    const defaultDateTime = this.getDefaultStartDateTime();

    return new FormGroup(
      {
        // Step 1: Meeting Type
        meeting_type: new FormControl('', [Validators.required]),
        show_in_public_calendar: new FormControl(false),
        restricted: new FormControl(false),

        // Step 2: Meeting Details
        topic: new FormControl('', [Validators.required]),
        agenda: new FormControl('', [Validators.required]),
        aiPrompt: new FormControl(''),
        startDate: new FormControl(defaultDateTime.date, [Validators.required]),
        startTime: new FormControl(defaultDateTime.time, [Validators.required]),
        duration: new FormControl(60, [Validators.required]),
        customDuration: new FormControl(''),
        timezone: new FormControl(getUserTimezone(), [Validators.required]),
        early_join_time: new FormControl(10, [Validators.min(10), Validators.max(60)]),
        isRecurring: new FormControl(false),
        recurrence: new FormControl('none'),

        // Step 3: Platform & Features
        meetingTool: new FormControl('zoom', [Validators.required]),
        recording_enabled: new FormControl(false),
        transcripts_enabled: new FormControl(false),
        youtube_enabled: new FormControl(false),
        zoom_ai_enabled: new FormControl(false),
        require_ai_summary_approval: new FormControl(false),
        ai_summary_access: new FormControl('PCC'),
        recording_access: new FormControl('Members'),

        // Step 4: Resources & Summary
        attachments: new FormControl<PendingAttachment[]>([]),
        important_links: new FormArray([]),
      },
      { validators: this.futureDateTimeValidator() }
    );
  }

  private getDefaultStartDateTime(): { date: Date; time: string } {
    const now = new Date();
    // Add 1 hour to current time
    now.setHours(now.getHours() + 1);

    // Round up to next 15 minutes
    const minutes = now.getMinutes();
    const roundedMinutes = Math.ceil(minutes / 15) * 15;
    now.setMinutes(roundedMinutes);
    now.setSeconds(0);
    now.setMilliseconds(0);

    // If rounding pushed us to next hour, adjust accordingly
    if (roundedMinutes === 60) {
      now.setHours(now.getHours() + 1);
      now.setMinutes(0);
    }

    // Format time to 12-hour format (HH:MM AM/PM)
    const hours = now.getHours();
    const mins = now.getMinutes();
    const period = hours >= 12 ? 'PM' : 'AM';
    let displayHours = hours > 12 ? hours - 12 : hours;
    if (displayHours === 0) {
      displayHours = 12;
    }
    const timeString = `${displayHours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} ${period}`;

    return {
      date: new Date(now),
      time: timeString,
    };
  }

  private futureDateTimeValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const formGroup = control as FormGroup;
      const startDate = formGroup.get('startDate')?.value;
      const startTime = formGroup.get('startTime')?.value;
      const timezone = formGroup.get('timezone')?.value;

      if (!startDate || !startTime || !timezone) {
        return null; // Don't validate if values are not set
      }

      // Combine the date and time
      const combinedDateTime = this.combineDateTime(startDate, startTime);
      if (!combinedDateTime) {
        return null; // Invalid time format
      }

      // Parse the combined datetime
      const selectedDate = new Date(combinedDateTime);

      // Get current time in the selected timezone
      const now = new Date();

      // Create timezone-aware date strings for comparison
      const selectedTimeString = selectedDate.toLocaleString('en-US', { timeZone: timezone });
      const currentTimeString = now.toLocaleString('en-US', { timeZone: timezone });

      // Convert back to Date objects for comparison
      const selectedTimeInZone = new Date(selectedTimeString);
      const currentTimeInZone = new Date(currentTimeString);

      // Check if the selected time is in the future
      if (selectedTimeInZone <= currentTimeInZone) {
        return { futureDateTime: true };
      }

      return null;
    };
  }

  private combineDateTime(date: Date, time: string): string {
    if (!date || !time) return '';

    // Parse the 12-hour format time (e.g., "12:45 AM" or "1:30 PM")
    const match = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) {
      console.error('Invalid time format:', time);
      return '';
    }

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const period = match[3].toUpperCase();

    // Convert to 24-hour format
    if (period === 'PM' && hours !== 12) {
      hours += 12;
    } else if (period === 'AM' && hours === 12) {
      hours = 0;
    }

    // Create a new date object with the selected date and time
    const combinedDate = new Date(date);
    combinedDate.setHours(hours, minutes, 0, 0);

    // Return ISO string
    return combinedDate.toISOString();
  }

  private generateRecurrenceObject(recurrenceType: string, startDate: Date): MeetingRecurrence | undefined {
    if (recurrenceType === 'none') {
      return undefined;
    }

    const dayOfWeek = startDate.getDay() + 1; // Zoom API uses 1-7 (Sunday=1)
    const { weekOfMonth } = this.getWeekOfMonth(startDate);

    switch (recurrenceType) {
      case 'daily':
        return {
          type: RecurrenceType.DAILY,
          repeat_interval: 1,
        };

      case 'weekly':
        return {
          type: RecurrenceType.WEEKLY,
          repeat_interval: 1,
          weekly_days: dayOfWeek.toString(),
        };

      case 'monthly_nth':
        return {
          type: RecurrenceType.MONTHLY,
          repeat_interval: 1,
          monthly_week: weekOfMonth,
          monthly_week_day: dayOfWeek,
        };

      case 'monthly_last':
        return {
          type: RecurrenceType.MONTHLY,
          repeat_interval: 1,
          monthly_week: -1,
          monthly_week_day: dayOfWeek,
        };

      case 'weekdays':
        return {
          type: RecurrenceType.WEEKLY,
          repeat_interval: 1,
          weekly_days: '2,3,4,5,6', // Monday through Friday
        };

      default:
        return undefined;
    }
  }

  private getWeekOfMonth(date: Date): { weekOfMonth: number; isLastWeek: boolean } {
    // Find the first occurrence of this day of week in the month
    const targetDayOfWeek = date.getDay();
    let firstOccurrence = 1;
    while (new Date(date.getFullYear(), date.getMonth(), firstOccurrence).getDay() !== targetDayOfWeek) {
      firstOccurrence++;
    }

    // Calculate which week this date is in
    const weekOfMonth = Math.floor((date.getDate() - firstOccurrence) / 7) + 1;

    // Check if this is the last occurrence of this day in the month
    const nextWeekDate = new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
    const isLastWeek = nextWeekDate.getMonth() !== date.getMonth();

    return { weekOfMonth, isLastWeek };
  }

  private getStepTitle(step: number): string {
    const titles = ['Meeting Type', 'Meeting Details', 'Platform & Features', 'Resources & Summary'];
    return titles[step] || '';
  }

  private scrollToStepper(): void {
    // Find the meeting-create element and scroll to it minus 100px
    const meetingCreate = document.getElementById('meeting-create');
    if (meetingCreate) {
      const elementTop = meetingCreate.getBoundingClientRect().top + window.pageYOffset;
      window.scrollTo({
        top: elementTop - 50,
        behavior: 'smooth',
      });
    }
  }

  private generateMeetingTitle(): void {
    const form = this.form();
    const meetingType = form.get('meeting_type')?.value;
    const startDate = form.get('startDate')?.value;

    // Only auto-generate if we have meeting type and the title is empty
    const currentTitle = form.get('topic')?.value;
    if (meetingType && (!currentTitle || currentTitle.trim() === '')) {
      const formattedDate = startDate
        ? new Date(startDate).toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
          })
        : new Date().toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
          });

      const generatedTitle = `${meetingType} Meeting - ${formattedDate}`;
      form.get('topic')?.setValue(generatedTitle);
    }
  }

  private savePendingAttachments(meetingId: string): Observable<MeetingAttachment[]> {
    const attachmentsToSave = this.pendingAttachments.filter((attachment) => !attachment.uploading && !attachment.uploadError && attachment.fileUrl);

    if (attachmentsToSave.length === 0) {
      return of([]);
    }

    const saveRequests = attachmentsToSave.map((attachment) =>
      this.meetingService.createAttachmentFromUrl(meetingId, attachment.fileName, attachment.fileUrl, attachment.fileSize, attachment.mimeType)
    );

    return forkJoin(saveRequests).pipe(take(1));
  }
}
