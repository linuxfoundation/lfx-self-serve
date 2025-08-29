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
import {
  BatchRegistrantOperationResponse,
  CreateMeetingRequest,
  Meeting,
  MeetingAttachment,
  MeetingRegistrant,
  PendingAttachment,
  RegistrantPendingChanges,
  UpdateMeetingRequest,
} from '@lfx-pcc/shared/interfaces';
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
import { TabsModule } from 'primeng/tabs';
import { BehaviorSubject, catchError, concat, finalize, from, mergeMap, Observable, of, switchMap, take, toArray } from 'rxjs';

import { MeetingDetailsComponent } from '../meeting-details/meeting-details.component';
import { MeetingPlatformFeaturesComponent } from '../meeting-platform-features/meeting-platform-features.component';
import { MeetingRegistrantsComponent } from '../meeting-registrants/meeting-registrants.component';
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
    MeetingRegistrantsComponent,
    TabsModule,
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
  public registrantUpdates = signal<RegistrantPendingChanges>({
    toAdd: [],
    toUpdate: [],
    toDelete: [],
  });
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
  // Registrant updates refresh
  public registrantUpdatesRefresh$ = new BehaviorSubject<void>(undefined);

  // Get pending attachments from the form
  private get pendingAttachments(): PendingAttachment[] {
    return this.form().get('attachments')?.value || [];
  }

  // Validation signals for template
  public readonly canProceed = signal<boolean>(false);
  public readonly canGoNext = computed(() => this.currentStep() + 1 < this.totalSteps && this.canNavigateToStep(this.currentStep() + 1));
  public readonly canGoPrevious = computed(() => this.currentStep() > 0);
  public readonly isFirstStep = computed(() => this.currentStep() === 0);
  public readonly isLastMeetingStep = computed(() => this.currentStep() === this.totalSteps - 2);
  public readonly isLastStep = computed(() => this.currentStep() === this.totalSteps - 1);
  public readonly currentStepTitle = computed(() => this.getStepTitle(this.currentStep()));
  public readonly hasRegistrantUpdates = computed(
    () => this.registrantUpdates().toAdd.length > 0 || this.registrantUpdates().toUpdate.length > 0 || this.registrantUpdates().toDelete.length > 0
  );

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

      const meeting = this.meeting();
      if (meeting && this.isEditMode()) {
        this.populateFormWithMeetingData(meeting);
      }
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
        detail: `Project information is required to ${this.isEditMode() ? 'update' : 'create'} a meeting.`,
      });
      return;
    }

    this.submitting.set(true);
    const meetingData = this.prepareMeetingData(project);
    const operation = this.isEditMode()
      ? this.meetingService.updateMeeting(this.meetingId()!, meetingData as UpdateMeetingRequest, 'single')
      : this.meetingService.createMeeting(meetingData as CreateMeetingRequest);

    operation.subscribe({
      next: (meeting) => this.handleMeetingSuccess(meeting, project),
      error: (error) => this.handleMeetingError(error),
    });
  }

  public deleteAttachment(attachmentId: string): void {
    const meetingId = this.meetingId();
    if (!meetingId) return;

    const attachment = this.attachments().find((att) => att.id === attachmentId);
    const fileName = attachment?.file_name || 'this attachment';

    this.showDeleteAttachmentConfirmation(meetingId, attachmentId, fileName);
  }

  public onManageRegistrants(): void {
    this.submitting.set(true);

    // Build an array of operations with result tracking
    const operations: Observable<{ type: string; success: number; failed: number }>[] = this.buildRegistrantOperations();

    // If no operations, just complete
    if (operations.length === 0) {
      this.submitting.set(false);
      this.messageService.add({
        severity: 'info',
        summary: 'No Changes',
        detail: 'No registrant changes to save',
      });
      return;
    }

    // Execute operations sequentially using concat
    concat(...operations)
      .pipe(
        toArray(),
        finalize(() => this.submitting.set(false))
      )
      .subscribe({
        next: (results) => {
          // Calculate total successes and failures
          const totalSuccess = results.reduce((sum, result) => sum + result.success, 0);
          const totalFailed = results.reduce((sum, result) => sum + result.failed, 0);
          const totalOperations = totalSuccess + totalFailed;

          // Show appropriate toast based on success/failure counts
          this.showRegistrantOperationToast(totalSuccess, totalFailed, totalOperations);

          if (!this.isEditMode()) {
            this.router.navigate(['/project', this.projectService.project()?.slug, 'meetings']);
          } else {
            this.registrantUpdatesRefresh$.next();
            // Reset registrant updates only if there were some successes
            if (totalSuccess > 0) {
              this.registrantUpdates.set({
                toAdd: [],
                toUpdate: [],
                toDelete: [],
              });
            }
          }
        },
      });
  }

  // Private methods
  private prepareMeetingData(project: any): CreateMeetingRequest | UpdateMeetingRequest {
    const formValue = this.form().value;
    const duration = formValue.duration === 'custom' ? Number(formValue.customDuration) : Number(formValue.duration);
    const startDateTime = combineDateTime(formValue.startDate, formValue.startTime, formValue.timezone);
    const recurrenceObject = generateRecurrenceObject(formValue.recurrence, formValue.startDate);

    return {
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
      platform: formValue.meetingTool || DEFAULT_MEETING_TOOL,
    };
  }

  private handleMeetingSuccess(meeting: Meeting, project: any): void {
    this.meetingId.set(meeting.uid);

    // If we're in create mode and not on the last step, continue to next step
    if (!this.isEditMode() && this.currentStep() < this.totalSteps - 1) {
      this.nextStep();
      this.submitting.set(false);
      return;
    }

    // If we have pending attachments, save them to the database
    if (this.pendingAttachments.length > 0) {
      this.savePendingAttachments(meeting.uid)
        .pipe(take(1))
        .subscribe({
          next: (result) => {
            // Process attachments after meeting save
            this.handleAttachmentResults(result, project);
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
  }

  private handleMeetingError(error: any): void {
    console.error('Error saving meeting:', error);
    this.messageService.add({
      severity: 'error',
      summary: 'Error',
      detail: `Failed to ${this.isEditMode() ? 'update' : 'create'} meeting. Please try again.`,
    });
    this.submitting.set(false);
  }

  private handleAttachmentResults(result: { successes: MeetingAttachment[]; failures: { fileName: string; error: any }[] }, project: any): void {
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
  }

  private showDeleteAttachmentConfirmation(meetingId: string, attachmentId: string, fileName: string): void {
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

  private initializeMeeting() {
    return toSignal(
      this.route.paramMap.pipe(
        switchMap((params) => {
          const meetingId = params.get('id');
          if (meetingId) {
            this.mode.set('edit');
            this.meetingId.set(meetingId);
            return this.meetingService.getMeeting(meetingId).pipe(
              catchError((error) => {
                console.error('Error getting meeting:', error);
                this.messageService.add({
                  severity: 'error',
                  summary: 'Error',
                  detail: 'Meeting not found or you do not have permission to access it',
                });
                this.router.navigate(['/project', this.projectService.project()?.slug, 'meetings']);
                return of(null);
              })
            );
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

    // If recording_enabled is true, enable controls for transcript_enabled and youtube_upload_enabled
    if (meeting.recording_enabled) {
      this.form().get('transcript_enabled')?.enable();
      this.form().get('youtube_upload_enabled')?.enable();
      this.form().get('zoom_ai_enabled')?.enable();
    }

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

      case 4: // Manage Guests (optional)
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

  private buildRegistrantOperations(): Observable<{ type: string; success: number; failed: number }>[] {
    const operations: Observable<{ type: string; success: number; failed: number }>[] = [];
    const meetingId = this.meetingId()!;
    const registrantUpdates = this.registrantUpdates();

    // Add delete operation if there are registrants to delete
    if (registrantUpdates.toDelete.length > 0) {
      operations.push(
        this.meetingService.deleteMeetingRegistrants(meetingId, registrantUpdates.toDelete).pipe(
          switchMap((response: BatchRegistrantOperationResponse<string>) =>
            of({ type: 'delete', success: response.summary.successful, failed: response.summary.failed })
          ),
          catchError((error) => {
            console.error('Error deleting guests:', error);
            return of({ type: 'delete', success: 0, failed: registrantUpdates.toDelete.length });
          })
        )
      );
    }

    // Add update operation if there are registrants to update
    if (registrantUpdates.toUpdate.length > 0) {
      operations.push(
        this.meetingService.updateMeetingRegistrants(meetingId, registrantUpdates.toUpdate).pipe(
          switchMap((response: BatchRegistrantOperationResponse<MeetingRegistrant>) =>
            of({ type: 'update', success: response.summary.successful, failed: response.summary.failed })
          ),
          catchError((error) => {
            console.error('Error updating guests:', error);
            return of({ type: 'update', success: 0, failed: registrantUpdates.toUpdate.length });
          })
        )
      );
    }

    // Add create operation if there are registrants to add
    if (registrantUpdates.toAdd.length > 0) {
      operations.push(
        this.meetingService.addMeetingRegistrants(meetingId, registrantUpdates.toAdd).pipe(
          switchMap((response: BatchRegistrantOperationResponse<MeetingRegistrant>) =>
            of({ type: 'add', success: response.summary.successful, failed: response.summary.failed })
          ),
          catchError((error) => {
            console.error('Error inviting guests:', error);
            return of({ type: 'add', success: 0, failed: registrantUpdates.toAdd.length });
          })
        )
      );
    }

    return operations;
  }

  private showRegistrantOperationToast(totalSuccess: number, totalFailed: number, totalOperations: number): void {
    if (totalSuccess === totalOperations) {
      // All successful
      this.messageService.add({
        severity: 'success',
        summary: 'Success',
        detail: `Successfully updated ${totalSuccess} guests(s)`,
      });
    } else if (totalSuccess > 0 && totalFailed > 0) {
      // Partial success
      this.messageService.add({
        severity: 'warn',
        summary: 'Partial Success',
        detail: `${totalSuccess} guests(s) updated successfully, ${totalFailed} failed`,
      });
    } else if (totalFailed === totalOperations) {
      // All failed
      this.messageService.add({
        severity: 'error',
        summary: 'Operation Failed',
        detail: `Failed to update ${totalFailed} guests(s)`,
      });
    }
  }
}
