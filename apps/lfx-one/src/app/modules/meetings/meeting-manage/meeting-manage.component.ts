// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
} from '@lfx-one/shared/constants';
import { MeetingVisibility } from '@lfx-one/shared/enums';
import {
  BatchRegistrantOperationResponse,
  CreateMeetingRequest,
  ImportantLinkFormValue,
  Meeting,
  MeetingAttachment,
  MeetingRegistrant,
  PendingAttachment,
  RegistrantPendingChanges,
  UpdateMeetingRequest,
} from '@lfx-one/shared/interfaces';
import {
  combineDateTime,
  formatTo12Hour,
  generateRecurrenceObject,
  getDefaultStartDateTime,
  getUserTimezone,
  mapRecurrenceToFormValue,
} from '@lfx-one/shared/utils';
import { editModeDateTimeValidator, futureDateTimeValidator } from '@lfx-one/shared/validators';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { StepperModule } from 'primeng/stepper';
import { TabsModule } from 'primeng/tabs';
import { BehaviorSubject, catchError, concat, filter, finalize, from, mergeMap, Observable, of, switchMap, take, toArray } from 'rxjs';

import { MeetingDetailsComponent } from '../components/meeting-details/meeting-details.component';
import { MeetingPlatformFeaturesComponent } from '../components/meeting-platform-features/meeting-platform-features.component';
import { MeetingRegistrantsManagerComponent } from '../components/meeting-registrants-manager/meeting-registrants-manager.component';
import { MeetingResourcesSummaryComponent } from '../components/meeting-resources-summary/meeting-resources-summary.component';
import { MeetingTypeSelectionComponent } from '../components/meeting-type-selection/meeting-type-selection.component';

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
    MeetingRegistrantsManagerComponent,
    TabsModule,
    RouterLink,
  ],
  providers: [ConfirmationService],
  templateUrl: './meeting-manage.component.html',
})
export class MeetingManageComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly projectContextService = inject(ProjectContextService);
  // Mode and state signals
  public mode = signal<'create' | 'edit'>('create');
  public meetingId = signal<string | null>(null);
  public isEditMode = computed(() => this.mode() === 'edit');
  public originalStartTime = signal<string | null>(null);
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
  public currentStep = signal<number>(1);
  public readonly totalSteps = TOTAL_STEPS;
  // Form state
  public form = signal<FormGroup>(this.createMeetingFormGroup());
  public submitting = signal<boolean>(false);
  public deletingAttachmentId = signal<string | null>(null);
  public pendingAttachmentDeletions = signal<string[]>([]);
  // Registrant updates refresh
  public registrantUpdatesRefresh$ = new BehaviorSubject<void>(undefined);

  // Get pending attachments from the form
  private get pendingAttachments(): PendingAttachment[] {
    return this.form().get('attachments')?.value || [];
  }

  // Validation signals for template
  public readonly canProceed = signal<boolean>(false);
  public readonly canGoNext = computed(() => this.currentStep() + 1 < this.totalSteps && this.canNavigateToStep(this.currentStep() + 1));
  public readonly canGoPrevious = computed(() => this.currentStep() > 1);
  public readonly isFirstStep = computed(() => this.currentStep() === 1);
  public readonly isLastMeetingStep = computed(() => this.currentStep() === this.totalSteps - 1);
  public readonly isLastStep = computed(() => this.currentStep() === this.totalSteps);
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

    // Effect for step changes only - handles validation
    effect(() => {
      // Access the signal to create dependency
      this.currentStep();
      // Update validation when step changes
      this.updateCanProceed();
    });

    // Separate subscription for meeting data changes - populates form only once
    toObservable(this.meeting)
      .pipe(
        filter((meeting): meeting is Meeting => meeting !== null && this.isEditMode()),
        take(1) // Only populate the form once
      )
      .subscribe((meeting) => {
        this.populateFormWithMeetingData(meeting);
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
    if (next <= this.totalSteps && this.canNavigateToStep(next)) {
      // Auto-generate title when moving from step 1 to step 2
      if (this.currentStep() === 1 && next === 2) {
        this.generateMeetingTitle();
      }

      this.currentStep.set(next);
      this.scrollToStepper();
    }
  }

  public previousStep(): void {
    const previous = this.currentStep() - 1;
    if (previous >= 1) {
      this.currentStep.set(previous);
      this.scrollToStepper();
    }
  }

  public onCancel(): void {
    this.router.navigate(['/', 'meetings']);
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

    this.submitting.set(true);
    const meetingData = this.prepareMeetingData();
    const operation = this.isEditMode()
      ? this.meetingService.updateMeeting(this.meetingId()!, meetingData as UpdateMeetingRequest, 'single')
      : this.meetingService.createMeeting(meetingData as CreateMeetingRequest);

    operation.subscribe({
      next: (meeting) => this.handleMeetingSuccess(meeting),
      error: (error) => this.handleMeetingError(error),
    });
  }

  public deleteAttachment(attachmentId: string): void {
    this.pendingAttachmentDeletions.update((current) => [...current, attachmentId]);
  }

  public undoDeleteAttachment(attachmentId: string): void {
    this.pendingAttachmentDeletions.update((current) => current.filter((id) => id !== attachmentId));
  }

  public deleteLinkAttachment(attachmentId: string): void {
    // When a link with an existing attachment uid is removed from the form,
    // add it to pending deletions so it gets deleted on save
    this.pendingAttachmentDeletions.update((current) => [...current, attachmentId]);
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
            this.router.navigate(['/', 'meetings']);
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
  private prepareMeetingData(): CreateMeetingRequest | UpdateMeetingRequest {
    const formValue = this.form().value;
    const duration = formValue.duration === 'custom' ? Number(formValue.customDuration) : Number(formValue.duration);
    const startDateTime = combineDateTime(formValue.startDate, formValue.startTime, formValue.timezone);

    // Handle recurrence - use FormGroup value directly
    let recurrenceObject: any = null;
    if (formValue.recurrenceType === 'custom' && formValue.recurrence.type) {
      // Filter out null values and UI helper controls from the recurrence FormGroup
      recurrenceObject = Object.keys(formValue.recurrence)
        .filter(
          (key) => formValue.recurrence[key] !== null && formValue.recurrence[key] !== undefined && !key.endsWith('UI') // Exclude UI helper controls
        )
        .reduce((obj, key) => {
          obj[key] = formValue.recurrence[key];
          return obj;
        }, {} as any);
    } else if (formValue.recurrenceType && formValue.recurrenceType !== 'none') {
      // For simple patterns, use the recurrence FormGroup if it has valid data
      if (formValue.recurrence.type && formValue.recurrence.repeat_interval > 0) {
        recurrenceObject = Object.keys(formValue.recurrence)
          .filter(
            (key) => formValue.recurrence[key] !== null && formValue.recurrence[key] !== undefined && !key.endsWith('UI') // Exclude UI helper controls
          )
          .reduce((obj, key) => {
            obj[key] = formValue.recurrence[key];
            return obj;
          }, {} as any);
      } else {
        // Fallback to the old method for simple patterns
        recurrenceObject = generateRecurrenceObject(formValue.recurrenceType, formValue.startDate);
      }
    }

    return {
      project_uid: formValue.selectedProjectUid || this.projectContextService.getProjectUid(),
      title: formValue.title,
      description: formValue.description || '',
      start_time: startDateTime,
      duration: duration,
      timezone: formValue.timezone,
      meeting_type: formValue.meeting_type || DEFAULT_MEETING_TYPE,
      early_join_time_minutes: (() => {
        const parsed = parseInt(formValue.early_join_time_minutes, 10);
        return isNaN(parsed) ? DEFAULT_EARLY_JOIN_TIME : parsed;
      })(),
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
      platform: formValue.platform || DEFAULT_MEETING_TOOL,
      committees: formValue.committees || [],
    };
  }

  private handleMeetingSuccess(meeting: Meeting): void {
    this.meetingId.set(meeting.uid);

    // If we're in create mode and not on the last step, continue to next step
    if (!this.isEditMode() && this.currentStep() < this.totalSteps) {
      this.nextStep();
      this.submitting.set(false);
      return;
    }

    const hasPendingDeletions = this.pendingAttachmentDeletions().length > 0;
    const hasPendingUploads = this.pendingAttachments.length > 0;
    const importantLinksArray = this.form().get('important_links') as FormArray;
    const hasPendingLinks = importantLinksArray.length > 0;

    // If we have pending deletions, uploads, or links, process them
    if (hasPendingDeletions || hasPendingUploads || hasPendingLinks) {
      // Process deletions, then uploads, then links
      this.deletePendingAttachments(meeting.uid)
        .pipe(
          switchMap((deletionResult) =>
            this.savePendingAttachments(meeting.uid).pipe(
              switchMap((uploadResult) =>
                this.saveLinkAttachments(meeting.uid).pipe(
                  switchMap((linkResult) =>
                    of({
                      deletions: deletionResult,
                      uploads: uploadResult,
                      links: linkResult,
                    })
                  )
                )
              )
            )
          ),
          take(1)
        )
        .subscribe({
          next: (result) => {
            // Process attachment operations after meeting save
            this.handleAttachmentOperationsResults(result);
          },
          error: (attachmentError: any) => {
            console.error('Error processing attachments:', attachmentError);
            const warningMessage = this.isEditMode()
              ? 'Meeting updated but some attachment operations failed. You can manage them later.'
              : 'Meeting created but some attachment operations failed. You can manage them later.';
            this.messageService.add({
              severity: 'warn',
              summary: this.isEditMode() ? 'Meeting Updated' : 'Meeting Created',
              detail: warningMessage,
            });
            this.router.navigate(['/meetings']);
          },
        });
    } else {
      this.messageService.add({
        severity: 'success',
        summary: 'Success',
        detail: `Meeting ${this.isEditMode() ? 'updated' : 'created'} successfully`,
      });
      this.router.navigate(['/meetings']);
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

  private handleAttachmentOperationsResults(result: {
    deletions: { successes: number; failures: string[] };
    uploads: { successes: MeetingAttachment[]; failures: { fileName: string; error: any }[] };
    links: { successes: MeetingAttachment[]; failures: { linkName: string; error: any }[] };
  }): void {
    const totalDeleteSuccesses = result.deletions.successes;
    const totalDeleteFailures = result.deletions.failures.length;
    const totalUploadSuccesses = result.uploads.successes.length;
    const totalUploadFailures = result.uploads.failures.length;
    const totalLinkSuccesses = result.links.successes.length;
    const totalLinkFailures = result.links.failures.length;

    const totalOperations = totalDeleteSuccesses + totalDeleteFailures + totalUploadSuccesses + totalUploadFailures + totalLinkSuccesses + totalLinkFailures;

    if (totalDeleteFailures === 0 && totalUploadFailures === 0 && totalLinkFailures === 0 && totalOperations > 0) {
      // All operations successful
      const parts = [];
      if (totalDeleteSuccesses > 0) parts.push(`${totalDeleteSuccesses} attachment(s) deleted`);
      if (totalUploadSuccesses > 0) parts.push(`${totalUploadSuccesses} file(s) uploaded`);
      if (totalLinkSuccesses > 0) parts.push(`${totalLinkSuccesses} link(s) added`);

      const successMessage = this.isEditMode()
        ? `Meeting updated successfully${parts.length > 0 ? ': ' + parts.join(', ') : ''}`
        : `Meeting created successfully${parts.length > 0 ? ' with ' + parts.join(' and ') : ''}`;

      this.messageService.add({
        severity: 'success',
        summary: 'Success',
        detail: successMessage,
      });
    } else if (totalOperations > 0 && (totalDeleteSuccesses > 0 || totalUploadSuccesses > 0 || totalLinkSuccesses > 0)) {
      // Partial success
      const successParts = [];
      if (totalDeleteSuccesses > 0) successParts.push(`${totalDeleteSuccesses} deleted`);
      if (totalUploadSuccesses > 0) successParts.push(`${totalUploadSuccesses} files uploaded`);
      if (totalLinkSuccesses > 0) successParts.push(`${totalLinkSuccesses} links added`);

      const failureParts = [];
      if (totalDeleteFailures > 0) failureParts.push(`${totalDeleteFailures} failed to delete`);
      if (totalUploadFailures > 0) failureParts.push(`${totalUploadFailures} files failed to upload`);
      if (totalLinkFailures > 0) failureParts.push(`${totalLinkFailures} links failed to add`);

      const partialMessage = this.isEditMode()
        ? `Meeting updated: ${successParts.join(', ')}. ${failureParts.join(', ')}.`
        : `Meeting created: ${successParts.join(', ')}. ${failureParts.join(', ')}.`;

      this.messageService.add({
        severity: 'warn',
        summary: this.isEditMode() ? 'Meeting Updated' : 'Meeting Created',
        detail: partialMessage,
      });
    } else if (totalOperations === 0) {
      // No attachment operations
      this.messageService.add({
        severity: 'success',
        summary: 'Success',
        detail: `Meeting ${this.isEditMode() ? 'updated' : 'created'} successfully`,
      });
    } else {
      // All failed
      const errorMessage = this.isEditMode()
        ? 'Meeting updated but attachment operations failed. You can manage them later.'
        : 'Meeting created but attachment operations failed. You can manage them later.';

      this.messageService.add({
        severity: 'warn',
        summary: this.isEditMode() ? 'Meeting Updated' : 'Meeting Created',
        detail: errorMessage,
      });
    }

    // Log individual failures for debugging
    result.uploads.failures.forEach((failure) => {
      console.error(`Failed to upload attachment ${failure.fileName}:`, failure.error);
    });
    result.links.failures.forEach((failure) => {
      console.error(`Failed to add link ${failure.linkName}:`, failure.error);
    });
    result.deletions.failures.forEach((attachmentId) => {
      console.error(`Failed to delete attachment ${attachmentId}`);
    });

    // Clear pending deletions when operations complete without failures
    if (totalDeleteFailures === 0 && this.pendingAttachmentDeletions().length > 0) {
      this.pendingAttachmentDeletions.set([]);
    }

    this.router.navigate(['/meetings']);
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
                this.router.navigate(['/meetings']);
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
    // Store the original start time for validation
    this.originalStartTime.set(meeting.start_time);

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

    // Check if this is a complex recurrence that needs custom handling
    const isCustomRecurrence = this.needsCustomRecurrence(meeting.recurrence);
    const finalRecurrenceValue = isCustomRecurrence ? 'custom' : recurrenceValue;

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
      isRecurring: Boolean(meeting.recurrence && finalRecurrenceValue !== 'none'),
      visibility: meeting.visibility || MeetingVisibility.PRIVATE,
      restricted: meeting.restricted ?? false,
      recording_enabled: meeting.recording_enabled || false,
      transcript_enabled: meeting.transcript_enabled || false,
      youtube_upload_enabled: meeting.youtube_upload_enabled || false,
      zoom_ai_enabled: meeting.zoom_config?.ai_companion_enabled || false,
      require_ai_summary_approval: meeting.zoom_config?.ai_summary_require_approval ?? false,
      artifact_visibility: meeting.artifact_visibility ?? DEFAULT_ARTIFACT_VISIBILITY,
      recurrenceType: finalRecurrenceValue,
      committees: meeting.committees || [],
    });

    // Populate the recurrence FormGroup if there's recurrence data
    if (meeting.recurrence) {
      // Set up UI helpers based on recurrence data
      let patternTypeUI = 'weekly';
      if (meeting.recurrence.type === 1) patternTypeUI = 'daily';
      else if (meeting.recurrence.type === 2) patternTypeUI = 'weekly';
      else if (meeting.recurrence.type === 3) patternTypeUI = 'monthly';

      let monthlyTypeUI = 'dayOfMonth';
      if (meeting.recurrence.monthly_day) monthlyTypeUI = 'dayOfMonth';
      else if (meeting.recurrence.monthly_week && meeting.recurrence.monthly_week_day) monthlyTypeUI = 'dayOfWeek';

      let endTypeUI = 'never';
      if (meeting.recurrence.end_date_time) endTypeUI = 'date';
      else if (meeting.recurrence.end_times) endTypeUI = 'occurrences';

      // Set the pattern type UI control if this is custom recurrence
      if (isCustomRecurrence) {
        this.form().get('patternTypeUI')?.setValue(patternTypeUI);
      }

      this.form()
        .get('recurrence')
        ?.patchValue({
          type: meeting.recurrence.type || null,
          repeat_interval: meeting.recurrence.repeat_interval || 1,
          weekly_days: meeting.recurrence.weekly_days || null,
          monthly_day: meeting.recurrence.monthly_day || null,
          monthly_week: meeting.recurrence.monthly_week || null,
          monthly_week_day: meeting.recurrence.monthly_week_day || null,
          end_date_time: meeting.recurrence.end_date_time ? new Date(meeting.recurrence.end_date_time) : null,
          end_times: meeting.recurrence.end_times || null,
          // UI helper controls
          monthlyTypeUI: monthlyTypeUI,
          endTypeUI: endTypeUI,
        });
    }

    // Populate important_links FormArray with existing link-type attachments
    this.populateExistingLinks();

    // Update the form validator to use edit mode validator with original start time
    this.updateFormValidator();
  }

  private populateExistingLinks(): void {
    const attachments = this.attachments();
    const linkAttachments = attachments.filter((att: MeetingAttachment) => att.type === 'link');

    if (linkAttachments.length === 0) {
      return;
    }

    const importantLinksArray = this.form().get('important_links') as FormArray;

    // Clear existing form array
    while (importantLinksArray.length > 0) {
      importantLinksArray.removeAt(0);
    }

    // Add existing link attachments to the form array
    linkAttachments.forEach((linkAttachment: MeetingAttachment) => {
      const linkFormGroup = new FormGroup({
        id: new FormControl(crypto.randomUUID()),
        title: new FormControl(linkAttachment.name),
        url: new FormControl(linkAttachment.link || ''),
        uid: new FormControl(linkAttachment.uid), // Track the attachment UID
      });

      importantLinksArray.push(linkFormGroup);
    });
  }

  private canNavigateToStep(step: number): boolean {
    // Allow navigation to previous steps or current step
    if (step <= this.currentStep()) {
      return true;
    }

    // For forward navigation, validate all previous steps
    for (let i = 1; i < step; i++) {
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
      case 1: // Meeting Type
        return !!form.get('meeting_type')?.value && form.get('meeting_type')?.value !== '';

      case 2: // Meeting Details
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

      case 3: // Platform & Features
        return form.get('platform')?.valid ?? false;

      case 4: // Resources & Summary (optional)
      case 5: // Manage Guests (optional)
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
        selectedProjectUid: new FormControl(''),
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
        recurrenceType: new FormControl('none'),
        patternTypeUI: new FormControl('weekly'),
        recurrence: new FormGroup({
          type: new FormControl(null),
          repeat_interval: new FormControl(1),
          weekly_days: new FormControl(null),
          monthly_day: new FormControl(null),
          monthly_week: new FormControl(null),
          monthly_week_day: new FormControl(null),
          end_date_time: new FormControl(null),
          end_times: new FormControl(null),
          // UI helper controls
          monthlyTypeUI: new FormControl('dayOfMonth'),
          endTypeUI: new FormControl('never'),
        }),

        // Step 3: Platform & Features
        platform: new FormControl(DEFAULT_MEETING_TOOL, [Validators.required]),
        recording_enabled: new FormControl(false),
        transcript_enabled: new FormControl({ value: false, disabled: true }),
        youtube_upload_enabled: new FormControl({ value: false, disabled: true }),
        zoom_ai_enabled: new FormControl({ value: false, disabled: true }),
        require_ai_summary_approval: new FormControl(false),
        artifact_visibility: new FormControl(DEFAULT_ARTIFACT_VISIBILITY),

        // Step 4: Resources & Summary
        attachments: new FormControl<PendingAttachment[]>([]),
        important_links: new FormArray([]),
        committees: new FormControl([]),
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
    const project = this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation();

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

  private deletePendingAttachments(meetingId: string): Observable<{ successes: number; failures: string[] }> {
    const attachmentIdsToDelete = this.pendingAttachmentDeletions();

    if (attachmentIdsToDelete.length === 0) {
      return of({ successes: 0, failures: [] });
    }

    return from(attachmentIdsToDelete).pipe(
      mergeMap((attachmentId) =>
        this.meetingService.deleteAttachment(meetingId, attachmentId).pipe(
          switchMap(() => of({ success: attachmentId, failure: null })),
          catchError(() => of({ success: null, failure: attachmentId }))
        )
      ),
      toArray(),
      switchMap((results) => {
        const successes = results.filter((r) => r.success).length;
        const failures = results.filter((r) => r.failure).map((r) => r.failure!);
        return of({ successes, failures });
      }),
      take(1)
    );
  }

  private savePendingAttachments(meetingId: string): Observable<{ successes: MeetingAttachment[]; failures: { fileName: string; error: any }[] }> {
    const attachmentsToSave = this.pendingAttachments.filter(
      (attachment) => !attachment.uploading && !attachment.uploadError && !attachment.uploaded && attachment.file
    );

    if (attachmentsToSave.length === 0) {
      return of({ successes: [], failures: [] });
    }

    return from(attachmentsToSave).pipe(
      mergeMap((attachment) =>
        this.meetingService.createFileAttachment(meetingId, attachment.file).pipe(
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

  private saveLinkAttachments(meetingId: string): Observable<{ successes: MeetingAttachment[]; failures: { linkName: string; error: any }[] }> {
    const importantLinksArray = this.form().get('important_links') as FormArray;
    // Only save links that don't have a uid (new links)
    // Links with uid already exist as attachments and don't need to be recreated
    const linksToSave = (importantLinksArray.value as ImportantLinkFormValue[]).filter((link) => link.title && link.url && !link.uid);

    if (linksToSave.length === 0) {
      return of({ successes: [], failures: [] });
    }

    return from(linksToSave).pipe(
      mergeMap((link: ImportantLinkFormValue) =>
        this.meetingService.createAttachmentFromUrl(meetingId, link.title, link.url).pipe(
          switchMap((result) => of({ success: result, failure: null })),
          catchError((error) => of({ success: null, failure: { linkName: link.title, error } }))
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
        takeUntilDestroyed(this.destroyRef),
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

  private needsCustomRecurrence(recurrence: any): boolean {
    if (!recurrence) return false;

    // Check if this recurrence pattern requires custom handling
    // (e.g., custom intervals, multiple days, complex monthly patterns, end conditions)

    // Custom interval (not 1)
    if (recurrence.repeat_interval && recurrence.repeat_interval !== 1) return true;

    // Multiple days selected for weekly
    if (recurrence.weekly_days && recurrence.weekly_days.split(',').length > 1) return true;

    // End conditions (end date or occurrence count)
    if (recurrence.end_date_time || recurrence.end_times) return true;

    return false;
  }

  private updateFormValidator(): void {
    const currentForm = this.form();

    // Apply appropriate validator based on mode
    if (this.isEditMode() && this.originalStartTime()) {
      currentForm.setValidators(editModeDateTimeValidator(this.originalStartTime()!));
    } else {
      currentForm.setValidators(futureDateTimeValidator());
    }

    // Update form validity
    currentForm.updateValueAndValidity();
  }
}
