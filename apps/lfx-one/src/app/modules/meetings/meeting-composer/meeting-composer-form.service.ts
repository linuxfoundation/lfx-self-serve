// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, signal, type Signal } from '@angular/core';
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
  MEETING_ATTACHMENT_WRITE_CONCURRENCY,
  MEETING_COMPOSER_SECTIONS,
  MEETING_DURATION_CHIP_OPTIONS,
  MIN_CUSTOM_DURATION,
  MIN_EARLY_JOIN_TIME,
  MIN_EMAIL_REMINDER_HOURS,
  YOUTUBE_MAX_MEETING_TITLE_LENGTH,
} from '@lfx-one/shared/constants';
import { CancelOnCommitteeRemoval, MeetingType, MeetingVisibility } from '@lfx-one/shared/enums';
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
  MeetingComposerLoadFailure,
  MeetingComposerMode,
  MeetingComposerSection,
  MeetingComposerSectionId,
  MeetingOwnerInput,
  MeetingRecurrence,
  MeetingRegistrant,
  MeetingRegistrantOperationResult,
  MeetingRegistrantWithState,
  MeetingUserInfo,
  PendingAttachment,
  RegistrantPendingChanges,
  UpdateMeetingRequest,
} from '@lfx-one/shared/interfaces';
import {
  combineDateTime,
  formatTo12HourInTimezone,
  generateRecurrenceObject,
  generateTempId,
  getUserTimezone,
  isRecurrenceNeverEndSentinel,
  mapRecurrenceToFormValue,
  normalizeMeetingApiVotingStatuses,
  resolveMeetingOwner,
  sanitizeMeetingCommittees,
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
  merge,
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
 * Form state and persistence for the meeting composer (GH-1452).
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
  /**
   * How the edit-mode fetch failed, or `null` when it hasn't.
   * @description Two outcomes, not one: a 404/403 is permanent, so the drawer explains and stops
   * there, while anything else keeps its Retry. A single boolean offered "Try again" on a deleted
   * meeting and labelled a 500 "not found" — the pair of mistakes #2037 fixed on the page this
   * composer replaced.
   */
  public readonly meetingLoadFailure = signal<MeetingComposerLoadFailure | null>(null);
  /** Whether the edit-mode fetch failed, so the drawer can say so instead of showing an empty form. */
  public readonly meetingLoadFailed: Signal<boolean> = computed(() => this.meetingLoadFailure() !== null);
  /**
   * Whether the form is backed by real data.
   * @description Always true in create mode; in edit mode it takes a loaded meeting. Save writes the
   * whole form, so submitting one that never hydrated would overwrite the stored meeting with the
   * group's construction defaults.
   */
  public readonly isHydrated: Signal<boolean> = computed(() => !this.isEditMode() || this.meeting() !== null);
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
   * Owner hydrated from the loaded meeting, and the baseline the save diffs the picker against.
   * @description Upstream replaces `owner` as a whole object, so re-sending an unchanged one would drop
   * the stored `profile_picture` — the form carries no control for it (`UserSearchResult` has no avatar
   * field). `prepareOwnerData()` compares against this and omits the key when the picker is untouched.
   * Null on create, and for a stored owner that resolves to a service account or a zero-valued record.
   */
  public readonly hydratedOwner = signal<MeetingUserInfo | null>(null);

  /**
   * Whether the organizer picker is in hand-typed mode rather than directory search.
   * @description Owned here for the same reason `guests` is: the host's `@switch` destroys the Details &
   * Access section on every section change, so a section-local flag would silently drop the organizer
   * back into search mode — and out of the only inputs that can reach a non-committee-member — the first
   * time they stepped away and back.
   */
  public readonly ownerManualEntry = signal<boolean>(false);

  /**
   * Project the composer was opened against, when the entry point knew it.
   * @description Preferred over `ProjectContextService.activeContextUid()`, which resolves
   * asynchronously. Deep links carry a project slug rather than a uid, so those opens still fall back
   * to the ambient context.
   */
  private readonly contextProjectUid = signal<string | null>(null);

  /**
   * Project uid the submit payload will actually be written against.
   * @description The single source for that resolution — `prepareMeetingData()` reads this rather than
   * repeating the expression, so callers that need to describe "the meeting's project" (the AI agenda
   * prompt, for one) cannot describe a different project from the one the save writes to. Empty when
   * nothing has resolved yet.
   */
  public readonly effectiveProjectUid: Signal<string> = computed(
    () => this.meeting()?.project_uid || this.contextProjectUid() || this.projectContextService.activeContextUid()
  );

  /**
   * Bumped on every form value/status change, and explicitly by `validateForSubmit()`.
   * @description FormGroup state is not reactive, so template computeds that depend on section validity —
   * or on a control's `pristine` flag — must read this signal to re-evaluate. `validateForSubmit()` needs
   * the explicit bump because `markAsTouched`/`markAsDirty` emit on neither `valueChanges` nor
   * `statusChanges`, and it writes no values of its own. The only other writer that marks —
   * `setDuration()` — needs no bump: its own `setValue` calls provide one.
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

  /**
   * Incremented on every `initialize()` so callers can detect a submit that outlived its open.
   * @description Deliberately not incremented on close. A close on its own leaves nothing for a
   * resolving save to corrupt — every piece of state it writes is reset by the next `initialize()` —
   * and cancelling there would swallow the emission the host turns into the "Meeting created" toast,
   * which is the only route back to a meeting now that creating no longer navigates. What the guard
   * is actually for is a close *followed by a reopen*, where the resolving save would write into a
   * different meeting's form. Covered in `meeting-composer-form.service.spec.ts`.
   */
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
    this.meetingLoadFailure.set(null);
    this.guestsLoading.set(false);
    this.guestsLoadFailed.set(false);
    this.suppressedGuestEmails.set(new Set());
    this.committeeContext.set(null);
    this.hydratedOwner.set(null);
    this.ownerManualEntry.set(false);
    this.contextProjectUid.set(context.projectUid ?? null);
    this.submitting.set(false);
    this.loading.set(false);
    this.form.set(this.createMeetingFormGroup());
    this.revision.set(0);
    this.wireFormSubscriptions(context.variant === 'quick');

    // Create only: the group context pre-fills and locks the committees field. In edit mode the saved
    // meeting owns that field, and locking it to a single committee would drop the others on save.
    if (context.mode === 'create' && context.committeeUid) {
      this.loadCommitteeContext(context.committeeUid);
    }

    if (context.mode === 'edit' && context.meetingUid) {
      this.loadMeeting(context.meetingUid);
      this.loadGuests(context.meetingUid);
    }

    // Set after the subscriptions are wired so quick create's visibility/restriction defaults still apply.
    if (context.mode === 'create' && context.meetingType) {
      this.form().get('meeting_type')?.setValue(context.meetingType);
    }
  }

  /**
   * Re-wires the form for the advanced drawer, leaving every value already entered in place.
   * @description The counterpart to `MeetingComposerService.switchToAdvanced()`. Quick create wires one
   * subscription the drawer must not have — the Board type's visibility/restriction default — and the
   * form instance the organizer has been typing into is the one carrying it, so the subscriptions are
   * rebuilt against that same instance rather than through `initialize()`, which would replace the form.
   * Deliberately does not touch `reset$` or `generation`: this is the same open continuing, so an
   * in-flight committee-context load still belongs to it.
   */
  public dropQuickCreateDefaults(): void {
    this.formSubscriptions.unsubscribe();
    this.formSubscriptions = new Subscription();
    this.wireFormSubscriptions(false);
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
        return !!(
          form.get('title')?.value &&
          form.get('title')?.valid &&
          form.get('meeting_type')?.value &&
          // Optional field, so `?? true` rather than `.valid`: absent means nothing to block on. Only a
          // hand-typed organizer email can fail it, and the error only renders in manual-entry mode.
          (form.get('ownerEmail')?.valid ?? true)
        );

      case 'date-schedule':
        return !!(
          form.get('startDate')?.value &&
          form.get('startTime')?.value &&
          form.get('timezone')?.value &&
          form.get('startDate')?.valid &&
          form.get('startTime')?.valid &&
          form.get('duration')?.valid &&
          form.get('customDuration')?.valid &&
          // Same `invalid ?? true` shape as the reminder controls below: an out-of-range stored value
          // (min 10 / max 60) fails whole-form validity, so this section has to be the one that says so.
          // Edit mode reaches it — the API, PCC and Zoom all accept early-join values outside our range,
          // and `populateFormWithMeetingData` patches whatever is stored verbatim.
          !(form.get('early_join_time_minutes')?.invalid ?? true) &&
          !form.errors?.['futureDateTime']
        );

      case 'platform-features':
        // Reminder controls use `invalid ?? true` (not `.valid`) because a disabled control (toggle off,
        // or minutes locked at the 24h max) reports valid === false and would wrongly block the section;
        // the ?? true fallback still fails closed if the controls are ever missing from the form.
        return (form.get('platform')?.valid ?? false) && !(form.get('reminderHours')?.invalid ?? true) && !(form.get('reminderMinutes')?.invalid ?? true);

      case 'agenda-resources':
        // `description` carries `maxLength(MEETING_AGENDA_MAX_LENGTH)`. The template's `maxlength`
        // attribute only constrains typing, so an over-cap agenda still arrives two ways: a stored one
        // in edit mode, and an AI generation that came back long. Either kills whole-form validity, so
        // without this the organizer gets a dead Save button and nothing pointing at the cause.
        return !(form.get('description')?.invalid ?? true);

      case 'guests':
        // The only section that owns no validated control: guests are a list, not a form.
        return true;

      default:
        return false;
    }
  }

  /**
   * Whether a section should be flagged as blocking save, for both the rail's dots and the compact badge.
   * @description Single rule so the two surfaces can't drift. Create mode only counts sections already
   * visited — flagging one the stepper hasn't reached yet would report the form as broken before it has
   * been filled. Edit mode drops that gate: every section is reachable from the start and Save is gated
   * on all of them, so an unvisited invalid one is exactly the case where the organizer has no other way
   * to find out why Save is disabled. An edit whose meeting hasn't arrived is excluded — that form is
   * empty because of the fetch, not because of anything the organizer did. Callers must read `revision`
   * themselves: this is a plain method, so it carries no reactive dependency of its own.
   *
   * `section.required` is deliberately not consulted. Save is gated on whole-form validity, and an
   * optional section can still hold an invalid control — `platform-features` is the live case, since
   * its reminder inputs carry validators and are enabled in edit mode. Skipping optional sections here
   * is what previously left a disabled Save button with nothing on screen explaining it. `isSectionValid`
   * covers every control that carries a validator, so `form.valid === false` always flags some section;
   * `guests` is the one section that owns none and so can never nag.
   */
  public sectionNeedsAttention(section: MeetingComposerSection, visitedSections: ReadonlySet<MeetingComposerSectionId>): boolean {
    const isEditMode = this.isEditMode();

    if (isEditMode && !this.meeting()) {
      return false;
    }

    return (isEditMode || visitedSections.has(section.id)) && !this.isSectionValid(section.id);
  }

  /**
   * Index of the first section create mode must not advance past, or the section count when none blocks.
   * @description One rule for two surfaces. The rail locked later sections behind an incomplete
   * required one while the footer's Next kept walking straight through them, so the lock was a
   * suggestion: turning on YouTube auto-upload from Platform & features adds a title-length
   * validator that invalidates Details & access behind the organizer's back, and Next still moved
   * on. Callers must read `revision` themselves — this is a plain method and carries no reactive
   * dependency of its own.
   */
  public sectionAdvanceLimit(): number {
    const blocking = MEETING_COMPOSER_SECTIONS.findIndex((section) => section.required && !this.isSectionValid(section.id));

    return blocking === -1 ? MEETING_COMPOSER_SECTIONS.length : blocking;
  }

  /**
   * Re-runs the edit-mode fetch after a failure, so retrying doesn't mean reopening the composer.
   * @description Edit mode only: `meetingId` is also set by a successful create, and re-fetching there
   * would hydrate a create form from the meeting it just saved. The two fetches are independent, so a
   * guest list that arrived fine isn't thrown away here; a guests-only failure has no retry of its own,
   * since the only caller is the meeting-level error state.
   */
  public retryLoadMeeting(): void {
    const meetingUid = this.meetingId();

    // `denied` never retries: the 404/403 that produced it will produce it again, and the drawer
    // doesn't render the action for it. Guarded here too so a caller can't route around that.
    if (!this.isEditMode() || !meetingUid || this.loading() || this.meetingLoadFailure() === 'denied') {
      return;
    }

    this.loadMeeting(meetingUid);

    if (this.guestsLoadFailed()) {
      this.loadGuests(meetingUid);
    }
  }

  /** Marks the whole form touched so validation messages surface; returns whether submit may proceed. */
  public validateForSubmit(): boolean {
    // An edit whose fetch failed has a form full of defaults, not of the stored meeting. Saving it
    // would be a silent overwrite, and there is nothing to mark touched that would explain that.
    if (!this.isHydrated()) {
      return false;
    }

    const form = this.form();
    Object.keys(form.controls).forEach((key) => {
      const control = form.get(key);
      control?.markAsTouched();
      control?.markAsDirty();
    });

    // `markAsTouched`/`markAsDirty` emit on neither `valueChanges` nor `statusChanges`, so the bump has
    // to be explicit for anything reading control state through `revision`.
    this.revision.update((value) => value + 1);

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
            // The composer can move on while these requests are in flight. Emitting then would close that
            // open with a toast for the old meeting, so this branch never returns the meeting. What it
            // does still owe the organizer is the bad news: guests and resources that failed to save are
            // failures either way, and swallowing them meant a meeting quietly missing half its invitees.
            // The wording says which meeting, since the drawer on screen is now a different one.
            if (generation !== this.generation) {
              this.reportStaleDependentResults(results.attachments, results.registrants, wasEditMode);

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

  /**
   * Switches the organizer picker to hand-typed name/email.
   * @description The search pool is the committee-member directory Invite Guests uses, so manual entry
   * is what covers anyone outside it — an external organizer, say. Any lingering username is dropped on
   * the first manual edit (see `wireFormSubscriptions`), not here, so switching modes without typing
   * anything stays side-effect free and still saves as "unchanged".
   */
  public switchToOwnerManualEntry(): void {
    this.ownerManualEntry.set(true);
  }

  /** Returns the organizer picker to directory search, discarding an invalid hand-typed email. */
  public backToOwnerSearch(): void {
    // An invalid manual email would keep gating the section invisibly after the switch: its error
    // message only renders in manual mode, and the remounted search box is a separate control that
    // cannot edit `ownerEmail`. A typed name stays — name-only owners are valid upstream — and remains
    // visible and clearable through the picker's own display value.
    const ownerEmailControl = this.form().get('ownerEmail');
    if (ownerEmailControl?.invalid) {
      ownerEmailControl.setValue(null);
    }

    this.ownerManualEntry.set(false);
  }

  /**
   * Clears the organizer picker, reverting to the stored owner when there is one.
   * @description On an edit with a saved organizer, "clearing" restores it rather than emptying the
   * field: upstream has no owner-removal path, so once an owner is saved there is no true empty state to
   * revert to. Without one (create, or an edit whose owner was never set) this empties all three
   * controls, and the save omits the `owner` key either way.
   */
  public revertOwnerToSaved(): void {
    const form = this.form();
    const saved = this.hydratedOwner();

    // Also the manual-entry mode's only clear affordance (no autocomplete there, so no in-field cross),
    // so flip the mode *before* patching. The manual-edit guard in `wireFormSubscriptions` only drops
    // `ownerUsername` while `ownerManualEntry()` is true; patching name and email first would make it
    // read this programmatic revert as a hand edit and wipe the username it just restored.
    this.ownerManualEntry.set(false);
    form.get('ownerUsername')?.setValue(saved?.username || null);
    form.get('ownerName')?.setValue(saved?.name || null);
    form.get('ownerEmail')?.setValue(saved?.email || null);
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

    // The mark sits with the writes rather than after them purely for reading order: it needs no
    // `revision` bump of its own, since the `setValue` calls below bump it in the same synchronous task
    // and change detection reads `touched` only once that task has finished.
    if (!isChipValue) {
      form.get('customDuration')?.markAsTouched();
    }

    form.get('duration')?.setValue(isChipValue ? minutes : 'custom');
    form.get('customDuration')?.setValue(isChipValue ? null : minutes);
  }

  /**
   * Reconciles the guest list against the members of the currently selected groups.
   * @description Members already invited keep their saved state so they aren't deleted and re-created,
   * members that dropped out of every selected group are queued for deletion, and the rest are added.
   * Lives here rather than in the Guests section because the quick create dialog selects groups too.
   */
  public syncCommitteeMembers(members: CommitteeMember[]): void {
    // A failed guest load leaves `guests()` empty while the meeting still has saved registrants
    // upstream. Reconciling against that empty list reads every group member as uninvited and queues
    // them as `state: 'new'`, so saving would re-invite people who are already registered. Skip the
    // pass entirely until a retry populates the list — the section already surfaces the failure and
    // offers "Try again", and the group selection is re-applied once that succeeds.
    if (this.guestsLoadFailed()) {
      return;
    }

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
        const member = memberByEmail.get(email);
        if (member) {
          memberByEmail.delete(email);
          // Reconciliation has to be idempotent: a guest queued for deletion because they left every
          // selected group is restored when they turn up in one again. A guest the organizer removed by
          // hand is suppressed, so their deletion survives re-emission.
          const restore = guest.state === 'deleted' && !suppressed.has(email);
          // Re-read the attribution off the member the *current* selection emitted. Someone who belongs
          // to two groups matches here after the group that first added them is deselected, and keeping
          // the row verbatim would carry that group's `committee_uid` into the create write — where
          // `resolveRegistrantCommitteeUids` strips a UID no longer attached to the meeting and the
          // guest lands as `direct`, losing attribution outright.
          kept.push({
            ...guest,
            ...this.groupAttribution(member),
            ...(restore ? { state: 'existing' as const } : {}),
          });
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
      ...this.groupAttribution(member),
    };
  }

  /**
   * The four fields that say which group a guest came in through.
   *
   * Shared by the add path and the re-match path in `syncCommitteeMembers` so a guest who moves
   * between two selected groups ends up with exactly the attribution a freshly added one would get.
   *
   * Note this repairs the *pending* write only. An already-saved registrant keeps whatever upstream
   * stored, because the edit endpoint deliberately refuses to carry attribution:
   * `UpdateMeetingRegistrantRequest` declares no `committee_uid` and `MeetingController` strips one
   * that arrives anyway, so `PUT` cannot route around the meeting-scoped allowlist the create path
   * enforces. Re-attributing a saved guest means removing and re-adding them.
   */
  private groupAttribution(
    member: CommitteeMember
  ): Pick<MeetingRegistrantWithState, 'committee_uid' | 'committee_name' | 'committee_role' | 'committee_voting_status'> {
    return {
      committee_uid: member.committee_uid,
      committee_name: member.committee_name,
      committee_role: member.role?.name || null,
      committee_voting_status: member.voting?.status || null,
    };
  }

  // Private initializer functions

  private createMeetingFormGroup(): FormGroup {
    return new FormGroup(
      {
        meeting_type: new FormControl('', [Validators.required]),
        visibility: new FormControl(MeetingVisibility.PUBLIC),
        restricted: new FormControl(false),

        title: new FormControl('', [Validators.required]),
        // Optional meeting organizer (owner). No profile_picture control — `UserSearchResult` carries no
        // avatar; upstream keeps the stored one as long as the `owner` key is omitted from the payload.
        ownerUsername: new FormControl<string | null>(null),
        ownerName: new FormControl<string | null>(null),
        ownerEmail: new FormControl<string | null>(null, [Validators.email]),
        description: new FormControl('', [Validators.maxLength(MEETING_AGENDA_MAX_LENGTH)]),
        // Deliberately carries no validator, and must stay that way. `aiPrompt` is a scratch field
        // that never reaches the save payload, but it lives in the group `validateForSubmit()` reads,
        // so a validator here would block the meeting from saving over a value the meeting doesn't
        // even carry — with the Save button still enabled and no error UI to explain it. The cap is
        // enforced where it can't do that damage: a native `maxlength` attribute on the textarea
        // (see `TextareaComponent.maxlength`, bound as `[attr.maxlength]` precisely so it does not
        // become a validator), and a server-side truncation in `MeetingController.readPromptField`.
        aiPrompt: new FormControl(''),
        // When the meeting happens is the organizer's call, never ours: a seeded date, time or timezone
        // reads as an answer already given, and the one that gets shipped by accident is the one nobody
        // looked at. They stay empty on a new meeting and required, so the composer asks for them.
        startDate: new FormControl<Date | null>(null, [Validators.required]),
        startTime: new FormControl('', [Validators.required]),
        duration: new FormControl(DEFAULT_DURATION, [Validators.required]),
        customDuration: new FormControl(''),
        timezone: new FormControl('', [Validators.required]),
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
        // Only ever rendered by `lfx-meeting-committee-manager`, which both composer surfaces mount and
        // which binds this name unconditionally once a group is linked on a public meeting. It has to
        // exist in the group whether or not that block is on screen: `lfx-select` binds through
        // `formControlName`, so a missing control throws rather than degrading.
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

        attachments: new FormControl<PendingAttachment[]>([]),
        important_links: new FormArray([]),
        committees: new FormControl([]),
      },
      { validators: futureDateTimeValidator() }
    );
  }

  private wireFormSubscriptions(appliesTypeDefaults: boolean): void {
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

    // A hand-edited name or email can no longer be tied to an LFID, so the first actual edit in manual
    // mode drops any username left over from a search pick or from hydration. Clearing on edit rather
    // than on the mode switch keeps an accidental "manual -> back to search" round trip a no-op:
    // `prepareOwnerData()` still sees the hydrated owner unchanged and omits the key. Wired here rather
    // than in the Details & Access section because `@switch` destroys that section on every section
    // change, which would take the subscription with it.
    const ownerNameControl = form.get('ownerName');
    const ownerEmailControl = form.get('ownerEmail');
    const ownerUsernameControl = form.get('ownerUsername');
    if (ownerNameControl && ownerEmailControl && ownerUsernameControl) {
      this.formSubscriptions.add(
        merge(ownerNameControl.valueChanges, ownerEmailControl.valueChanges).subscribe(() => {
          if (this.ownerManualEntry() && ownerUsernameControl.value) {
            ownerUsernameControl.setValue(null);
          }
        })
      );
    }

    // When Board meeting type is selected, default to private + restricted access.
    // When switching away from Board, reset to public + unrestricted defaults so the
    // user isn't left with Board-level settings silently applied to a non-Board meeting.
    // The user can freely override visibility and restriction after the default is applied.
    //
    // Quick create only: prefilling from the meeting type is that dialog's whole premise, whereas the
    // drawer walks every field explicitly and must not move one the organizer hasn't reached yet.
    const meetingTypeControl = appliesTypeDefaults ? form.get('meeting_type') : null;
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
    this.meetingLoadFailure.set(null);

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
          // 404/403 is the permanent pair: the meeting is gone, or write access went away
          // mid-session and no retry here can restore it. Everything else — a 5xx, a dropped
          // connection — is worth another attempt, and saying "not found" about it would send the
          // organizer looking for a meeting that is still there.
          const denied = error instanceof HttpErrorResponse && (error.status === 404 || error.status === 403);

          this.meetingLoadFailure.set(denied ? 'denied' : 'retryable');

          // The toast is transient, so the drawer keeps its own state either way — otherwise the
          // organizer is left with an empty form and a disabled Save and nothing saying why. Only
          // the permanent case gets a toast on top: the retryable one has an action on screen.
          if (denied) {
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: 'Meeting not found or you do not have permission to access it',
            });
          }
        },
      });
  }

  /** Loads the saved guests for an edit-mode open, tagging each row as already persisted. */
  private loadGuests(meetingUid: string): void {
    this.guestsLoading.set(true);
    this.guestsLoadFailed.set(false);

    this.meetingService
      // include_committee: the Guests rows render a "via [Group]" chip, which needs the committee
      // metadata the plain projection omits.
      .getMeetingRegistrants(meetingUid, false, undefined, false, undefined, true)
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
        // A retry after a failed load re-fetches rows the organizer may have removed since. Hydrating
        // those as `existing` would silently drop the removal from the pending changes, so a suppressed
        // email comes back queued for deletion instead of un-removed.
        const suppressed = this.suppressedGuestEmails();
        const restored = loaded.map((registrant) => ({
          ...registrant,
          state: suppressed.has(registrant.email?.toLowerCase() ?? '') ? ('deleted' as const) : ('existing' as const),
          originalData: { ...registrant },
        }));
        this.setGuests([...pending, ...restored]);
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
      project_uid: this.effectiveProjectUid(),
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
      // Upstream reads this only for public meetings with linked groups; anywhere else the override has
      // nothing to act on, so a stale non-inherit value left over from an earlier edit is sent back as
      // `inherit` rather than being carried forward invisibly.
      cancel_on_committee_removal:
        formValue.visibility === MeetingVisibility.PUBLIC && formValue.committees?.length
          ? formValue.cancel_on_committee_removal || CancelOnCommitteeRemoval.INHERIT
          : CancelOnCommitteeRemoval.INHERIT,
      auto_email_reminder_enabled: formValue.auto_email_reminder_enabled || false,
      // Total whole minutes before start, clamped to the upstream 120-1440 range. Omitted when disabled:
      // ITX resets the stored time to 0 whenever enabled is explicitly false, so no time value is needed.
      auto_email_reminder_time: formValue.auto_email_reminder_enabled ? this.clampReminderTime(formValue.reminderHours, formValue.reminderMinutes) : undefined,
      recurrence: recurrenceObject,
      platform: formValue.platform || DEFAULT_MEETING_TOOL,
      // Canonicalize stored voting statuses at the save boundary: the form hydrates committees verbatim,
      // so a legacy row would otherwise resubmit display values ('Voting Rep') on an unrelated edit (GH-1796).
      committees: sanitizeMeetingCommittees(formValue.committees).map((committee) => ({
        ...committee,
        allowed_voting_statuses: normalizeMeetingApiVotingStatuses(committee.allowed_voting_statuses),
      })),
      ...this.prepareOwnerData(formValue),
    };
  }

  /**
   * Contributes `owner` to the payload only when the picker was actually used.
   * @description Empty controls omit the key entirely: on create upstream defaults the owner to the
   * creator, and on update the stored owner is preserved (there is no unset path). An edit whose picker
   * still matches `hydratedOwner` omits it too, so upstream keeps the stored owner object intact —
   * including the `profile_picture` this form never carries and would otherwise blank out.
   */
  private prepareOwnerData(formValue: Record<string, any>): { owner?: MeetingOwnerInput } {
    const username = ((formValue['ownerUsername'] as string | null) || '').trim();
    const name = ((formValue['ownerName'] as string | null) || '').trim();
    const email = ((formValue['ownerEmail'] as string | null) || '').trim();

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

    // Hydrate the organizer picker from the stored owner. Zero-valued records (meetings that predate
    // the field) and service accounts resolve to null, so the picker shows empty and `prepareOwnerData()`
    // omits the key on save rather than overwriting whatever upstream holds.
    const ownerInfo = resolveMeetingOwner(meeting);
    this.hydratedOwner.set(ownerInfo);

    form.patchValue({
      title: meeting.title,
      ownerUsername: ownerInfo?.username || null,
      ownerName: ownerInfo?.name || null,
      ownerEmail: ownerInfo?.email || null,
      description: meeting.description,
      // Blank the legacy `None` sentinel so the required validator fires and the field shows its own
      // error instead of silently blocking save. Any other stored value is kept verbatim and the
      // details section synthesizes an option for it, so an unrecognized category stays visible and
      // replaceable rather than being re-classified behind the organizer's back.
      meeting_type: meeting.meeting_type === MeetingType.NONE ? '' : meeting.meeting_type,
      startDate: startDate,
      startTime: startTime,
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
      cancel_on_committee_removal: meeting.cancel_on_committee_removal ?? CancelOnCommitteeRemoval.INHERIT,
      auto_email_reminder_enabled: meeting.auto_email_reminder_enabled ?? false,
      reminderHours: reminderHours,
      reminderMinutes: reminderTotalMinutes % 60,
      recurrenceType: finalRecurrenceValue,
      committees: sanitizeMeetingCommittees(meeting.committees),
    });

    // Duration is set through `setDuration()` rather than patched, because it lives in two controls.
    // Patching `duration` alone left an off-chip stored value (20 or 75 minutes) selecting no chip at
    // all while the form still read as valid, so the UI silently disagreed with what was saved.
    this.setDuration(meeting.duration || DEFAULT_DURATION);

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
    const generation = this.generation;
    const attachmentIdsToDelete = this.pendingAttachmentDeletions();
    const attachmentsToUpload = this.unsavedAttachments();
    const linksToSave = this.unsavedLinks();

    if (attachmentIdsToDelete.length === 0 && attachmentsToUpload.length === 0 && linksToSave.length === 0) {
      return of(null);
    }

    // Deletions before uploads before links, so a removed link isn't re-created in the same pass.
    return this.deletePendingAttachments(meetingId, attachmentIdsToDelete).pipe(
      // Same reason the snapshot exists: by the time the deletes come back the composer may have been
      // reopened, and the queue this would edit belongs to that new open, not to this save.
      tap((deletions) => {
        if (generation === this.generation) {
          this.dropDeletedFromQueue(attachmentIdsToDelete, deletions.failures);
        }
      }),
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
      mergeMap(
        (attachmentId) =>
          this.meetingService.deleteMeetingAttachment(meetingId, attachmentId).pipe(
            map(() => ({ success: attachmentId, failure: null as string | null })),
            catchError(() => of({ success: null as string | null, failure: attachmentId }))
          ),
        MEETING_ATTACHMENT_WRITE_CONCURRENCY
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
      mergeMap(
        (attachment) =>
          this.meetingService
            .uploadMeetingFile(meetingId, attachment.file, {
              name: attachment.fileName,
              file_size: attachment.fileSize,
              file_type: attachment.mimeType,
            })
            .pipe(
              map((result) => ({ success: result, failure: null })),
              catchError((error: unknown) => of({ success: null, failure: { fileName: attachment.fileName, error } }))
            ),
        MEETING_ATTACHMENT_WRITE_CONCURRENCY
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
      mergeMap(
        (link) =>
          this.meetingService.createMeetingAttachment(meetingId, { type: 'link', category: 'Other', name: link.title, link: link.url }).pipe(
            map((result) => ({ success: result, failure: null })),
            catchError((error: unknown) => of({ success: null, failure: { linkName: link.title, error } }))
          ),
        MEETING_ATTACHMENT_WRITE_CONCURRENCY
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
    const failures = this.describeDependentFailures(attachments, registrants);

    if (!failures) {
      return;
    }

    this.messageService.add({
      severity: 'warn',
      summary: wasEditMode ? 'Meeting Updated' : 'Meeting Created',
      detail: `${failures} could not be saved. You can manage them later.`,
    });
  }

  /**
   * Warns about a partial save whose composer has already moved on.
   * @description Same failures, different framing. The drawer on screen belongs to another meeting by
   * now, so "you can manage them later" would point at the wrong form; this says which meeting the
   * warning is about and that the open draft is untouched. Nothing here reads or writes the current
   * open's state — the queues it would have mutated are the new open's.
   */
  private reportStaleDependentResults(
    attachments: MeetingAttachmentOperationResults | null,
    registrants: MeetingRegistrantOperationResult[],
    wasEditMode: boolean
  ): void {
    const failures = this.describeDependentFailures(attachments, registrants);

    if (!failures) {
      return;
    }

    this.messageService.add({
      severity: 'warn',
      summary: 'Partially saved',
      detail: `The meeting you ${wasEditMode ? 'updated' : 'created'} saved, but ${failures} did not. Your current draft is unaffected.`,
    });
  }

  /**
   * Tallies and logs the guest and resource failures from one save, or `null` when there were none.
   * @description The counting and the `console.error` calls are shared by both reporters, so the two
   * can't drift into disagreeing about what counts as a failure.
   */
  private describeDependentFailures(attachments: MeetingAttachmentOperationResults | null, registrants: MeetingRegistrantOperationResult[]): string | null {
    const registrantFailures = registrants.reduce((sum, result) => sum + result.failed, 0);
    let attachmentFailures = 0;

    if (attachments) {
      attachmentFailures = attachments.deletions.failures.length + attachments.uploads.failures.length + attachments.links.failures.length;

      attachments.uploads.failures.forEach((failure) => console.error(`Failed to upload attachment ${failure.fileName}:`, failure.error));
      attachments.links.failures.forEach((failure) => console.error(`Failed to add link ${failure.linkName}:`, failure.error));
      attachments.deletions.failures.forEach((attachmentId) => console.error(`Failed to delete attachment ${attachmentId}`));
    }

    if (registrantFailures === 0 && attachmentFailures === 0) {
      return null;
    }

    const failureParts: string[] = [];
    if (registrantFailures > 0) failureParts.push(`${registrantFailures} guest(s)`);
    if (attachmentFailures > 0) failureParts.push(`${attachmentFailures} resource(s)`);

    return failureParts.join(' and ');
  }
}
