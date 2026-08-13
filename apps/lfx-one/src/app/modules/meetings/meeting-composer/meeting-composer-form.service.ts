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
  MAX_CUSTOM_DURATION,
  MAX_EARLY_JOIN_TIME,
  MAX_EMAIL_REMINDER_HOURS,
  MAX_EMAIL_REMINDER_TIME,
  MEETING_AGENDA_MAX_LENGTH,
  MEETING_DURATION_CHIP_OPTIONS,
  MIN_CUSTOM_DURATION,
  MIN_EARLY_JOIN_TIME,
  MIN_EMAIL_REMINDER_HOURS,
  YOUTUBE_MAX_MEETING_TITLE_LENGTH,
} from '@lfx-one/shared/constants';
import { MeetingType, MeetingVisibility } from '@lfx-one/shared/enums';
import {
  BatchRegistrantOperationResponse,
  Committee,
  CommitteeMember,
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
  MeetingRegistrantWithState,
  PendingAttachment,
  RegistrantPendingChanges,
  UpdateMeetingRequest,
} from '@lfx-one/shared/interfaces';
import {
  combineDateTime,
  formatTo12HourInTimezone,
  generateRecurrenceObject,
  generateTempId,
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
  tap,
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
  public readonly pendingAttachmentDeletions = signal<string[]>([]);

  public readonly registrantUpdates = signal<RegistrantPendingChanges>({ toAdd: [], toUpdate: [], toDelete: [] });

  /**
   * Working guest list for the open composer, including rows queued for deletion.
   * @description Owned here rather than by the Guests section because the host's `@switch` destroys the
   * section on every section change — section-local state would silently drop pending guests.
   */
  public readonly guests = signal<MeetingRegistrantWithState[]>([]);
  public readonly guestsLoading = signal<boolean>(false);
  public readonly guestsLoadFailed = signal<boolean>(false);

  /** Emails of unsaved guests the organizer removed, so a group re-emission can't resurrect them. */
  public readonly suppressedGuestEmails = signal<Set<string>>(new Set());

  public readonly committeeContext = signal<Committee | null>(null);
  public readonly originalStartTime = signal<string | null>(null);

  /**
   * Project the composer was opened against, when the entry point knew it.
   * @description Preferred over `ProjectContextService.activeContextUid()`, which resolves
   * asynchronously. Deep links carry a project slug rather than a uid, so those opens still fall back
   * to the ambient context.
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
   * @description The host outlives each open, so `takeUntilDestroyed` alone would let a slow load from a
   * closed composer resolve into the next one's form.
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
    this.registrantUpdates.set({ toAdd: [], toUpdate: [], toDelete: [] });
    this.guests.set([]);
    this.guestsLoading.set(false);
    this.guestsLoadFailed.set(false);
    this.suppressedGuestEmails.set(new Set());
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
      this.loadGuests(context.meetingUid);
    }

    // Set after the subscriptions are wired so the type's visibility/restriction defaults still apply.
    if (context.mode === 'create' && context.meetingType) {
      this.form().get('meeting_type')?.setValue(context.meetingType);
    }
  }

  /**
   * Replaces the guest list and re-derives the pending registrant changes from it.
   * @description Single write path, so `registrantUpdates` can never drift from `guests`. `toUpdate` is
   * always empty today — the composer has no guest-edit affordance, so nothing produces a `'modified'`
   * guest; it stays wired so adding that affordance is a change to the Guests section alone.
   */
  public setGuests(next: MeetingRegistrantWithState[]): void {
    this.guests.set(next);

    const meetingUid = this.meetingId() ?? '';

    this.registrantUpdates.set({
      toAdd: next.filter((guest) => guest.state === 'new').map((guest) => this.meetingService.stripMetadata(meetingUid, guest)),
      toUpdate: next.filter((guest) => guest.state === 'modified').map((guest) => ({ uid: guest.uid, changes: this.meetingService.getChangedFields(guest) })),
      toDelete: next.filter((guest) => guest.state === 'deleted').map((guest) => guest.uid),
    } satisfies RegistrantPendingChanges);
  }

  public updateGuests(reducer: (current: MeetingRegistrantWithState[]) => MeetingRegistrantWithState[]): void {
    this.setGuests(reducer(this.guests()));
  }

  /** Records a removed group guest's email so group reconciliation treats the removal as intentional. */
  public suppressGuestEmail(email: string | null | undefined): void {
    if (!email) {
      return;
    }

    this.suppressedGuestEmails.update((current) => new Set(current).add(email.toLowerCase()));
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
          form.get('duration')?.valid &&
          form.get('customDuration')?.valid &&
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
   * Emits the created meeting in create mode and `null` in edit mode. Completes without emitting when
   * the request fails (the error toast is raised here) or when the save outlived its open — callers
   * rely on that silence to skip their success toast and their close of a composer they no longer own.
   */
  public submit(): Observable<Meeting | null> {
    const generation = this.generation;
    const wasEditMode = this.isEditMode();
    const hadDependentWork = this.hasPendingDependentWork();
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
        // The save can only be cancelled upstream, so it keeps running after a close+reopen. Everything
        // below reads and writes live composer state, which by now belongs to a different meeting.
        if (generation !== this.generation) {
          if (hadDependentWork) {
            this.messageService.add({
              severity: 'warn',
              summary: 'Partially saved',
              detail: 'An earlier meeting was saved, but its guests and resources were not attached because the composer moved on.',
            });
          }

          return EMPTY;
        }

        const meetingId = meeting?.id ?? existingMeetingId;
        if (!meetingId) {
          // Create succeeded but returned no id, so pending attachments and registrants have nothing to
          // attach to. Still emit: leaving the composer open with no id to save against invites a
          // duplicate create.
          if (hadDependentWork) {
            this.messageService.add({
              severity: 'warn',
              summary: 'Partially saved',
              detail: 'The meeting was saved, but guests and resources could not be attached. Open the meeting from the list to add them.',
            });
          }

          return of(meeting);
        }

        this.meetingId.set(meetingId);

        return forkJoin({
          attachments: this.processAttachmentOperations(meetingId),
          registrants: this.processRegistrantOperations(meetingId),
        }).pipe(
          switchMap((results) => {
            // The composer can move on while these requests are in flight. Reporting then would clear the
            // new open's deletion queue, and emitting would close that open with a toast for the old meeting.
            if (generation !== this.generation) {
              return EMPTY;
            }

            this.reportDependentResults(results.attachments, results.registrants, wasEditMode);

            return of(meeting);
          })
        );
      }),
      catchError((error: unknown) => {
        console.error('Error saving meeting:', error);
        // A stale failure still gets reported, but worded so the user doesn't read it as their current
        // draft failing and hit Save again — that would duplicate the meeting.
        const isStale = generation !== this.generation;
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: isStale
            ? `An earlier meeting could not be ${wasEditMode ? 'updated' : 'created'}. Your current draft is unaffected.`
            : `Failed to ${wasEditMode ? 'update' : 'create'} meeting. Please try again.`,
        });
        return EMPTY;
      }),
      finalize(() => {
        if (generation === this.generation) {
          this.submitting.set(false);
        }
      }),
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

  /** Recurrence the current form state would submit — for read-only summaries such as the preview. */
  public recurrencePayload(): MeetingRecurrence | null {
    return this.buildRecurrencePayload(this.form().getRawValue());
  }

  /**
   * Writes a duration in minutes across the chip control and its custom companion.
   * @description Duration lives in two controls, so every writer outside Date & Schedule — the agenda
   * template estimate, the AI estimate, the quick create prefill — has to set both or leave the pair
   * inconsistent. Values off the chip scale land in `customDuration` and mark it touched, so its
   * range error is visible rather than silently deadening submit.
   */
  public setDuration(minutes: number): void {
    const isChipValue = MEETING_DURATION_CHIP_OPTIONS.some((option) => option.value === minutes);
    const form = this.form();

    form.get('duration')?.setValue(isChipValue ? minutes : 'custom');
    form.get('customDuration')?.setValue(isChipValue ? null : minutes);

    if (!isChipValue) {
      form.get('customDuration')?.markAsTouched();
    }
  }

  /**
   * Reconciles the guest list against the members of the currently selected groups.
   * @description Members already invited keep their saved state so they aren't deleted and re-created,
   * members that dropped out of every selected group are queued for deletion, and the rest are added.
   * Lives here rather than in the Guests section because the quick create dialog selects groups too.
   */
  public syncCommitteeMembers(members: CommitteeMember[]): void {
    const memberByEmail = new Map<string, CommitteeMember>();
    members.forEach((member) => {
      if (member.email) {
        memberByEmail.set(member.email.toLowerCase(), member);
      }
    });

    const suppressed = this.suppressedGuestEmails();

    this.updateGuests((current) => {
      const reconciled = current.reduce<MeetingRegistrantWithState[]>((kept, guest) => {
        if (guest.type !== 'committee') {
          kept.push(guest);
          return kept;
        }

        const email = guest.email?.toLowerCase() ?? '';
        if (memberByEmail.has(email)) {
          memberByEmail.delete(email);
          // Reconciliation has to be idempotent: a guest queued for deletion because they left every
          // selected group is restored when they turn up in one again. A guest the organizer removed by
          // hand is suppressed, so their deletion survives re-emission.
          const restore = guest.state === 'deleted' && !suppressed.has(email);
          kept.push(restore ? { ...guest, state: 'existing' } : guest);
          return kept;
        }

        if (guest.state !== 'new') {
          kept.push({ ...guest, state: 'deleted' });
        }

        return kept;
      }, []);

      const invited = new Set(reconciled.filter((guest) => guest.state !== 'deleted').map((guest) => guest.email?.toLowerCase() ?? ''));

      // Whatever is left in the map is a member nobody has invited or explicitly removed yet.
      const additions = Array.from(memberByEmail.values())
        .filter((member) => {
          const email = member.email?.toLowerCase() ?? '';
          return !invited.has(email) && !suppressed.has(email);
        })
        .map((member) => this.toGroupGuest(member));

      return [...reconciled, ...additions];
    });
  }

  /** Fields shared by every locally-added guest; `created_at` / `updated_at` are stamped upstream. */
  public newGuestDefaults(): MeetingRegistrantWithState {
    return {
      uid: '',
      meeting_id: this.meetingId() ?? '',
      occurrence_id: null,
      email: '',
      first_name: '',
      last_name: '',
      job_title: null,
      org_name: null,
      host: false,
      org_is_member: false,
      org_is_project_member: false,
      avatar_url: null,
      username: null,
      linkedin_profile: null,
      created_at: '',
      updated_at: '',
      type: 'direct',
      invite_accepted: null,
      attended: null,
      state: 'new',
      tempId: generateTempId(),
    };
  }

  /**
   * Minutes the form currently resolves to, whichever of the two duration controls holds it.
   * @description `customDuration` starts out as an empty string and holds whatever the numeric input
   * produces, so it is coerced rather than cast.
   */
  public effectiveDuration(): number | null {
    const duration = this.form().get('duration')?.value as number | 'custom' | null;

    if (duration !== 'custom') {
      return duration ?? null;
    }

    const customDuration = Number(this.form().get('customDuration')?.value);

    return Number.isFinite(customDuration) && customDuration > 0 ? customDuration : null;
  }

  private toGroupGuest(member: CommitteeMember): MeetingRegistrantWithState {
    return {
      ...this.newGuestDefaults(),
      email: member.email,
      first_name: member.first_name,
      last_name: member.last_name,
      job_title: member.job_title || null,
      org_name: member.organization?.name || null,
      username: member.username || null,
      linkedin_profile: member.linkedin_profile || null,
      type: 'committee',
      committee_uid: member.committee_uid,
      committee_name: member.committee_name,
      committee_role: member.role?.name || null,
      committee_voting_status: member.voting?.status || null,
    };
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
        description: new FormControl('', [Validators.maxLength(MEETING_AGENDA_MAX_LENGTH)]),
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

    // Owned here rather than by the Date & Schedule section: the host's `@switch` destroys that
    // section, so a section-scoped subscription would leave `customDuration` unvalidated whenever a
    // duration is written from elsewhere (a template or AI estimate applied in Agenda & Resources).
    const durationControl = form.get('duration');
    if (durationControl) {
      this.syncCustomDurationValidators(form, durationControl.value);
      this.formSubscriptions.add(durationControl.valueChanges.subscribe((value) => this.syncCustomDurationValidators(form, value)));
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

  private syncCustomDurationValidators(form: FormGroup, duration: unknown): void {
    const customDuration = form.get('customDuration');
    if (!customDuration) {
      return;
    }

    if (duration === 'custom') {
      customDuration.setValidators([Validators.required, Validators.min(MIN_CUSTOM_DURATION), Validators.max(MAX_CUSTOM_DURATION)]);
    } else {
      customDuration.clearValidators();
    }

    customDuration.updateValueAndValidity();
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

  /** Loads the saved guests for an edit-mode open, tagging each row as already persisted. */
  private loadGuests(meetingUid: string): void {
    this.guestsLoading.set(true);
    this.guestsLoadFailed.set(false);

    this.meetingService
      .getMeetingRegistrants(meetingUid, false)
      .pipe(
        take(1),
        catchError((error: unknown) => {
          console.error('Error getting meeting guests:', error);
          this.guestsLoadFailed.set(true);
          return of([] as MeetingRegistrant[]);
        }),
        finalize(() => this.guestsLoading.set(false)),
        takeUntil(this.reset$),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((loaded) => {
        const loadedEmails = new Set(loaded.map((registrant) => registrant.email?.toLowerCase() ?? ''));
        // Guests added while the fetch was in flight keep their place ahead of the saved rows, unless the
        // fetch turns out to have already returned them — a group emission can add someone mid-flight.
        const pending = this.guests().filter((guest) => guest.state === 'new' && !loadedEmails.has(guest.email?.toLowerCase() ?? ''));
        this.setGuests([...pending, ...loaded.map((registrant) => ({ ...registrant, state: 'existing' as const, originalData: { ...registrant } }))]);
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
      meeting_type: formValue.meeting_type,
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
      .reduce(
        (payload, key) => {
          payload[key] = recurrence[key];
          return payload;
        },
        {} as Record<string, any>
      ) as MeetingRecurrence;
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
      // Blank the legacy `None` sentinel so the required validator fires and the field shows its own
      // error instead of silently blocking save. Any other stored value is kept verbatim and the
      // details section synthesizes an option for it, so an unrecognized category stays visible and
      // replaceable rather than being re-classified behind the organizer's back.
      meeting_type: meeting.meeting_type === MeetingType.NONE ? '' : meeting.meeting_type,
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
      // Guests can be queued before the meeting exists, so the payloads carry an empty `meeting_id`.
      // This is the first point that knows the saved id.
      const toAdd = registrantUpdates.toAdd.map((registrant) => ({ ...registrant, meeting_id: meetingId }));

      operations.push(
        this.meetingService.addMeetingRegistrants(meetingId, toAdd).pipe(
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
    // Snapshot every collection up front. These steps run between HTTP round-trips, and `initialize()`
    // swaps in a fresh FormGroup — re-reading per step would upload a later open's files and links
    // against this meeting's id, and would silently drop this open's own queue.
    const attachmentIdsToDelete = this.pendingAttachmentDeletions();
    const attachmentsToUpload = this.unsavedAttachments();
    const linksToSave = this.unsavedLinks();

    if (attachmentIdsToDelete.length === 0 && attachmentsToUpload.length === 0 && linksToSave.length === 0) {
      return of(null);
    }

    // Deletions before uploads before links, so a removed link isn't re-created in the same pass.
    return this.deletePendingAttachments(meetingId, attachmentIdsToDelete).pipe(
      tap((deletions) => this.dropDeletedFromQueue(attachmentIdsToDelete, deletions.failures)),
      switchMap((deletions) =>
        this.savePendingAttachments(meetingId, attachmentsToUpload).pipe(
          switchMap((uploads) => this.saveLinkAttachments(meetingId, linksToSave).pipe(map((links) => ({ deletions, uploads, links }))))
        )
      ),
      take(1)
    );
  }

  private deletePendingAttachments(meetingId: string, attachmentIdsToDelete: string[]): Observable<MeetingAttachmentOperationResults['deletions']> {
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

  private savePendingAttachments(meetingId: string, attachmentsToSave: PendingAttachment[]): Observable<MeetingAttachmentOperationResults['uploads']> {
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

  /**
   * Drops the ids this pass deleted from the queue, keeping the ones it failed on.
   * @description Anything queued while the save was in flight is left alone — clearing the whole queue
   * would discard it silently.
   */
  private dropDeletedFromQueue(attemptedIds: string[], failedIds: string[]): void {
    const deleted = new Set(attemptedIds.filter((id) => !failedIds.includes(id)));

    if (deleted.size === 0) {
      return;
    }

    this.pendingAttachmentDeletions.update((ids) => ids.filter((id) => !deleted.has(id)));
  }

  /** Files picked in this open that haven't been uploaded yet. */
  private unsavedAttachments(): PendingAttachment[] {
    return this.pendingAttachments.filter((attachment) => !attachment.uploading && !attachment.uploadError && !attachment.uploaded && attachment.file);
  }

  /** Links that still need creating upstream — a uid means the link already exists there. */
  private unsavedLinks(): ImportantLinkFormValue[] {
    const importantLinksArray = this.form().get('important_links') as FormArray;

    return (importantLinksArray.value as ImportantLinkFormValue[]).filter((link) => link.title && link.url && !link.uid);
  }

  private hasUnsavedLinks(): boolean {
    return this.unsavedLinks().length > 0;
  }

  private saveLinkAttachments(meetingId: string, linksToSave: ImportantLinkFormValue[]): Observable<MeetingAttachmentOperationResults['links']> {
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

  /** Whether anything queued on the form still needs the saved meeting's id to be persisted. */
  private hasPendingDependentWork(): boolean {
    const registrants = this.registrantUpdates();

    return (
      this.unsavedAttachments().length > 0 ||
      this.pendingAttachmentDeletions().length > 0 ||
      this.hasUnsavedLinks() ||
      registrants.toAdd.length > 0 ||
      registrants.toUpdate.length > 0 ||
      registrants.toDelete.length > 0
    );
  }

  /** Warns when attachment or registrant work partially failed; the caller owns the success toast. */
  private reportDependentResults(
    attachments: MeetingAttachmentOperationResults | null,
    registrants: MeetingRegistrantOperationResult[],
    wasEditMode: boolean
  ): void {
    const registrantFailures = registrants.reduce((sum, result) => sum + result.failed, 0);
    let attachmentFailures = 0;

    if (attachments) {
      attachmentFailures = attachments.deletions.failures.length + attachments.uploads.failures.length + attachments.links.failures.length;

      attachments.uploads.failures.forEach((failure) => console.error(`Failed to upload attachment ${failure.fileName}:`, failure.error));
      attachments.links.failures.forEach((failure) => console.error(`Failed to add link ${failure.linkName}:`, failure.error));
      attachments.deletions.failures.forEach((attachmentId) => console.error(`Failed to delete attachment ${attachmentId}`));
    }

    if (registrantFailures === 0 && attachmentFailures === 0) {
      return;
    }

    const failureParts: string[] = [];
    if (registrantFailures > 0) failureParts.push(`${registrantFailures} guest(s)`);
    if (attachmentFailures > 0) failureParts.push(`${attachmentFailures} resource(s)`);

    this.messageService.add({
      severity: 'warn',
      summary: wasEditMode ? 'Meeting Updated' : 'Meeting Created',
      detail: `${failureParts.join(' and ')} could not be saved. You can manage them later.`,
    });
  }
}
