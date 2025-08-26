// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import {
  DEFAULT_ARTIFACT_VISIBILITY,
  DEFAULT_DURATION,
  DEFAULT_EARLY_JOIN_TIME,
  DEFAULT_MEETING_TOOL,
  DEFAULT_MEETING_TYPE,
  MAX_EARLY_JOIN_TIME,
  MEETING_STEP_TITLES,
  MIN_EARLY_JOIN_TIME,
  STEPPER_SCROLL_OFFSET,
  TOTAL_STEPS,
} from '@lfx-pcc/shared/constants';
import { MeetingVisibility } from '@lfx-pcc/shared/enums';
import { CreateMeetingRequest, Meeting, MeetingAttachment, PendingAttachment, UpdateMeetingRequest } from '@lfx-pcc/shared/interfaces';
import {
  combineDateTime,
  formatTo12Hour,
  generateRecurrenceObject,
  getDefaultStartDateTime,
  getUserTimezone,
  mapRecurrenceToFormValue,
} from '@lfx-pcc/shared/utils';
import { futureDateTimeValidator } from '@lfx-pcc/shared/validators';
import { MeetingService } from '@services/meeting.service';
import { ProjectService } from '@services/project.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { StepperModule } from 'primeng/stepper';
import { BehaviorSubject, catchError, from, mergeMap, Observable, of, switchMap, take, toArray } from 'rxjs';

import { MeetingDetailsComponent } from '../meeting-details/meeting-details.component';
import { MeetingPlatformFeaturesComponent } from '../meeting-platform-features/meeting-platform-features.component';
import { MeetingResourcesSummaryComponent } from '../meeting-resources-summary/meeting-resources-summary.component';
import { MeetingTypeSelectionComponent } from '../meeting-type-selection/meeting-type-selection.component';

@Component({
  selector: 'lfx-meeting-manage',
  standalone: true,
  imports: [
    CommonModule,
    StepperModule,
    ButtonComponent,
    ReactiveFormsModule,
    ConfirmDialogModule,
    MeetingTypeSelectionComponent,
    MeetingDetailsComponent,
    MeetingPlatformFeaturesComponent,
    MeetingResourcesSummaryComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './meeting-manage.component.html',
})
export class MeetingManageComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly meetingService = inject(MeetingService);
  private readonly projectService = inject(ProjectService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);

  // Mode and state signals
  public mode = signal<'create' | 'edit'>('create');
  public meetingId = signal<string | null>(null);
  public isEditMode = computed(() => this.mode() === 'edit');

  // Initialize meeting data using toSignal
  public meeting = this.initializeMeeting();

  // Initialize meeting attachments with refresh capability
  private attachmentsRefresh$ = new BehaviorSubject<void>(undefined);
  public attachments = this.initializeAttachments();

  // Stepper state
  public currentStep = signal<number>(0);
  public readonly totalSteps = TOTAL_STEPS;

  // Form state
  public form = signal<FormGroup>(this.createMeetingFormGroup());
  public submitting = signal<boolean>(false);
  public deletingAttachmentId = signal<string | null>(null);

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

    // Use effect to populate form when meeting data is loaded
    effect(() => {
      const meeting = this.meeting();
      if (meeting && this.isEditMode()) {
        this.populateFormWithMeetingData(meeting);
      }
    });
  }

  // Public methods
  public deleteAttachment(attachmentId: string): void {
    const meetingId = this.meetingId();
    if (!meetingId) return;

    // Find the attachment name for the confirmation dialog
    const attachment = this.attachments().find((att) => att.id === attachmentId);
    const fileName = attachment?.file_name || 'this attachment';

    this.confirmationService.confirm({
      message: `Are you sure you want to delete "${fileName}"? This action cannot be undone.`,
      header: 'Delete Attachment',
      icon: 'fa-light fa-exclamation-triangle',
      acceptIcon: 'fa-light fa-trash',
      rejectIcon: 'fa-light fa-times',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-text',
      rejectButtonStyleClass: 'p-button-text',
      accept: () => {
        this.deletingAttachmentId.set(attachmentId);
        this.meetingService.deleteAttachment(meetingId, attachmentId).subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: 'Success',
              detail: 'Attachment deleted successfully',
            });
            // Force refresh the attachments by triggering the BehaviorSubject
            this.attachmentsRefresh$.next();
            this.deletingAttachmentId.set(null);
          },
          error: (error) => {
            console.error('Error deleting attachment:', error);
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: 'Failed to delete attachment. Please try again.',
            });
            this.deletingAttachmentId.set(null);
          },
        });
      },
    });
  }

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

    // Combine date and time for start_time with timezone awareness
    const startDateTime = combineDateTime(formValue.startDate, formValue.startTime, formValue.timezone);

    // Generate recurrence object if needed
    const recurrenceObject = generateRecurrenceObject(formValue.recurrence, formValue.startDate);

    // Create meeting data
    const baseMeetingData = {
      project_uid: project.uid,
      title: formValue.title,
      description: formValue.description || '',
      start_time: startDateTime,
      duration: duration,
      timezone: formValue.timezone,
      meeting_type: formValue.meeting_type || DEFAULT_MEETING_TYPE,
      early_join_time_minutes: formValue.early_join_time_minutes || DEFAULT_EARLY_JOIN_TIME,
      visibility: formValue.visibility || MeetingVisibility.PRIVATE,
      restricted: formValue.restricted || false,
      recording_enabled: formValue.recording_enabled || false,
      transcript_enabled: formValue.transcript_enabled || false,
      youtube_upload_enabled: formValue.youtube_upload_enabled || false,
      zoom_config: {
        ai_companion_enabled: formValue.zoom_ai_enabled || false,
        ai_summary_require_approval: formValue.require_ai_summary_approval || false,
      },
      artifact_visibility: formValue.artifact_visibility || DEFAULT_ARTIFACT_VISIBILITY,
      recurrence: recurrenceObject,
      important_links: (this.form().get('important_links') as FormArray).value || [],
    };

    const operation = this.isEditMode()
      ? this.meetingService.updateMeeting(this.meetingId()!, baseMeetingData as UpdateMeetingRequest, 'single')
      : this.meetingService.createMeeting(baseMeetingData as CreateMeetingRequest);

    operation.subscribe({
      next: (meeting) => {
        // If we have pending attachments, save them to the database
        if (this.pendingAttachments.length > 0) {
          this.savePendingAttachments(meeting.uid)
            .pipe(take(1))
            .subscribe({
              next: (result) => {
                const { successes, failures } = result;

                if (failures.length === 0) {
                  // All attachments saved successfully
                  const successMessage = this.isEditMode()
                    ? `Meeting updated successfully with ${successes.length} new attachment(s)`
                    : `Meeting created successfully with ${successes.length} attachment(s)`;

                  this.messageService.add({
                    severity: 'success',
                    summary: 'Success',
                    detail: successMessage,
                  });
                } else if (successes.length > 0) {
                  // Partial success
                  const partialMessage = this.isEditMode()
                    ? `Meeting updated with ${successes.length} attachments. ${failures.length} failed to save.`
                    : `Meeting created with ${successes.length} attachments. ${failures.length} failed to save.`;

                  this.messageService.add({
                    severity: 'warn',
                    summary: this.isEditMode() ? 'Meeting Updated' : 'Meeting Created',
                    detail: partialMessage,
                  });
                } else {
                  // All failed
                  const errorMessage = this.isEditMode()
                    ? 'Meeting updated but all attachments failed to save. You can add them later.'
                    : 'Meeting created but all attachments failed to save. You can add them later.';

                  this.messageService.add({
                    severity: 'warn',
                    summary: this.isEditMode() ? 'Meeting Updated' : 'Meeting Created',
                    detail: errorMessage,
                  });
                }

                // Log individual failures for debugging
                failures.forEach((failure) => {
                  console.error(`Failed to save attachment ${failure.fileName}:`, failure.error);
                });

                // Refresh attachments list if we're in edit mode
                if (this.isEditMode()) {
                  this.attachmentsRefresh$.next();
                }

                this.router.navigate(['/project', project.slug, 'meetings']);
              },
              error: (attachmentError: any) => {
                console.error('Error saving attachments:', attachmentError);
                const warningMessage = this.isEditMode()
                  ? 'Meeting updated but attachments failed to save. You can add them later.'
                  : 'Meeting created but attachments failed to save. You can add them later.';

                this.messageService.add({
                  severity: 'warn',
                  summary: this.isEditMode() ? 'Meeting Updated' : 'Meeting Created',
                  detail: warningMessage,
                });
                this.router.navigate(['/project', project.slug, 'meetings']);
              },
            });
        } else {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: `Meeting ${this.isEditMode() ? 'updated' : 'created'} successfully`,
          });
          this.router.navigate(['/project', project.slug, 'meetings']);
        }
      },
      error: (error) => {
        console.error('Error saving meeting:', error);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: `Failed to ${this.isEditMode() ? 'update' : 'create'} meeting. Please try again.`,
        });
        this.submitting.set(false);
      },
    });
  }

  // Private methods
  private initializeMeeting() {
    return toSignal(
      this.route.paramMap.pipe(
        switchMap((params) => {
          const meetingId = params.get('id');
          if (meetingId) {
            this.mode.set('edit');
            this.meetingId.set(meetingId);
            return this.meetingService.getMeeting(meetingId);
          }

          this.mode.set('create');
          return of(null);
        })
      ),
      { initialValue: null }
    );
  }

  private populateFormWithMeetingData(meeting: Meeting): void {
    // Parse start_time to separate date and time
    let startDate = null;
    let startTime = '';

    if (meeting.start_time) {
      const date = new Date(meeting.start_time);
      startDate = date;

      // Convert to 12-hour format for display
      startTime = formatTo12Hour(date);
    }

    // Map recurrence object back to form value
    const recurrenceValue = mapRecurrenceToFormValue(meeting.recurrence);

    this.form().patchValue({
      title: meeting.title,
      description: meeting.description,
      meeting_type: meeting.meeting_type || 'None',
      startDate: startDate,
      startTime: startTime,
      duration: meeting.duration || DEFAULT_DURATION,
      timezone: meeting.timezone || getUserTimezone(),
      early_join_time_minutes: meeting.early_join_time_minutes || DEFAULT_EARLY_JOIN_TIME,
      visibility: meeting.visibility || MeetingVisibility.PRIVATE,
      restricted: meeting.restricted ?? false,
      recording_enabled: meeting.recording_enabled || false,
      transcript_enabled: meeting.transcript_enabled || false,
      youtube_upload_enabled: meeting.youtube_upload_enabled || false,
      zoom_ai_enabled: meeting.zoom_config?.ai_companion_enabled || false,
      require_ai_summary_approval: meeting.zoom_config?.ai_summary_require_approval ?? false,
      artifact_visibility: meeting.artifact_visibility ?? DEFAULT_ARTIFACT_VISIBILITY,
      recurrence: recurrenceValue,
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
          form.get('title')?.value &&
          form.get('description')?.value &&
          form.get('startDate')?.value &&
          form.get('startTime')?.value &&
          form.get('timezone')?.value &&
          form.get('title')?.valid &&
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
    const defaultDateTime = getDefaultStartDateTime();

    return new FormGroup(
      {
        // Step 1: Meeting Type
        meeting_type: new FormControl('', [Validators.required]),
        visibility: new FormControl(MeetingVisibility.PRIVATE),
        restricted: new FormControl(false),

        // Step 2: Meeting Details
        title: new FormControl('', [Validators.required]),
        description: new FormControl('', [Validators.required]),
        aiPrompt: new FormControl(''),
        startDate: new FormControl(defaultDateTime.date, [Validators.required]),
        startTime: new FormControl(defaultDateTime.time, [Validators.required]),
        duration: new FormControl(DEFAULT_DURATION, [Validators.required]),
        customDuration: new FormControl(''),
        timezone: new FormControl(getUserTimezone(), [Validators.required]),
        early_join_time_minutes: new FormControl(DEFAULT_EARLY_JOIN_TIME, [Validators.min(MIN_EARLY_JOIN_TIME), Validators.max(MAX_EARLY_JOIN_TIME)]),
        isRecurring: new FormControl(false),
        recurrence: new FormControl('none'),

        // Step 3: Platform & Features
        meetingTool: new FormControl(DEFAULT_MEETING_TOOL, [Validators.required]),
        recording_enabled: new FormControl(false),
        transcript_enabled: new FormControl({ value: false, disabled: true }),
        youtube_upload_enabled: new FormControl({ value: false, disabled: true }),
        zoom_ai_enabled: new FormControl({ value: false, disabled: true }),
        require_ai_summary_approval: new FormControl(false),
        artifact_visibility: new FormControl(DEFAULT_ARTIFACT_VISIBILITY),

        // Step 4: Resources & Summary
        attachments: new FormControl<PendingAttachment[]>([]),
        important_links: new FormArray([]),
      },
      { validators: futureDateTimeValidator() }
    );
  }

  private getStepTitle(step: number): string {
    return MEETING_STEP_TITLES[step] || '';
  }

  private scrollToStepper(): void {
    // Find the meeting-manage element and scroll to it minus offset
    const meetingManage = document.getElementById('meeting-manage');
    if (meetingManage) {
      const elementTop = meetingManage.getBoundingClientRect().top + window.pageYOffset;
      window.scrollTo({
        top: elementTop - STEPPER_SCROLL_OFFSET,
        behavior: 'smooth',
      });
    }
  }

  private generateMeetingTitle(): void {
    const form = this.form();
    const meetingType = form.get('meeting_type')?.value;
    const startDate = form.get('startDate')?.value;
    const project = this.projectService.project();

    // Only auto-generate if we have meeting type, start date, and the title is empty
    const currentTitle = form.get('title')?.value;
    if (meetingType && startDate && (!currentTitle || currentTitle.trim() === '')) {
      const formattedDate = new Date(startDate).toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
      });

      const projectSlug = project?.slug?.toUpperCase() || '';
      const generatedTitle = `${projectSlug} ${meetingType} Meeting - ${formattedDate}`;
      form.get('title')?.setValue(generatedTitle);
    }
  }

  private savePendingAttachments(meetingId: string): Observable<{ successes: MeetingAttachment[]; failures: { fileName: string; error: any }[] }> {
    const attachmentsToSave = this.pendingAttachments.filter((attachment) => !attachment.uploading && !attachment.uploadError && attachment.fileUrl);

    if (attachmentsToSave.length === 0) {
      return of({ successes: [], failures: [] });
    }

    return from(attachmentsToSave).pipe(
      mergeMap((attachment) =>
        this.meetingService.createAttachmentFromUrl(meetingId, attachment.fileName, attachment.fileUrl, attachment.fileSize, attachment.mimeType).pipe(
          switchMap((result) => of({ success: result, failure: null })),
          catchError((error) => of({ success: null, failure: { fileName: attachment.fileName, error } }))
        )
      ),
      toArray(),
      switchMap((results) => {
        const successes = results.filter((r) => r.success).map((r) => r.success!);
        const failures = results.filter((r) => r.failure).map((r) => r.failure!);
        return of({ successes, failures });
      }),
      take(1)
    );
  }

  private initializeAttachments() {
    return toSignal(
      this.attachmentsRefresh$.pipe(
        takeUntilDestroyed(),
        switchMap(() => this.route.paramMap),
        switchMap((params) => {
          const meetingId = params.get('id');
          if (meetingId) {
            return this.meetingService.getMeetingAttachments(meetingId).pipe(catchError(() => of([])));
          }
          return of([]);
        })
      ),
      { initialValue: [] }
    );
  }
}
