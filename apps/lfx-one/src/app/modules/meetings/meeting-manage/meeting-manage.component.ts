// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, effect, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { MessageComponent } from '@components/message/message.component';
import {
  DEFAULT_ARTIFACT_VISIBILITY,
  DEFAULT_DURATION,
  DEFAULT_EARLY_JOIN_TIME,
  DEFAULT_EMAIL_REMINDER_HOURS,
  DEFAULT_EMAIL_REMINDER_MINUTES,
  DEFAULT_MEETING_TOOL,
  DEFAULT_MEETING_TYPE,
  MAX_EARLY_JOIN_TIME,
  MAX_EMAIL_REMINDER_HOURS,
  MAX_EMAIL_REMINDER_TIME,
  MEETING_STEP_TITLES,
  MIN_EARLY_JOIN_TIME,
  MIN_EMAIL_REMINDER_HOURS,
  STEPPER_SCROLL_OFFSET,
  TOTAL_STEPS,
  YOUTUBE_MAX_MEETING_TITLE_LENGTH,
} from '@lfx-one/shared/constants';
import { CancelOnCommitteeRemoval, MeetingType, MeetingVisibility } from '@lfx-one/shared/enums';
import { EntityWithProject } from '@lfx-one/shared/interfaces';
import {
  BatchRegistrantOperationResponse,
  CreateMeetingRequest,
  ImportantLinkFormValue,
  Meeting,
  MeetingAttachment,
  MeetingOwnerInput,
  MeetingRegistrant,
  MeetingUserInfo,
  PendingAttachment,
  PresignAttachmentResponse,
  RegistrantPendingChanges,
  UpdateMeetingRequest,
  Committee,
} from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import {
  combineDateTime,
  formatTo12HourInTimezone,
  generateRecurrenceObject,
  getDefaultStartDateTime,
  getEntityCommands,
  getUserTimezone,
  isRecurrenceNeverEndSentinel,
  mapRecurrenceToFormValue,
  normalizeMeetingApiVotingStatuses,
  resolveMeetingOwner,
  sanitizeMeetingCommittees,
} from '@lfx-one/shared/utils';
import { editModeDateTimeValidator, futureDateTimeValidator } from '@lfx-one/shared/validators';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { toZonedTime } from 'date-fns-tz';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { StepperModule } from 'primeng/stepper';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  concat,
  distinctUntilChanged,
  filter,
  finalize,
  forkJoin,
  from,
  map,
  mergeMap,
  Observable,
  of,
  pairwise,
  startWith,
  Subject,
  switchMap,
  take,
  toArray,
} from 'rxjs';

import { MeetingDetailsComponent } from '../components/meeting-details/meeting-details.component';
import { MeetingPlatformFeaturesComponent } from '../components/meeting-platform-features/meeting-platform-features.component';
import { MeetingRegistrantsManagerComponent } from '../components/meeting-registrants-manager/meeting-registrants-manager.component';
import { MeetingResourcesSummaryComponent } from '../components/meeting-resources-summary/meeting-resources-summary.component';
import { MeetingTypeSelectionComponent } from '../components/meeting-type-selection/meeting-type-selection.component';
import { evictOnWriteAccessLoss } from '@shared/utils/evict-on-write-access-loss.util';
import { syncEntityProjectContext, syncEntityProjectContextFallback } from '@shared/utils/entity-project-context.util';
import { hasMeetingWriteAccess, resolveEntityWriteSlug } from '@shared/utils/write-access.util';

@Component({
  selector: 'lfx-meeting-manage',
  imports: [
    StepperModule,
    ButtonComponent,
    MessageComponent,
    ReactiveFormsModule,
    ConfirmDialogModule,
    MeetingTypeSelectionComponent,
    MeetingDetailsComponent,
    MeetingPlatformFeaturesComponent,
    MeetingResourcesSummaryComponent,
    MeetingRegistrantsManagerComponent,
    RouterLink,
    SkeletonModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './meeting-manage.component.html',
  styleUrl: './meeting-manage.component.scss',
})
export class MeetingManageComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly youtubeMaxLengthValidator = Validators.maxLength(YOUTUBE_MAX_MEETING_TITLE_LENGTH);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly committeeService = inject(CommitteeService);

  // Committee context — when navigated from a committee tab with ?committee_uid=
  public readonly committeeContext = signal<Committee | null>(null);
  private readonly committeeUidFromUrl = this.route.snapshot.queryParamMap.get('committee_uid');

  // Mode and state signals
  public mode = signal<'create' | 'edit'>('create');
  public meetingId = signal<string | null>(null);
  public isEditMode = computed(() => this.mode() === 'edit');
  public originalStartTime = signal<string | null>(null);
  // Owner hydrated from the loaded meeting (edit mode). prepareOwnerData() compares against this
  // to omit the owner key when the picker is untouched — upstream replaces owner as a whole
  // object, so re-sending an unchanged owner would silently drop its stored profile_picture.
  // Exposed publicly so the wizard can pass it down as the organizer picker's revert-on-clear
  // baseline (savedOwner input on lfx-meeting-details).
  public readonly hydratedOwner = signal<MeetingUserInfo | null>(null);
  public registrantUpdates = signal<RegistrantPendingChanges>({
    toAdd: [],
    toUpdate: [],
    toDelete: [],
  });
  // True only when the edit-mode detail fetch failed with a retryable error — anything other
  // than a 404/403 eject (GH-2037). The template swaps the skeleton for an inline error + Retry
  // instead of ejecting the user.
  public meetingLoadError = signal(false);
  // Retry trigger folded into the initializeMeeting pipeline — each next() re-invokes the fetch.
  // Declared before `meeting`: initializeMeeting() reads it during field initialization.
  private readonly retryMeetingLoad$ = new Subject<void>();
  // Initialize meeting data using toSignal
  public meeting = this.initializeMeeting();
  public meetingLoading = computed(() => this.isEditMode() && this.meeting() === null && !this.meetingLoadError());
  // Meeting → EntityWithProject adapter so the active project context syncs from the loaded
  // meeting rather than the cookie-restored last-visited project.
  private readonly meetingEntityContext: Signal<EntityWithProject | null> = this.initializeMeetingEntityContext();
  // Access predicate for evictOnWriteAccessLoss — mirrors writerGuard's meetings standard
  // (project writer, meeting coordinator, or committee writer via ?committee_uid=) so the
  // context switch to the meeting's project doesn't evict guard-admitted organizers.
  private readonly writeAccess: Signal<boolean> = this.initWriteAccess();
  // Initialize meeting attachments with refresh capability
  private attachmentsRefresh$ = new BehaviorSubject<void>(undefined);
  public attachments = this.initializeAttachments();
  // Stepper state - internal step tracking for create mode
  private internalStep = signal<number>(1);
  public currentStep = toSignal(of(1), { initialValue: 1 });
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
  public readonly project = computed(() => this.projectContextService.activeContext());
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
    this.initCommitteeContext();
    evictOnWriteAccessLoss(this.writeAccess);

    // Derive the project context from the loaded meeting so a context-less edit link
    // (/project/meetings/:id/edit) lands in the meeting's project, not the cookie-restored
    // last-visited project. The fallback covers BFF project-enrichment failure.
    // preferEntityKind: a foundation-owned meeting can be edited under a /project/* URL, so the
    // meeting's own is_foundation (not the route prefix) picks the slot and re-points the route
    // lens kind. Opt-in — the other syncEntityProjectContext callers keep URL-prefix
    // behavior (see the util's doc).
    syncEntityProjectContext(this.meetingEntityContext, this.projectContextService, this.router, this.destroyRef, { preferEntityKind: true });
    syncEntityProjectContextFallback(this.meetingEntityContext, this.projectService, this.projectContextService, this.router, this.destroyRef, {
      entityKind: 'meeting',
      freshFetch: (uid) => this.meetingService.getMeetingDetail(uid, { skipCache: true }),
    });

    // Initialize step based on mode
    // In edit mode, read from query parameters
    // In create mode, use internal step tracking
    this.currentStep = toSignal(
      this.route.queryParamMap.pipe(
        switchMap((params) => {
          // In edit mode, use query parameters
          if (this.isEditMode()) {
            const stepParam = params.get('step');
            if (stepParam) {
              const step = parseInt(stepParam, 10);
              if (step >= 1 && step <= this.totalSteps) {
                return of(step);
              }
            }
            return of(1);
          }
          // In create mode, use internal step signal
          return toObservable(this.internalStep);
        })
      ),
      { initialValue: 1 }
    );

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

    // Watch youtube_upload_enabled and enforce title length limit when enabled.
    // This fires correctly on patchValue during edit-mode hydration because the form initialises
    // youtube_upload_enabled as false and patchValue flips it to true, triggering valueChanges.
    this.form()
      .get('youtube_upload_enabled')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((youtubeEnabled: boolean) => {
        const titleControl = this.form().get('title');
        if (!titleControl) return;

        if (youtubeEnabled) {
          titleControl.addValidators(this.youtubeMaxLengthValidator);
        } else {
          titleControl.removeValidators(this.youtubeMaxLengthValidator);
        }
        titleControl.updateValueAndValidity();
        this.updateCanProceed();
      });

    // When Board meeting type is selected, default to private + restricted access.
    // When switching away from Board, reset to public + unrestricted defaults so the
    // user isn't left with Board-level settings silently applied to a non-Board meeting.
    // The user can freely override visibility and restriction after the default is applied.
    this.form()
      .get('meeting_type')
      ?.valueChanges.pipe(startWith(this.form().get('meeting_type')?.value as string), pairwise(), takeUntilDestroyed(this.destroyRef))
      .subscribe(([previousType, currentType]: [string, string]) => {
        if (currentType === MeetingType.BOARD) {
          this.form().patchValue({ visibility: MeetingVisibility.PRIVATE, restricted: true });
        } else if (previousType === MeetingType.BOARD) {
          this.form().patchValue({ visibility: MeetingVisibility.PUBLIC, restricted: false });
        }
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
      if (this.isEditMode()) {
        // In edit mode, update query params — merge so ?project=/?committee_uid= survive
        this.router.navigate([], { queryParams: { step: step }, queryParamsHandling: 'merge' });
      } else {
        // In create mode, update internal step
        this.internalStep.set(step);
      }
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

      if (this.isEditMode()) {
        // In edit mode, update query params — merge so ?project=/?committee_uid= survive
        this.router.navigate([], { queryParams: { step: next }, queryParamsHandling: 'merge' });
      } else {
        // In create mode, update internal step
        this.internalStep.set(next);
      }
      this.scrollToStepper();
    }
  }

  public previousStep(): void {
    const previous = this.currentStep() - 1;
    if (previous >= 1) {
      if (this.isEditMode()) {
        // In edit mode, update query params — merge so ?project=/?committee_uid= survive
        this.router.navigate([], { queryParams: { step: previous }, queryParamsHandling: 'merge' });
      } else {
        // In create mode, update internal step
        this.internalStep.set(previous);
      }
      this.scrollToStepper();
    }
  }

  public onCancel(): void {
    this.navigateBack();
  }

  /** Re-runs the edit-mode detail fetch after a retryable load failure — anything other than a 404/403 eject (GH-2037). */
  public retryMeetingLoad(): void {
    this.meetingLoadError.set(false);
    this.retryMeetingLoad$.next();
  }

  /** Navigates back to the committee meetings tab or the main meetings page. */
  public navigateBack(): void {
    const uid = this.committeeContext()?.uid ?? this.committeeUidFromUrl;
    if (uid) {
      this.router.navigate(['/groups', uid], { queryParams: { tab: 'meetings' } });
    } else {
      this.router.navigate(['/', 'meetings']);
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

    this.submitting.set(true);
    const meetingData = this.prepareMeetingData();

    if (!meetingData.project_uid) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Project is required. Please select a project before saving.',
      });
      this.submitting.set(false);
      return;
    }

    if (this.isEditMode()) {
      this.meetingService.updateMeeting(this.meetingId()!, meetingData as UpdateMeetingRequest, 'single').subscribe({
        next: () => this.handleMeetingSuccess(),
        error: (error) => this.handleMeetingError(error),
      });
    } else {
      this.meetingService.createMeeting(meetingData as CreateMeetingRequest).subscribe({
        next: (meeting) => this.handleMeetingSuccess(meeting),
        error: (error) => this.handleMeetingError(error),
      });
    }
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

  public onSubmitAll(): void {
    // Edit mode only - save meeting, attachments, and registrants together using forkJoin
    if (!this.isEditMode()) {
      return;
    }

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

    // Prepare meeting data
    const meetingData = this.prepareMeetingData();
    const meetingId = this.meetingId()!;
    const updateMeeting$ = this.meetingService.updateMeeting(meetingId, meetingData as UpdateMeetingRequest, 'single');

    // Prepare registrant operations
    const registrantOperations = this.buildRegistrantOperations();
    const registrants$ = registrantOperations.length > 0 ? concat(...registrantOperations).pipe(toArray()) : of([]);

    // Prepare attachment operations
    const attachments$ = this.processAttachmentOperations(meetingId);

    // Execute all operations in parallel
    forkJoin({
      meeting: updateMeeting$,
      registrants: registrants$,
      attachments: attachments$,
    })
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: (result: {
          meeting: void;
          registrants: { type: string; success: number; failed: number }[];
          attachments: {
            deletions: { successes: number; failures: string[] };
            uploads: { successes: PresignAttachmentResponse[]; failures: { fileName: string; error: any }[] };
            links: { successes: MeetingAttachment[]; failures: { linkName: string; error: any }[] };
          } | null;
        }) => {
          const registrantResults = result.registrants;
          const attachmentResults = result.attachments;

          // Calculate registrant operation results
          const totalRegistrantSuccess = registrantResults.reduce((sum: number, r: { type: string; success: number; failed: number }) => sum + r.success, 0);
          const totalRegistrantFailed = registrantResults.reduce((sum: number, r: { type: string; success: number; failed: number }) => sum + r.failed, 0);

          // Calculate attachment operation results
          let totalAttachmentSuccess = 0;
          let totalAttachmentFailed = 0;
          if (attachmentResults) {
            totalAttachmentSuccess =
              attachmentResults.deletions.successes + attachmentResults.uploads.successes.length + attachmentResults.links.successes.length;
            totalAttachmentFailed =
              attachmentResults.deletions.failures.length + attachmentResults.uploads.failures.length + attachmentResults.links.failures.length;

            // Clear pending deletions when operations complete without failures
            if (attachmentResults.deletions.failures.length === 0 && this.pendingAttachmentDeletions().length > 0) {
              this.pendingAttachmentDeletions.set([]);
            }

            // Log individual attachment failures for debugging
            attachmentResults.uploads.failures.forEach((failure) => {
              console.error(`Failed to upload attachment ${failure.fileName}:`, failure.error);
            });
            attachmentResults.links.failures.forEach((failure) => {
              console.error(`Failed to add link ${failure.linkName}:`, failure.error);
            });
            attachmentResults.deletions.failures.forEach((attachmentId) => {
              console.error(`Failed to delete attachment ${attachmentId}`);
            });
          }

          // Show appropriate success message
          this.showSubmitAllOperationToast(totalRegistrantSuccess, totalRegistrantFailed, totalAttachmentSuccess, totalAttachmentFailed);

          // Navigate back to meetings list or group
          this.navigateBack();
        },
        error: (error: any) => {
          console.error('Error saving meeting and registrants:', error);
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to update meeting. Please try again.',
          });
        },
      });
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
            this.navigateBack();
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
    // Use getRawValue() to include disabled controls (e.g., locked committees from group context)
    const formValue = this.form().getRawValue();
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
      project_uid: this.meeting()?.project_uid || this.projectContextService.activeContextUid(),
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
      transcript_enabled: formValue.recording_enabled ? formValue.transcript_enabled || false : false,
      youtube_upload_enabled: formValue.recording_enabled ? formValue.youtube_upload_enabled || false : false,
      show_meeting_attendees: false, // Coming Soon — disabled in form
      ai_summary_enabled: formValue.zoom_ai_enabled || false,
      require_ai_summary_approval: formValue.zoom_ai_enabled ? formValue.require_ai_summary_approval || false : false,
      artifact_visibility: formValue.recording_enabled || formValue.zoom_ai_enabled ? formValue.artifact_visibility || DEFAULT_ARTIFACT_VISIBILITY : null,
      cancel_on_committee_removal:
        formValue.visibility === MeetingVisibility.PUBLIC && formValue.committees?.length
          ? formValue.cancel_on_committee_removal || CancelOnCommitteeRemoval.INHERIT
          : CancelOnCommitteeRemoval.INHERIT,
      auto_email_reminder_enabled: formValue.auto_email_reminder_enabled || false,
      // Total whole minutes before start, clamped to the upstream 120-1440 range. Omitted when disabled:
      // ITX resets the stored time to 0 whenever enabled is explicitly false, so no time value is needed.
      auto_email_reminder_time: formValue.auto_email_reminder_enabled
        ? Math.min(
            Math.max(
              Math.round(Number(formValue.reminderHours || DEFAULT_EMAIL_REMINDER_HOURS) * 60 + Number(formValue.reminderMinutes || 0)),
              MIN_EMAIL_REMINDER_HOURS * 60
            ),
            MAX_EMAIL_REMINDER_TIME
          )
        : undefined,
      recurrence: recurrenceObject,
      platform: formValue.platform || DEFAULT_MEETING_TOOL,
      // Canonicalize stored voting statuses at the save boundary: the form hydrates committees
      // verbatim, so a legacy row would otherwise resubmit display values ('Voting Rep') on an unrelated edit (GH-1796).
      committees: sanitizeMeetingCommittees(formValue.committees).map((committee) => ({
        ...committee,
        allowed_voting_statuses: normalizeMeetingApiVotingStatuses(committee.allowed_voting_statuses),
      })),
      ...this.prepareOwnerData(formValue),
    };
  }

  // Includes `owner` only when the picker was actually used. Empty controls → key omitted
  // (create: upstream defaults owner to the creator; update: stored owner is preserved).
  // An edit whose picker still matches the hydrated owner also omits the key, so upstream
  // keeps the stored owner object intact — including its profile_picture, which the form
  // never carries (UserSearchResult has no avatar field).
  private prepareOwnerData(formValue: any): { owner?: MeetingOwnerInput } {
    const username = (formValue.ownerUsername || '').trim();
    const name = (formValue.ownerName || '').trim();
    const email = (formValue.ownerEmail || '').trim();

    if (!username && !name && !email) {
      return {};
    }

    const hydrated = this.hydratedOwner();
    if (hydrated && hydrated.username === username && hydrated.name === name && hydrated.email === email) {
      return {};
    }

    return {
      owner: {
        ...(username ? { username } : {}),
        ...(name ? { name } : {}),
        ...(email ? { email } : {}),
      },
    };
  }

  // Re-baselines the omit comparison after a successful save: the wizard stays alive afterwards
  // (edit mode routes back to step 5 in this same component instance), so without this a second
  // untouched save would diff against the pre-save owner, re-send an unchanged `owner`, and
  // replace the stored object upstream — dropping any server-side enrichment (profile_picture)
  // the form never carries. All-empty controls leave the baseline alone: that save omitted the
  // key, upstream kept the stored owner, and the existing baseline still describes it.
  private syncHydratedOwnerFromForm(): void {
    const formValue = this.form().getRawValue();
    const username = (formValue.ownerUsername || '').trim();
    const name = (formValue.ownerName || '').trim();
    const email = (formValue.ownerEmail || '').trim();

    if (username || name || email) {
      this.hydratedOwner.set({ username, name, email });
    }
  }

  private handleMeetingSuccess(meeting?: Meeting): void {
    // The stored owner now matches the submitted form (sent, or preserved via omit) — re-baseline
    // before any further save from this same wizard instance.
    this.syncHydratedOwnerFromForm();

    // In create mode, set the meeting ID from the response; in edit mode, it's already set
    if (meeting) {
      this.meetingId.set(meeting.id);
    }

    const meetingId = this.meetingId()!;

    // If we're in create mode and before the resources step (step 4), just continue to next step
    // We need to process attachments starting from step 4 (Resources & Summary) onwards
    if (!this.isEditMode() && this.currentStep() < this.totalSteps - 1) {
      this.nextStep();
      this.submitting.set(false);
      return;
    }

    // Process attachment operations using extracted method
    this.processAttachmentOperations(meetingId).subscribe({
      next: (result) => {
        if (result) {
          // Process attachment operations after meeting save
          this.handleAttachmentOperationsResults(result);
        } else {
          // No attachment operations to process
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: `Meeting ${this.isEditMode() ? 'updated' : 'created'} successfully`,
          });

          this.navigateAfterMeetingSave();
        }
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

        this.navigateAfterMeetingSave();
      },
    });
  }

  private navigateAfterMeetingSave(): void {
    this.submitting.set(false);

    if (this.isEditMode()) {
      // In edit mode, navigate to step 5 to manage guests. Merge so an existing ?project= (or
      // ?committee_uid=) survives — replace semantics would regenerate a context-less link.
      this.router.navigate([], { queryParams: { step: '5' }, queryParamsHandling: 'merge' });
    } else {
      // After creating a meeting, navigate to edit mode on step 5 to manage guests. Carry the
      // active project slug so the edit URL self-heals via projectQueryParamGuard instead of
      // falling back to the cookie-restored context.
      const meetingId = this.meetingId();
      if (meetingId) {
        const editQueryParams: Record<string, string> = { step: '5' };
        const projectSlug = this.projectContextService.activeContext()?.slug;
        if (projectSlug) {
          editQueryParams['project'] = projectSlug;
        }
        const ctx = this.committeeContext();
        if (ctx) {
          editQueryParams['committee_uid'] = ctx.uid;
        }
        // Canonicalize on the created meeting's project tier — the create flow already resolved it
        // (projectQueryParamGuard effectiveKind → isFoundationContext), so no extra fetch is needed.
        const editCommands = getEntityCommands('meetings', meetingId, this.projectContextService.isFoundationContext(), 'edit');
        this.router.navigate(editCommands ?? ['/meetings', meetingId, 'edit'], { queryParams: editQueryParams });
      } else {
        // Fallback to meetings list if no meeting ID
        this.navigateBack();
      }
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
    uploads: { successes: PresignAttachmentResponse[]; failures: { fileName: string; error: any }[] };
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

    this.navigateAfterMeetingSave();
  }

  /**
   * Access predicate driving evictOnWriteAccessLoss. The default predicate (canWrite) is
   * project-writer-only, but writerGuard also admits meetings editors via project
   * meetingCoordinator or writer on the ?committee_uid= committee. The project leg
   * matches meetings-dashboard's initCanWriteMeetings; the committee leg uses the
   * side-effect-free fetchCommittee (the guard's getCommittee tap is for its own deny/allow
   * flow) and the URL snapshot — the param survives step navigations via merge.
   *
   * Two properties keep this from evicting guard-admitted users on transient false:
   *
   * 1. In edit mode the project leg keys off the MEETING's own project (slug, falling back to
   *    uid — the BFF getProject route sniffs UUIDs), the same target writerGuard authorized
   *    against. Keying off activeContext instead would evaluate the stale cookie-restored boot
   *    context, and its false could win the race against syncEntityProjectContext's correction
   *    (a cached boot project resolves faster than the meeting fetch that triggers the switch).
   *    Create mode has no meeting, so the guard-checked active context (?project=) is the key.
   * 2. Each leg is pending (undefined) until its first resolution, and the predicate stays
   *    provisionally true while any applicable leg is pending — writerGuard already authorized
   *    this navigation, so an unresolved leg is not an access-lost signal. Eviction fires only
   *    once every applicable leg has re-checked false; an error or non-writer response still
   *    resolves false there.
   */
  private initWriteAccess(): Signal<boolean> {
    const editMeetingId = this.route.snapshot.paramMap.get('id');
    const projectKey$: Observable<string | null | undefined> = editMeetingId
      ? toObservable(this.meeting).pipe(
          map((meeting) => {
            if (!meeting) {
              // Pending — in edit mode the authorization target comes from the meeting itself.
              return undefined;
            }
            // Mirror writerGuard's resolution order; the active-context fallback covers a meeting
            // carrying neither slug nor uid (the manage component owns that error path).
            return resolveEntityWriteSlug(meeting, this.projectContextService.activeContext()?.slug ?? null);
          })
        )
      : toObservable(this.projectContextService.activeContext).pipe(map((ctx) => ctx?.slug ?? null));

    const projectAccess = toSignal(
      projectKey$.pipe(
        filter((key): key is string | null => key !== undefined),
        distinctUntilChanged(),
        switchMap((key) => {
          if (!key) {
            return of(false);
          }
          return this.projectService.getProject(key, false, { meetingCoordinator: true }).pipe(
            map((project) => hasMeetingWriteAccess(project)),
            catchError(() => of(false))
          );
        })
      )
      // No initialValue: undefined doubles as the leg's pending state (see the doc above).
    );
    const committeeAccess = toSignal(
      this.committeeUidFromUrl
        ? this.committeeService.fetchCommittee(this.committeeUidFromUrl).pipe(
            map((committee) => committee?.writer === true),
            catchError(() => of(false))
          )
        : of(false)
      // No initialValue: undefined doubles as the leg's pending state. Without a committee_uid
      // param the synchronous of(false) resolves the leg immediately, so it never counts as pending.
    );
    return computed(() => {
      const project = projectAccess();
      const committee = committeeAccess();
      if (project === true || committee === true) {
        return true;
      }
      if (project === undefined || committee === undefined) {
        return true; // provisional — a pending leg can still grant access
      }
      return false;
    });
  }

  /**
   * Maps the loaded meeting to the {@link EntityWithProject} shape consumed by
   * syncEntityProjectContext — Meeting carries `id`, not `uid`, and pre-enrichment payloads
   * can lack the project fields entirely, so absent values map to null there.
   */
  private initializeMeetingEntityContext(): Signal<EntityWithProject | null> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting) {
        return null;
      }
      return {
        uid: meeting.id,
        project_uid: meeting.project_uid,
        project_slug: meeting.project_slug,
        project_name: meeting.project_name,
        is_foundation: meeting.is_foundation ?? null,
      };
    });
  }

  private initializeMeeting() {
    return toSignal(
      combineLatest([this.route.paramMap, this.retryMeetingLoad$.pipe(startWith(undefined))]).pipe(
        switchMap(([params]) => {
          const meetingId = params.get('id');
          if (meetingId) {
            this.mode.set('edit');
            this.meetingId.set(meetingId);
            this.meetingLoadError.set(false);
            return this.meetingService.getMeeting(meetingId).pipe(
              catchError((error) => {
                console.error('Error getting meeting:', error);
                // Only a 404/403 ejects (GH-2037) — this fetch is load-bearing (it pre-populates
                // the form), so a transient 5xx/network blip stays mounted with an inline error
                // state + manual Retry rather than mislabeling a server error as "not found".
                // 403 joins the eject path because write access is guard-owned — a forbidden
                // response here means access was lost mid-session, and Retry cannot restore it.
                if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 403)) {
                  this.messageService.add({
                    severity: 'error',
                    summary: 'Error',
                    detail: 'Meeting not found or you do not have permission to access it',
                  });
                  this.navigateBack();
                } else {
                  this.meetingLoadError.set(true);
                }
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
      const utcDate = new Date(meeting.start_time);
      const meetingTimezone = meeting.timezone || getUserTimezone();

      // Convert UTC date to the meeting's timezone for proper display
      // This ensures the date picker and time picker show the correct values
      // in the meeting's timezone, not the user's local timezone
      const zonedDate = toZonedTime(utcDate, meetingTimezone);
      startDate = zonedDate;

      // Convert to 12-hour format in the meeting's timezone for display
      startTime = formatTo12HourInTimezone(utcDate, meetingTimezone);
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
    }

    // Map the stored reminder time (total minutes) back to the hours/minutes helper controls
    let reminderTotalMinutes = DEFAULT_EMAIL_REMINDER_HOURS * 60;
    if (meeting.auto_email_reminder_enabled && meeting.auto_email_reminder_time) {
      reminderTotalMinutes = meeting.auto_email_reminder_time;
    }
    const reminderHours = Math.floor(reminderTotalMinutes / 60);
    if (meeting.auto_email_reminder_enabled) {
      this.form().get('reminderHours')?.enable();
      if (reminderHours !== MAX_EMAIL_REMINDER_HOURS) {
        this.form().get('reminderMinutes')?.enable();
      }
    }

    // Hydrate the owner picker from the stored owner; zero-valued and service-account owners
    // resolve to null, so the picker shows empty and prepareOwnerData() omits the key on save.
    const ownerInfo = resolveMeetingOwner(meeting);
    this.hydratedOwner.set(ownerInfo);

    this.form().patchValue({
      title: meeting.title,
      description: meeting.description,
      meeting_type: meeting.meeting_type || 'None',
      startDate: startDate,
      startTime: startTime,
      duration: meeting.duration || DEFAULT_DURATION,
      timezone: meeting.timezone || getUserTimezone(),
      early_join_time_minutes: meeting.early_join_time_minutes || DEFAULT_EARLY_JOIN_TIME,
      ownerUsername: ownerInfo?.username || null,
      ownerName: ownerInfo?.name || null,
      ownerEmail: ownerInfo?.email || null,
      isRecurring: Boolean(meeting.recurrence && finalRecurrenceValue !== 'none'),
      visibility: meeting.visibility || MeetingVisibility.PRIVATE,
      restricted: meeting.restricted ?? false,
      recording_enabled: meeting.recording_enabled || false,
      transcript_enabled: meeting.transcript_enabled || false,
      youtube_upload_enabled: meeting.youtube_upload_enabled || false,
      show_meeting_attendees: meeting.show_meeting_attendees || false,
      zoom_ai_enabled: meeting.ai_summary_enabled || false,
      require_ai_summary_approval: meeting.require_ai_summary_approval ?? false,
      artifact_visibility: meeting.artifact_visibility ?? DEFAULT_ARTIFACT_VISIBILITY,
      cancel_on_committee_removal: meeting.cancel_on_committee_removal ?? CancelOnCommitteeRemoval.INHERIT,
      auto_email_reminder_enabled: meeting.auto_email_reminder_enabled ?? false,
      reminderHours: reminderHours,
      reminderMinutes: reminderTotalMinutes % 60,
      recurrenceType: finalRecurrenceValue,
      committees: sanitizeMeetingCommittees(meeting.committees),
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
      const recurrenceEndDateTime = meeting.recurrence.end_date_time;
      const isSentinel = isRecurrenceNeverEndSentinel(recurrenceEndDateTime);
      if (recurrenceEndDateTime && !isSentinel) endTypeUI = 'date';
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
          end_date_time: meeting.recurrence.end_date_time && !isSentinel ? new Date(meeting.recurrence.end_date_time) : null,
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
    const next = this.currentStep() + 1;
    const isValid = next <= this.totalSteps ? this.canNavigateToStep(next) : this.isStepValid(this.currentStep());
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
          form.get('startDate')?.value &&
          form.get('startTime')?.value &&
          form.get('timezone')?.value &&
          form.get('title')?.valid &&
          form.get('startDate')?.valid &&
          form.get('startTime')?.valid &&
          (form.get('ownerEmail')?.valid ?? true) &&
          !form.errors?.['futureDateTime']
        );

      case 3: // Platform & Features
        // Reminder controls use `invalid ?? true` (not `.valid`) because a disabled control (toggle off,
        // or minutes locked at the 24h max) reports valid === false and would wrongly block the step;
        // the ?? true fallback still fails closed if the controls are ever missing from the form.
        return (form.get('platform')?.valid ?? false) && !(form.get('reminderHours')?.invalid ?? true) && !(form.get('reminderMinutes')?.invalid ?? true);

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
        meeting_type: new FormControl('', [Validators.required]),
        visibility: new FormControl(MeetingVisibility.PUBLIC),
        restricted: new FormControl(false),

        // Step 2: Meeting Details
        title: new FormControl('', [Validators.required]),
        description: new FormControl('', [Validators.maxLength(2000)]),
        aiPrompt: new FormControl(''),
        startDate: new FormControl(defaultDateTime.date, [Validators.required]),
        startTime: new FormControl(defaultDateTime.time, [Validators.required]),
        duration: new FormControl(DEFAULT_DURATION, [Validators.required]),
        customDuration: new FormControl(''),
        timezone: new FormControl(getUserTimezone(), [Validators.required]),
        early_join_time_minutes: new FormControl(DEFAULT_EARLY_JOIN_TIME, [Validators.min(MIN_EARLY_JOIN_TIME), Validators.max(MAX_EARLY_JOIN_TIME)]),
        // Optional meeting organizer (owner). No profile_picture control — UserSearchResult
        // carries no avatar; upstream keeps the stored one when the owner key is omitted.
        ownerUsername: new FormControl<string | null>(null),
        ownerName: new FormControl<string | null>(null),
        ownerEmail: new FormControl<string | null>(null, [Validators.email]),
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
        show_meeting_attendees: new FormControl({ value: false, disabled: true }),
        zoom_ai_enabled: new FormControl(false),
        require_ai_summary_approval: new FormControl(false),
        artifact_visibility: new FormControl(DEFAULT_ARTIFACT_VISIBILITY),
        cancel_on_committee_removal: new FormControl(CancelOnCommitteeRemoval.INHERIT),
        auto_email_reminder_enabled: new FormControl(false),
        reminderHours: new FormControl({ value: DEFAULT_EMAIL_REMINDER_HOURS, disabled: true }, [
          Validators.required,
          Validators.pattern(/^\d+$/),
          Validators.min(MIN_EMAIL_REMINDER_HOURS),
          Validators.max(MAX_EMAIL_REMINDER_HOURS),
        ]),
        reminderMinutes: new FormControl({ value: DEFAULT_EMAIL_REMINDER_MINUTES, disabled: true }, [
          Validators.required,
          Validators.pattern(/^\d+$/),
          Validators.min(0),
          Validators.max(59),
        ]),

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
    const project = this.projectContextService.activeContext();

    // Only auto-generate if we have meeting type, start date, and the title is empty
    const currentTitle = form.get('title')?.value;
    if (meetingType && startDate && (!currentTitle || currentTitle.trim() === '')) {
      const formattedDate = new Date(startDate).toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
      });

      const projectName = project?.name || '';
      const generatedTitle = `${projectName} ${meetingType} Meeting - ${formattedDate}`;
      form.get('title')?.setValue(generatedTitle);
    }
  }

  private processAttachmentOperations(meetingId: string): Observable<{
    deletions: { successes: number; failures: string[] };
    uploads: { successes: PresignAttachmentResponse[]; failures: { fileName: string; error: any }[] };
    links: { successes: MeetingAttachment[]; failures: { linkName: string; error: any }[] };
  } | null> {
    const hasPendingDeletions = this.pendingAttachmentDeletions().length > 0;
    const hasPendingUploads = this.pendingAttachments.length > 0;
    const importantLinksArray = this.form().get('important_links') as FormArray;
    const hasPendingLinks = importantLinksArray.length > 0;

    // If no pending operations, return null
    if (!hasPendingDeletions && !hasPendingUploads && !hasPendingLinks) {
      return of(null);
    }

    // Process deletions, then uploads, then links
    return this.deletePendingAttachments(meetingId).pipe(
      switchMap((deletionResult) =>
        this.savePendingAttachments(meetingId).pipe(
          switchMap((uploadResult) =>
            this.saveLinkAttachments(meetingId).pipe(
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
    );
  }

  private deletePendingAttachments(meetingId: string): Observable<{ successes: number; failures: string[] }> {
    const attachmentIdsToDelete = this.pendingAttachmentDeletions();

    if (attachmentIdsToDelete.length === 0) {
      return of({ successes: 0, failures: [] });
    }

    return from(attachmentIdsToDelete).pipe(
      mergeMap((attachmentId) =>
        this.meetingService.deleteMeetingAttachment(meetingId, attachmentId).pipe(
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

  private savePendingAttachments(meetingId: string): Observable<{ successes: PresignAttachmentResponse[]; failures: { fileName: string; error: any }[] }> {
    const attachmentsToSave = this.pendingAttachments.filter(
      (attachment) => !attachment.uploading && !attachment.uploadError && !attachment.uploaded && attachment.file
    );

    if (attachmentsToSave.length === 0) {
      return of({ successes: [], failures: [] });
    }

    return from(attachmentsToSave).pipe(
      mergeMap((attachment) =>
        this.meetingService
          .uploadMeetingFile(meetingId, attachment.file, {
            name: attachment.fileName,
            file_size: attachment.fileSize,
            file_type: attachment.mimeType,
          })
          .pipe(
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
        this.meetingService.createMeetingAttachment(meetingId, { type: 'link', category: 'Other', name: link.title, link: link.url }).pipe(
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

  private showSubmitAllOperationToast(registrantSuccess: number, registrantFailed: number, attachmentSuccess: number, attachmentFailed: number): void {
    const totalSuccess = registrantSuccess + attachmentSuccess;
    const totalFailed = registrantFailed + attachmentFailed;
    const hasOperations = totalSuccess > 0 || totalFailed > 0;

    if (!hasOperations) {
      // No additional operations, just meeting update
      this.messageService.add({
        severity: 'success',
        summary: 'Success',
        detail: 'Meeting updated successfully',
      });
      return;
    }

    if (totalFailed === 0) {
      // All successful
      this.messageService.add({
        severity: 'success',
        summary: 'Success',
        detail: `Meeting updated successfully`,
      });
    } else if (totalSuccess > 0 && totalFailed > 0) {
      // Partial success
      const successParts = [];
      const failureParts = [];

      if (registrantSuccess > 0) successParts.push(`${registrantSuccess} guest(s)`);
      if (attachmentSuccess > 0) successParts.push(`${attachmentSuccess} attachment(s)`);
      if (registrantFailed > 0) failureParts.push(`${registrantFailed} guest(s)`);
      if (attachmentFailed > 0) failureParts.push(`${attachmentFailed} attachment(s)`);

      this.messageService.add({
        severity: 'warn',
        summary: 'Partial Success',
        detail: `Meeting updated. ${successParts.join(' and ')} succeeded, ${failureParts.join(' and ')} failed`,
      });
    } else {
      // All additional operations failed
      this.messageService.add({
        severity: 'warn',
        summary: 'Meeting Updated',
        detail: 'Meeting updated but some operations failed. You can manage them later.',
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

    // End conditions (end date or occurrence count) — exclude the sentinel, which means "never ends"
    if (recurrence.end_date_time && !isRecurrenceNeverEndSentinel(recurrence.end_date_time)) return true;
    if ((recurrence.end_times ?? 0) > 0) return true;

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

  /** Reads committee_uid from queryParams and pre-populates the committees field (locked). */
  private initCommitteeContext(): void {
    this.route.queryParamMap
      .pipe(
        take(1),
        filter((params) => !!params.get('committee_uid') && !this.route.snapshot.paramMap.has('id')),
        switchMap((params) => this.committeeService.getCommittee(params.get('committee_uid')!)),
        catchError(() => {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load group context.' });
          return of(null);
        })
      )
      .subscribe((committee) => {
        if (!committee) return;
        this.committeeContext.set(committee);
        const committeesControl = this.form().get('committees');
        committeesControl?.setValue([{ uid: committee.uid, name: committee.name }]);
        committeesControl?.disable();
      });
  }
}
