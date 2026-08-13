// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
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
  MIN_EARLY_JOIN_TIME,
  MIN_EMAIL_REMINDER_HOURS,
  YOUTUBE_MAX_MEETING_TITLE_LENGTH,
} from '@lfx-one/shared/constants';
import { MeetingType, MeetingVisibility } from '@lfx-one/shared/enums';
import {
  BatchRegistrantOperationResponse,
  Committee,
  CreateMeetingRequest,
  ImportantLinkFormValue,
  Meeting,
  MeetingAttachment,
  MeetingAttachmentOperationResults,
  MeetingComposerContext,
  MeetingComposerMode,
  MeetingComposerSectionId,
  MeetingRecurrence,
  MeetingRegistrant,
  MeetingRegistrantOperationResult,
  PendingAttachment,
  RegistrantPendingChanges,
  UpdateMeetingRequest,
} from '@lfx-one/shared/interfaces';
import {
  combineDateTime,
  formatTo12HourInTimezone,
  generateRecurrenceObject,
  getDefaultStartDateTime,
  getUserTimezone,
  isRecurrenceNeverEndSentinel,
  mapRecurrenceToFormValue,
} from '@lfx-one/shared/utils';
import { editModeDateTimeValidator, futureDateTimeValidator } from '@lfx-one/shared/validators';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { toZonedTime } from 'date-fns-tz';
import { MessageService } from 'primeng/api';
import {
  BehaviorSubject,
  catchError,
  concat,
  EMPTY,
  finalize,
  forkJoin,
  from,
  map,
  mergeMap,
  Observable,
  of,
  Subject,
  Subscription,
  switchMap,
  take,
  takeUntil,
  toArray,
} from 'rxjs';

/**
 * Form state and persistence for the meeting composer (LFXV2-3234).
 * @description Owns the single meeting FormGroup, edit-mode hydration, the create/update request
 * payload, and the attachment + registrant operations that run alongside the meeting save.
 * Provided by `MeetingComposerHostComponent`, so `initialize()` fully resets state on every open.
 */
@Injectable()
export class MeetingComposerFormService {
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly committeeService = inject(CommitteeService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly youtubeMaxLengthValidator = Validators.maxLength(YOUTUBE_MAX_MEETING_TITLE_LENGTH);

  public readonly form = signal<FormGroup>(this.createMeetingFormGroup());
  public readonly mode = signal<MeetingComposerMode>('create');
  public readonly meetingId = signal<string | null>(null);
  public readonly isEditMode = computed(() => this.mode() === 'edit');

  public readonly meeting = signal<Meeting | null>(null);
  public readonly loading = signal<boolean>(false);
  public readonly submitting = signal<boolean>(false);

  public readonly attachments = signal<MeetingAttachment[]>([]);
  public readonly deletingAttachmentId = signal<string | null>(null);
  public readonly pendingAttachmentDeletions = signal<string[]>([]);

  public readonly registrantUpdates = signal<RegistrantPendingChanges>({ toAdd: [], toUpdate: [], toDelete: [] });
  public readonly registrantUpdatesRefresh$ = new BehaviorSubject<void>(undefined);

  public readonly committeeContext = signal<Committee | null>(null);
  public readonly originalStartTime = signal<string | null>(null);

  /**
   * Project the composer was opened against, when the entry point knew it.
   * @description Preferred over `ProjectContextService.activeContextUid()`, which resolves
   * asynchronously and can still be empty when the composer opens from a deep link.
   */
  private readonly contextProjectUid = signal<string | null>(null);

  /**
   * Bumped on every form value/status change. FormGroup validity is not reactive, so template
   * computeds that depend on section validity must read this signal to re-evaluate.
   */
  public readonly revision = signal<number>(0);

  public readonly hasRegistrantUpdates = computed(() => {
    const updates = this.registrantUpdates();
    return updates.toAdd.length > 0 || updates.toUpdate.length > 0 || updates.toDelete.length > 0;
  });

  private formSubscriptions = new Subscription();

  /**
   * Emits on every `initialize()`, cancelling work started by the previous open.
   * @description The host is mounted for the app's lifetime, so `takeUntilDestroyed` alone would let a
   * slow load from a closed composer resolve into the next one's form.
   */
  private readonly reset$ = new Subject<void>();

  /** Incremented on every `initialize()` so callers can detect a submit that outlived its open. */
  private generation = 0;

  public constructor() {
    this.destroyRef.onDestroy(() => {
      this.formSubscriptions.unsubscribe();
      this.reset$.next();
      this.reset$.complete();
    });
  }

  public get openGeneration(): number {
    return this.generation;
  }

  private get pendingAttachments(): PendingAttachment[] {
    return this.form().get('attachments')?.value || [];
  }

  /** Resets every piece of composer state and, in edit mode, hydrates from the saved meeting. */
  public initialize(context: MeetingComposerContext): void {
    this.formSubscriptions.unsubscribe();
    this.formSubscriptions = new Subscription();
    this.reset$.next();
    this.generation++;

    this.mode.set(context.mode);
    this.meetingId.set(context.meetingUid ?? null);
    this.meeting.set(null);
    this.originalStartTime.set(null);
    this.attachments.set([]);
    this.pendingAttachmentDeletions.set([]);
    this.deletingAttachmentId.set(null);
    this.registrantUpdates.set({ toAdd: [], toUpdate: [], toDelete: [] });
    this.committeeContext.set(null);
    this.contextProjectUid.set(context.projectUid ?? null);
    this.submitting.set(false);
    this.loading.set(false);
    this.form.set(this.createMeetingFormGroup());
    this.revision.set(0);
    this.wireFormSubscriptions();

    // Create only: the group context pre-fills and locks the committees field. In edit mode the saved
    // meeting owns that field, and locking it to a single committee would drop the others on save.
    if (context.mode === 'create' && context.committeeUid) {
      this.loadCommitteeContext(context.committeeUid);
    }

    if (context.mode === 'edit' && context.meetingUid) {
      this.loadMeeting(context.meetingUid);
    }
  }

  public isSectionValid(section: MeetingComposerSectionId): boolean {
    const form = this.form();

    switch (section) {
      case 'details-access':
        return !!(form.get('title')?.value && form.get('title')?.valid && form.get('meeting_type')?.value);

      case 'date-schedule':
        return !!(
          form.get('startDate')?.value &&
          form.get('startTime')?.value &&
          form.get('timezone')?.value &&
          form.get('startDate')?.valid &&
          form.get('startTime')?.valid &&
          !form.errors?.['futureDateTime']
        );

      case 'platform-features':
        // Reminder controls use `invalid ?? true` (not `.valid`) because a disabled control (toggle off,
        // or minutes locked at the 24h max) reports valid === false and would wrongly block the section;
        // the ?? true fallback still fails closed if the controls are ever missing from the form.
        return (form.get('platform')?.valid ?? false) && !(form.get('reminderHours')?.invalid ?? true) && !(form.get('reminderMinutes')?.invalid ?? true);

      case 'guests':
      case 'agenda-resources':
        return true;

      default:
        return false;
    }
  }

  /** Marks the whole form touched so validation messages surface; returns whether submit may proceed. */
  public validateForSubmit(): boolean {
    const form = this.form();
    Object.keys(form.controls).forEach((key) => {
      const control = form.get(key);
      control?.markAsTouched();
      control?.markAsDirty();
    });

    return form.valid;
  }

  /**
   * Saves the meeting plus its pending attachment and registrant operations.
   * Emits the created meeting in create mode, `null` in edit mode, and completes without
   * emitting when the request fails (the error toast is raised here).
   */
  public submit(): Observable<Meeting | null> {
    const meetingData = this.prepareMeetingData();

    if (!meetingData.project_uid) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Project is required. Please select a project before saving.',
      });
      return EMPTY;
    }

    this.submitting.set(true);
    const existingMeetingId = this.meetingId();
    const save$: Observable<Meeting | null> =
      this.isEditMode() && existingMeetingId
        ? this.meetingService.updateMeeting(existingMeetingId, meetingData as UpdateMeetingRequest, 'single').pipe(map(() => null))
        : this.meetingService.createMeeting(meetingData as CreateMeetingRequest).pipe(map((meeting) => meeting));

    return save$.pipe(
      switchMap((meeting) => {
        const meetingId = meeting?.id ?? existingMeetingId;
        if (!meetingId) {
          // Create succeeded but returned no id — attachments and registrants have nothing to attach to.
          this.messageService.add({
            severity: 'warn',
            summary: 'Partially saved',
            detail: 'The meeting was saved, but guests and resources could not be attached. Open the meeting to add them.',
          });
          return of(meeting);
        }

        this.meetingId.set(meetingId);

        return forkJoin({
          attachments: this.processAttachmentOperations(meetingId),
          registrants: this.processRegistrantOperations(meetingId),
        }).pipe(
          map((results) => {
            this.reportDependentResults(results.attachments, results.registrants);
            return meeting;
          })
        );
      }),
      catchError((error: unknown) => {
        console.error('Error saving meeting:', error);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: `Failed to ${this.isEditMode() ? 'update' : 'create'} meeting. Please try again.`,
        });
        return EMPTY;
      }),
      finalize(() => this.submitting.set(false)),
      take(1)
    );
  }

  public deleteAttachment(attachmentId: string): void {
    this.pendingAttachmentDeletions.update((current) => [...current, attachmentId]);
  }

  public undoDeleteAttachment(attachmentId: string): void {
    this.pendingAttachmentDeletions.update((current) => current.filter((id) => id !== attachmentId));
  }

  /** A link removed from the form still has an attachment upstream; queue it for deletion on save. */
  public deleteLinkAttachment(attachmentId: string): void {
    this.pendingAttachmentDeletions.update((current) => [...current, attachmentId]);
  }

  // Private initializer functions

  private createMeetingFormGroup(): FormGroup {
    const defaultDateTime = getDefaultStartDateTime();

    return new FormGroup(
      {
        meeting_type: new FormControl('', [Validators.required]),
        visibility: new FormControl(MeetingVisibility.PUBLIC),
        restricted: new FormControl(false),

        title: new FormControl('', [Validators.required]),
        description: new FormControl('', [Validators.maxLength(2000)]),
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

        platform: new FormControl(DEFAULT_MEETING_TOOL, [Validators.required]),
        recording_enabled: new FormControl(false),
        transcript_enabled: new FormControl({ value: false, disabled: true }),
        youtube_upload_enabled: new FormControl({ value: false, disabled: true }),
        show_meeting_attendees: new FormControl({ value: false, disabled: true }),
        zoom_ai_enabled: new FormControl(false),
        require_ai_summary_approval: new FormControl(false),
        artifact_visibility: new FormControl(DEFAULT_ARTIFACT_VISIBILITY),
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

        attachments: new FormControl<PendingAttachment[]>([]),
        important_links: new FormArray([]),
        committees: new FormControl([]),
      },
      { validators: futureDateTimeValidator() }
    );
  }

  private wireFormSubscriptions(): void {
    const form = this.form();

    this.formSubscriptions.add(form.valueChanges.subscribe(() => this.revision.update((value) => value + 1)));
    this.formSubscriptions.add(form.statusChanges.subscribe(() => this.revision.update((value) => value + 1)));

    // Watch youtube_upload_enabled and enforce title length limit when enabled.
    // This fires correctly on patchValue during edit-mode hydration because the form initialises
    // youtube_upload_enabled as false and patchValue flips it to true, triggering valueChanges.
    const youtubeControl = form.get('youtube_upload_enabled');
    if (youtubeControl) {
      this.formSubscriptions.add(
        youtubeControl.valueChanges.subscribe((youtubeEnabled: boolean) => {
          const titleControl = form.get('title');
          if (!titleControl) return;

          if (youtubeEnabled) {
            titleControl.addValidators(this.youtubeMaxLengthValidator);
          } else {
            titleControl.removeValidators(this.youtubeMaxLengthValidator);
          }
          titleControl.updateValueAndValidity();
        })
      );
    }

    // When Board meeting type is selected, default to private + restricted access.
    // When switching away from Board, reset to public + unrestricted defaults so the
    // user isn't left with Board-level settings silently applied to a non-Board meeting.
    // The user can freely override visibility and restriction after the default is applied.
    const meetingTypeControl = form.get('meeting_type');
    if (meetingTypeControl) {
      let previousType = meetingTypeControl.value as string;
      this.formSubscriptions.add(
        meetingTypeControl.valueChanges.subscribe((currentType: string) => {
          if (currentType === MeetingType.BOARD) {
            form.patchValue({ visibility: MeetingVisibility.PRIVATE, restricted: true });
          } else if (previousType === MeetingType.BOARD) {
            form.patchValue({ visibility: MeetingVisibility.PUBLIC, restricted: false });
          }
          previousType = currentType;
        })
      );
    }
  }

  private loadMeeting(meetingUid: string): void {
    this.loading.set(true);

    forkJoin({
      meeting: this.meetingService.getMeeting(meetingUid),
      attachments: this.meetingService.getMeetingAttachments(meetingUid).pipe(catchError(() => of([] as MeetingAttachment[]))),
    })
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntil(this.reset$),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: ({ meeting, attachments }) => {
          // Attachments first — populateExistingLinks() reads them to seed the important_links array.
          this.attachments.set(attachments);
          this.meeting.set(meeting);
          this.populateFormWithMeetingData(meeting);
        },
        error: (error: unknown) => {
          console.error('Error getting meeting:', error);
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Meeting not found or you do not have permission to access it',
          });
        },
      });
  }

  /** Pre-populates the committees field from the opening group context and locks it. */
  private loadCommitteeContext(committeeUid: string): void {
    this.committeeService
      .getCommittee(committeeUid)
      .pipe(
        catchError(() => {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load group context.' });
          return of(null);
        }),
        take(1),
        takeUntil(this.reset$),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((committee) => {
        if (!committee) return;
        this.committeeContext.set(committee);
        const committeesControl = this.form().get('committees');
        committeesControl?.setValue([{ uid: committee.uid, name: committee.name }]);
        committeesControl?.disable();
      });
  }

  // Other private helper methods

  private prepareMeetingData(): CreateMeetingRequest | UpdateMeetingRequest {
    // Use getRawValue() to include disabled controls (e.g., locked committees from group context)
    const formValue = this.form().getRawValue();
    const duration = formValue.duration === 'custom' ? Number(formValue.customDuration) : Number(formValue.duration);
    const startDateTime = combineDateTime(formValue.startDate, formValue.startTime, formValue.timezone);
    const recurrenceObject = this.buildRecurrencePayload(formValue);

    return {
      project_uid: this.meeting()?.project_uid || this.contextProjectUid() || this.projectContextService.activeContextUid(),
      title: formValue.title,
      description: formValue.description || '',
      start_time: startDateTime,
      duration: duration,
      timezone: formValue.timezone,
      meeting_type: formValue.meeting_type || DEFAULT_MEETING_TYPE,
      early_join_time_minutes: this.parseEarlyJoinTime(formValue.early_join_time_minutes),
      visibility: formValue.visibility || MeetingVisibility.PRIVATE,
      restricted: formValue.restricted || false,
      recording_enabled: formValue.recording_enabled || false,
      transcript_enabled: formValue.recording_enabled ? formValue.transcript_enabled || false : false,
      youtube_upload_enabled: formValue.recording_enabled ? formValue.youtube_upload_enabled || false : false,
      show_meeting_attendees: false, // Coming Soon — disabled in form
      ai_summary_enabled: formValue.zoom_ai_enabled || false,
      require_ai_summary_approval: formValue.zoom_ai_enabled ? formValue.require_ai_summary_approval || false : false,
      artifact_visibility: formValue.recording_enabled || formValue.zoom_ai_enabled ? formValue.artifact_visibility || DEFAULT_ARTIFACT_VISIBILITY : null,
      auto_email_reminder_enabled: formValue.auto_email_reminder_enabled || false,
      // Total whole minutes before start, clamped to the upstream 120-1440 range. Omitted when disabled:
      // ITX resets the stored time to 0 whenever enabled is explicitly false, so no time value is needed.
      auto_email_reminder_time: formValue.auto_email_reminder_enabled ? this.clampReminderTime(formValue.reminderHours, formValue.reminderMinutes) : undefined,
      recurrence: recurrenceObject,
      platform: formValue.platform || DEFAULT_MEETING_TOOL,
      committees: formValue.committees || [],
    };
  }

  private parseEarlyJoinTime(value: string): number {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? DEFAULT_EARLY_JOIN_TIME : parsed;
  }

  private clampReminderTime(hours: unknown, minutes: unknown): number {
    const total = Math.round(Number(hours || DEFAULT_EMAIL_REMINDER_HOURS) * 60 + Number(minutes || 0));
    return Math.min(Math.max(total, MIN_EMAIL_REMINDER_HOURS * 60), MAX_EMAIL_REMINDER_TIME);
  }

  private buildRecurrencePayload(formValue: Record<string, any>): MeetingRecurrence | null {
    const recurrence = formValue['recurrence'] as Record<string, any>;
    const recurrenceType = formValue['recurrenceType'] as string;

    if (recurrenceType === 'custom' && recurrence['type']) {
      return this.stripRecurrenceUiKeys(recurrence);
    }

    if (!recurrenceType || recurrenceType === 'none') {
      return null;
    }

    if (recurrence['type'] && recurrence['repeat_interval'] > 0) {
      return this.stripRecurrenceUiKeys(recurrence);
    }

    return generateRecurrenceObject(recurrenceType, formValue['startDate']) ?? null;
  }

  /** Drops empty values and the `*UI` helper controls, which are form-only and not part of the API. */
  private stripRecurrenceUiKeys(recurrence: Record<string, any>): MeetingRecurrence {
    return Object.keys(recurrence)
      .filter((key) => recurrence[key] !== null && recurrence[key] !== undefined && !key.endsWith('UI'))
      .reduce((payload, key) => {
        payload[key] = recurrence[key];
        return payload;
      }, {} as Record<string, any>) as MeetingRecurrence;
  }

  private populateFormWithMeetingData(meeting: Meeting): void {
    const form = this.form();
    this.originalStartTime.set(meeting.start_time);

    // Parse start_time into the meeting's own timezone so the date and time pickers show
    // the values the organizer chose, not the viewer's local equivalents.
    let startDate: Date | null = null;
    let startTime = '';

    if (meeting.start_time) {
      const utcDate = new Date(meeting.start_time);
      const meetingTimezone = meeting.timezone || getUserTimezone();
      startDate = toZonedTime(utcDate, meetingTimezone);
      startTime = formatTo12HourInTimezone(utcDate, meetingTimezone);
    }

    const recurrenceValue = mapRecurrenceToFormValue(meeting.recurrence);
    const isCustomRecurrence = this.needsCustomRecurrence(meeting.recurrence);
    const finalRecurrenceValue = isCustomRecurrence ? 'custom' : recurrenceValue;

    if (meeting.recording_enabled) {
      form.get('transcript_enabled')?.enable();
      form.get('youtube_upload_enabled')?.enable();
    }

    // Map the stored reminder time (total minutes) back to the hours/minutes helper controls
    let reminderTotalMinutes = DEFAULT_EMAIL_REMINDER_HOURS * 60;
    if (meeting.auto_email_reminder_enabled && meeting.auto_email_reminder_time) {
      reminderTotalMinutes = meeting.auto_email_reminder_time;
    }
    const reminderHours = Math.floor(reminderTotalMinutes / 60);
    if (meeting.auto_email_reminder_enabled) {
      form.get('reminderHours')?.enable();
      if (reminderHours !== MAX_EMAIL_REMINDER_HOURS) {
        form.get('reminderMinutes')?.enable();
      }
    }

    form.patchValue({
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
      show_meeting_attendees: meeting.show_meeting_attendees || false,
      zoom_ai_enabled: meeting.ai_summary_enabled || false,
      require_ai_summary_approval: meeting.require_ai_summary_approval ?? false,
      artifact_visibility: meeting.artifact_visibility ?? DEFAULT_ARTIFACT_VISIBILITY,
      auto_email_reminder_enabled: meeting.auto_email_reminder_enabled ?? false,
      reminderHours: reminderHours,
      reminderMinutes: reminderTotalMinutes % 60,
      recurrenceType: finalRecurrenceValue,
      committees: meeting.committees || [],
    });

    if (meeting.recurrence) {
      this.populateRecurrenceGroup(meeting, isCustomRecurrence);
    }

    this.populateExistingLinks();
    this.updateFormValidator();
  }

  private populateRecurrenceGroup(meeting: Meeting, isCustomRecurrence: boolean): void {
    const form = this.form();
    const recurrence = meeting.recurrence!;

    let patternTypeUI = 'weekly';
    if (recurrence.type === 1) patternTypeUI = 'daily';
    else if (recurrence.type === 3) patternTypeUI = 'monthly';

    let monthlyTypeUI = 'dayOfMonth';
    if (recurrence.monthly_week && recurrence.monthly_week_day && !recurrence.monthly_day) {
      monthlyTypeUI = 'dayOfWeek';
    }

    const isSentinel = isRecurrenceNeverEndSentinel(recurrence.end_date_time);
    let endTypeUI = 'never';
    if (recurrence.end_date_time && !isSentinel) endTypeUI = 'date';
    else if (recurrence.end_times) endTypeUI = 'occurrences';

    if (isCustomRecurrence) {
      form.get('patternTypeUI')?.setValue(patternTypeUI);
    }

    form.get('recurrence')?.patchValue({
      type: recurrence.type || null,
      repeat_interval: recurrence.repeat_interval || 1,
      weekly_days: recurrence.weekly_days || null,
      monthly_day: recurrence.monthly_day || null,
      monthly_week: recurrence.monthly_week || null,
      monthly_week_day: recurrence.monthly_week_day || null,
      end_date_time: recurrence.end_date_time && !isSentinel ? new Date(recurrence.end_date_time) : null,
      end_times: recurrence.end_times || null,
      monthlyTypeUI: monthlyTypeUI,
      endTypeUI: endTypeUI,
    });
  }

  private populateExistingLinks(): void {
    const linkAttachments = this.attachments().filter((attachment) => attachment.type === 'link');
    if (linkAttachments.length === 0) {
      return;
    }

    const importantLinksArray = this.form().get('important_links') as FormArray;
    while (importantLinksArray.length > 0) {
      importantLinksArray.removeAt(0);
    }

    linkAttachments.forEach((linkAttachment) => {
      importantLinksArray.push(
        new FormGroup({
          id: new FormControl(crypto.randomUUID()),
          title: new FormControl(linkAttachment.name),
          url: new FormControl(linkAttachment.link || ''),
          // Tracks the upstream attachment so the link isn't recreated on save
          uid: new FormControl(linkAttachment.uid),
        })
      );
    });
  }

  private needsCustomRecurrence(recurrence: MeetingRecurrence | null | undefined): boolean {
    if (!recurrence) return false;

    if (recurrence.repeat_interval && recurrence.repeat_interval !== 1) return true;
    if (recurrence.weekly_days && recurrence.weekly_days.split(',').length > 1) return true;
    // End conditions (end date or occurrence count) — exclude the sentinel, which means "never ends"
    if (recurrence.end_date_time && !isRecurrenceNeverEndSentinel(recurrence.end_date_time)) return true;
    if ((recurrence.end_times ?? 0) > 0) return true;

    return false;
  }

  private updateFormValidator(): void {
    const form = this.form();
    const originalStartTime = this.originalStartTime();

    if (this.isEditMode() && originalStartTime) {
      form.setValidators(editModeDateTimeValidator(originalStartTime));
    } else {
      form.setValidators(futureDateTimeValidator());
    }

    form.updateValueAndValidity();
  }

  private processRegistrantOperations(meetingId: string): Observable<MeetingRegistrantOperationResult[]> {
    const operations = this.buildRegistrantOperations(meetingId);
    if (operations.length === 0) {
      return of([]);
    }

    return concat(...operations).pipe(toArray(), take(1));
  }

  private buildRegistrantOperations(meetingId: string): Observable<MeetingRegistrantOperationResult>[] {
    const operations: Observable<MeetingRegistrantOperationResult>[] = [];
    const registrantUpdates = this.registrantUpdates();

    if (registrantUpdates.toDelete.length > 0) {
      operations.push(
        this.meetingService.deleteMeetingRegistrants(meetingId, registrantUpdates.toDelete).pipe(
          map((response: BatchRegistrantOperationResponse<string>) => ({
            type: 'delete' as const,
            success: response.summary.successful,
            failed: response.summary.failed,
          })),
          catchError((error: unknown) => {
            console.error('Error deleting guests:', error);
            return of({ type: 'delete' as const, success: 0, failed: registrantUpdates.toDelete.length });
          })
        )
      );
    }

    if (registrantUpdates.toUpdate.length > 0) {
      operations.push(
        this.meetingService.updateMeetingRegistrants(meetingId, registrantUpdates.toUpdate).pipe(
          map((response: BatchRegistrantOperationResponse<MeetingRegistrant>) => ({
            type: 'update' as const,
            success: response.summary.successful,
            failed: response.summary.failed,
          })),
          catchError((error: unknown) => {
            console.error('Error updating guests:', error);
            return of({ type: 'update' as const, success: 0, failed: registrantUpdates.toUpdate.length });
          })
        )
      );
    }

    if (registrantUpdates.toAdd.length > 0) {
      operations.push(
        this.meetingService.addMeetingRegistrants(meetingId, registrantUpdates.toAdd).pipe(
          map((response: BatchRegistrantOperationResponse<MeetingRegistrant>) => ({
            type: 'add' as const,
            success: response.summary.successful,
            failed: response.summary.failed,
          })),
          catchError((error: unknown) => {
            console.error('Error inviting guests:', error);
            return of({ type: 'add' as const, success: 0, failed: registrantUpdates.toAdd.length });
          })
        )
      );
    }

    return operations;
  }

  private processAttachmentOperations(meetingId: string): Observable<MeetingAttachmentOperationResults | null> {
    const hasPendingDeletions = this.pendingAttachmentDeletions().length > 0;
    const hasPendingUploads = this.pendingAttachments.length > 0;
    const importantLinksArray = this.form().get('important_links') as FormArray;
    const hasPendingLinks = importantLinksArray.length > 0;

    if (!hasPendingDeletions && !hasPendingUploads && !hasPendingLinks) {
      return of(null);
    }

    // Deletions before uploads before links, so a removed link isn't re-created in the same pass.
    return this.deletePendingAttachments(meetingId).pipe(
      switchMap((deletions) =>
        this.savePendingAttachments(meetingId).pipe(
          switchMap((uploads) => this.saveLinkAttachments(meetingId).pipe(map((links) => ({ deletions, uploads, links }))))
        )
      ),
      take(1)
    );
  }

  private deletePendingAttachments(meetingId: string): Observable<MeetingAttachmentOperationResults['deletions']> {
    const attachmentIdsToDelete = this.pendingAttachmentDeletions();

    if (attachmentIdsToDelete.length === 0) {
      return of({ successes: 0, failures: [] });
    }

    return from(attachmentIdsToDelete).pipe(
      mergeMap((attachmentId) =>
        this.meetingService.deleteMeetingAttachment(meetingId, attachmentId).pipe(
          map(() => ({ success: attachmentId, failure: null as string | null })),
          catchError(() => of({ success: null as string | null, failure: attachmentId }))
        )
      ),
      toArray(),
      map((results) => ({
        successes: results.filter((result) => result.success).length,
        failures: results.filter((result) => result.failure).map((result) => result.failure!),
      })),
      take(1)
    );
  }

  private savePendingAttachments(meetingId: string): Observable<MeetingAttachmentOperationResults['uploads']> {
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
            map((result) => ({ success: result, failure: null })),
            catchError((error: unknown) => of({ success: null, failure: { fileName: attachment.fileName, error } }))
          )
      ),
      toArray(),
      map((results) => ({
        successes: results.filter((result) => result.success).map((result) => result.success!),
        failures: results.filter((result) => result.failure).map((result) => result.failure!),
      })),
      take(1)
    );
  }

  private saveLinkAttachments(meetingId: string): Observable<MeetingAttachmentOperationResults['links']> {
    const importantLinksArray = this.form().get('important_links') as FormArray;
    // Links that already carry a uid exist upstream and must not be recreated.
    const linksToSave = (importantLinksArray.value as ImportantLinkFormValue[]).filter((link) => link.title && link.url && !link.uid);

    if (linksToSave.length === 0) {
      return of({ successes: [], failures: [] });
    }

    return from(linksToSave).pipe(
      mergeMap((link) =>
        this.meetingService.createMeetingAttachment(meetingId, { type: 'link', category: 'Other', name: link.title, link: link.url }).pipe(
          map((result) => ({ success: result, failure: null })),
          catchError((error: unknown) => of({ success: null, failure: { linkName: link.title, error } }))
        )
      ),
      toArray(),
      map((results) => ({
        successes: results.filter((result) => result.success).map((result) => result.success!),
        failures: results.filter((result) => result.failure).map((result) => result.failure!),
      })),
      take(1)
    );
  }

  /** Warns when attachment or registrant work partially failed; the caller owns the success toast. */
  private reportDependentResults(attachments: MeetingAttachmentOperationResults | null, registrants: MeetingRegistrantOperationResult[]): void {
    const registrantFailures = registrants.reduce((sum, result) => sum + result.failed, 0);
    let attachmentFailures = 0;

    if (attachments) {
      attachmentFailures = attachments.deletions.failures.length + attachments.uploads.failures.length + attachments.links.failures.length;

      attachments.uploads.failures.forEach((failure) => console.error(`Failed to upload attachment ${failure.fileName}:`, failure.error));
      attachments.links.failures.forEach((failure) => console.error(`Failed to add link ${failure.linkName}:`, failure.error));
      attachments.deletions.failures.forEach((attachmentId) => console.error(`Failed to delete attachment ${attachmentId}`));

      if (attachments.deletions.failures.length === 0 && this.pendingAttachmentDeletions().length > 0) {
        this.pendingAttachmentDeletions.set([]);
      }
    }

    if (registrantFailures === 0 && attachmentFailures === 0) {
      return;
    }

    const failureParts: string[] = [];
    if (registrantFailures > 0) failureParts.push(`${registrantFailures} guest(s)`);
    if (attachmentFailures > 0) failureParts.push(`${attachmentFailures} resource(s)`);

    this.messageService.add({
      severity: 'warn',
      summary: this.isEditMode() ? 'Meeting Updated' : 'Meeting Created',
      detail: `${failureParts.join(' and ')} could not be saved. You can manage them later.`,
    });
  }
}
