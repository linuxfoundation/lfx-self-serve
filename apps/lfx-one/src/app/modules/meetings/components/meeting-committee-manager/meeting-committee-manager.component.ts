// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, InputSignal, output, OutputEmitterRef, signal, Signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { MultiSelectComponent } from '@components/multi-select/multi-select.component';
import { SelectComponent } from '@components/select/select.component';
import { Committee, CommitteeMember, MeetingCommittee } from '@lfx-one/shared';
import { CommitteeMemberVotingStatus, MeetingVisibility } from '@lfx-one/shared/enums';
import { CANCEL_ON_COMMITTEE_REMOVAL_OPTIONS, COMMITTEE_LABEL, MEETING_VOTING_STATUSES } from '@lfx-one/shared/constants';
import {
  fromMeetingApiVotingStatuses,
  isShowMeetingAttendeesLocked,
  meetingSelectionHasVotingFilter,
  sanitizeMeetingCommittees,
  sanitizeMeetingCommitteeUids,
  toMeetingApiVotingStatuses,
} from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { ProjectContextService } from '@services/project-context.service';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, EMPTY, filter, forkJoin, ignoreElements, map, merge, Observable, of, startWith, switchMap, tap } from 'rxjs';

interface CommitteeMemberDisplay extends CommitteeMember {
  committeeName: string;
  committees?: string[];
}

@Component({
  selector: 'lfx-meeting-committee-manager',
  imports: [ButtonComponent, ReactiveFormsModule, MultiSelectComponent, SelectComponent, TooltipModule],
  templateUrl: './meeting-committee-manager.component.html',
})
export class MeetingCommitteeManagerComponent {
  // Injected services
  private readonly committeeService = inject(CommitteeService);
  private readonly projectContextService = inject(ProjectContextService);

  // Inputs
  public readonly selectedCommittees: InputSignal<MeetingCommittee[]> = input<MeetingCommittee[]>([]);
  public readonly form: InputSignal<FormGroup> = input.required<FormGroup>();
  public readonly committeeContext = input<Committee | null>(null);
  /**
   * Whether the caller is still resolving the {@link committeeContext} it is going to pass.
   * @description Renders the loading block rather than the picker. Without it the unlocked
   * multiselect shows for the length of that lookup, so a group picked in the gap is overwritten
   * the moment the context lands and locks the field.
   */
  public readonly contextLoading = input<boolean>(false);
  /** Whether the caller's {@link committeeContext} lookup failed, so the scoping group is missing. */
  public readonly contextFailed = input<boolean>(false);
  /**
   * The organizer's saved decision about sharing the guest list, or `null` when there is none.
   * @description The decision cannot be read off the form: a create nobody has touched and a
   * meeting whose organizer switched sharing off both present as `false`. Only the loaded meeting
   * says which, so the caller resolves it with `getSavedAttendeeVisibility` and passes the answer.
   * Without it, a group default silently turns sharing back on for a meeting deliberately saved
   * with it off — hydration emits nothing this component could see, because both callers mount it
   * only once the load has settled.
   */
  public readonly savedAttendeeVisibility = input<boolean | null>(null);

  // Outputs
  public readonly committeesChange: OutputEmitterRef<MeetingCommittee[]> = output<MeetingCommittee[]>();
  public readonly committeeMembersChange: OutputEmitterRef<CommitteeMember[]> = output<CommitteeMember[]>();
  /**
   * The group uids the roster in the paired {@link committeeMembersChange} actually covers.
   * @description The selection is written to the parent form synchronously, but its members are
   * fetched, so there is a window — and, after a failed fetch, an indefinite one — where the parent
   * holds a valid-looking group and no members for it. The emission gate below is deliberately
   * silent in exactly those two states, so what has been covered has to be reported or the surfaces
   * gating save cannot tell "this group has no members" from "we haven't got them".
   *
   * A uid list rather than a boolean because the answer has to survive this component being absent:
   * the picker only exists while the Guests section is mounted, and a boolean it emitted before
   * unmounting describes a selection the parent may since have changed. Comparing uids lets the
   * parent re-derive the gate from its own form at any moment, mounted or not.
   */
  public readonly committeeMembersResolvedChange: OutputEmitterRef<string[]> = output<string[]>();
  /** Asks the caller to re-run the {@link committeeContext} lookup that failed. */
  public readonly retryContext: OutputEmitterRef<void> = output<void>();

  // State management
  public selectedCommitteeIds: WritableSignal<string[]> = signal([]);
  public selectedVotingStatuses: WritableSignal<string[]> = signal([]);
  public committeeForm: FormGroup;
  public readonly committeesLoading = signal<boolean>(true);

  /**
   * Whether the committee-options load has produced an answer — of any kind.
   * @description The selection gate below used to wait on `committeeOptions().length > 0`, reading a
   * non-empty list as "loaded". An empty list is also an answer, and `initCommitteeOptions` maps a
   * failed fetch onto one, so a project with no committees and a project whose fetch broke both left
   * the gate closed forever: the parent's selection was never applied, `selectionApplied` stayed
   * false, no roster was ever reported, and the composer sat on an unreconciled group with Create /
   * Save disabled and no banner to retry from. The load being settled is what the gate actually
   * wanted, and it is not the same question as the list being non-empty.
   */
  private readonly committeeOptionsSettled = signal(false);

  /**
   * Whether the last committee-options fetch failed.
   * @description `committeeOptionsSettled` is true for both a successful empty list and a failed
   * fetch, which is the right call for applying a saved selection. It is the wrong call for the
   * picker: those two answers look identical in `committeeOptions()`, so a failed load used to
   * render as "this project has no groups". Tracked separately so the template can say so and retry.
   */
  private readonly _committeeOptionsFailed = signal(false);
  public readonly committeeOptionsFailed = this._committeeOptionsFailed.asReadonly();

  /**
   * Bumped to re-run the options fetch over a project that has not changed.
   * @description The fetch hangs off the project uid, so a failed load left the picker empty with
   * no way to ask again without leaving the composer.
   */
  private readonly optionsRetryToken = signal(0);

  /**
   * Last known board/restricted lock for the attendees toggle.
   * @description `applyCommitteeAttendeePreference` must re-run when the lock lifts so a skipped
   * committee preference is not dropped, but not when the organizer switches between unlocked
   * types — that would turn the toggle back on after they explicitly turned it off.
   */
  private attendeeVisibilityLocked = false;

  /**
   * Whether the attendees toggle is currently holding a committee's preference rather than a
   * value of the organizer's own.
   * @description The unlock may only put back what this component itself applied or was stopped
   * from applying. Reading the control instead cannot work: the lock writes `false` too, and a
   * saved `false` an organizer chose on an earlier visit looks exactly like one the lock just
   * wrote — restoring on that reading would silently re-share a roster they had turned off.
   *
   * Set when a committee preference is applied or withheld by the lock; cleared as soon as the
   * organizer edits the toggle or the selection stops carrying the preference. An emission on
   * that control counts as an organizer edit only when the control is dirty and
   * {@link applyingAttendeeWrite} is not set — hydration patches it loudly too. See
   * {@link watchAttendeeEdits}.
   */
  private committeeOwnsAttendeeToggle = false;

  /**
   * The organizer's own edit to the toggle since the form was last hydrated, or `null` if they
   * have not made one.
   * @description Read through {@link organizerAttendeeChoice}, which falls back to the saved value
   * so an edit session starts from the decision the meeting already carries. Seeded from the
   * control by {@link seedSessionAttendeeChoice}, because an edit can predate this component.
   */
  private sessionAttendeeChoice: boolean | null = null;

  /** Guards the flags above against this component's own writes. */
  private applyingAttendeeWrite = false;

  /**
   * Emission gate for `committeeMembersChange`.
   * @description Consumers reconcile their guest list against every emission, so an emission that
   * isn't a truthful picture of the selected groups' membership would queue saved guests for
   * deletion. `membersResolved` only flips once a fetch settles; an empty selection counts as settled
   * only after the parent's committees have actually been applied (until then the empty list is a
   * mount-time artifact); and a failed fetch is never emitted, since "no members" and "we couldn't
   * ask" are indistinguishable in the result but opposite in consequence.
   *
   * What the gate cannot tell apart is an empty selection from a parent that has none and one from a
   * parent that has not resolved its own yet — both arrive as `[]` on the same input. So the parent
   * owns that half: mount this component only once its selection is known. Both callers do, by
   * reading `selectedCommittees` off the form control the composer populates, and by rendering the
   * Guests section only after an edit-mode load has settled.
   */
  private membersResolved = false;
  private selectionApplied = false;

  /** Whether the last member fetch failed — blocks emission, and the template says so rather than failing silently. */
  private readonly _membersFetchError = signal(false);
  public readonly membersFetchError = this._membersFetchError.asReadonly();

  /**
   * Bumped to re-run the member fetch over a selection that has not changed.
   * @description The fetch hangs off `selectedCommitteeIds`, so re-picking the groups was the only
   * thing that ever retried it. A group-scoped create has no picker to re-pick with — its group
   * arrives as `committeeContext` and renders locked — so a failure there left the composer holding
   * a group whose members can never be reconciled, and a Save disabled with no way back.
   */
  private readonly membersRetryToken = signal(0);

  // Committee options loaded from API
  public readonly committeeOptions: Signal<Committee[]> = this.initCommitteeOptions();

  // Reactive committee members loading
  public committeeMembers: Signal<CommitteeMemberDisplay[]> = this.initCommitteeMembers();
  public filteredCommitteeMembers = this.initFilteredCommitteeMembers();

  // Voting status options for dropdown
  public readonly votingStatusOptions = MEETING_VOTING_STATUSES;
  public readonly committeeLabel = COMMITTEE_LABEL;
  public readonly committeeLabelSingularLower = COMMITTEE_LABEL.singular.toLowerCase();
  public readonly cancelOnCommitteeRemovalOptions = CANCEL_ON_COMMITTEE_REMOVAL_OPTIONS;
  public readonly meetingVisibility = MeetingVisibility;

  // Computed signals
  /**
   * Whether the voting-status filter applies to the current selection.
   * @description Derived from option metadata when there is any for the selected groups. When there
   * is none — an empty or failed options load, the very case `committeeOptionsSettled` lets the
   * selection through on — it falls back to the saved selection's own filter, because
   * `selectedVotingStatuses` is metadata-independent evidence that voting filtering was configured.
   * Reading a missing option list as "no voting anywhere" would make `initFilteredCommitteeMembers`
   * skip the filter and queue every group member as a guest, including ones the saved filter
   * excluded; keeping the filter fails safe in the other direction.
   *
   * `meetingSelectionHasVotingFilter` is the single voting-enabled test. This computed is its
   * signal-backed reading, used by the roster filter and the `committees` clearer.
   * `updateParentForm` / `reconcileVotingFilter` call the helper directly so a just-fetched
   * options list can be used before `committeeOptions()` updates. An empty selection is not
   * missing metadata — there is nothing to filter — and a mixed known/unknown set still falls
   * back so one resolved non-voting group cannot erase a saved filter.
   */
  public hasVotingEnabledCommittee = computed(() =>
    meetingSelectionHasVotingFilter(this.selectedCommitteeIds(), this.committeeOptions(), this.selectedVotingStatuses().length)
  );
  public isPublicVisibility: Signal<boolean> = this.initIsPublicVisibility();
  public constructor() {
    this.committeeForm = new FormGroup({
      committees: new FormControl([]),
      votingStatuses: new FormControl([]),
    });

    // Subscribe to committee selection changes
    this.committeeForm
      .get('committees')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((committeeIds: string[] | null) => {
        const ids = this.normalizeCommitteeUids(committeeIds);
        this.selectedCommitteeIds.set(ids);
        this.updateParentForm(ids);

        // Clear voting statuses if no voting committees selected. Reads the same signal the roster
        // filter does, so a missing option list cannot clear a filter the filter itself still honours.
        if (!this.hasVotingEnabledCommittee()) {
          this.committeeForm.patchValue({ votingStatuses: [] }, { emitEvent: false });
          this.selectedVotingStatuses.set([]);
        }

        this.applyCommitteeAttendeePreference();
      });

    toObservable(this.form)
      .pipe(
        switchMap((form) => {
          const meetingTypeControl = form.get('meeting_type');
          const restrictedControl = form.get('restricted');
          if (!meetingTypeControl || !restrictedControl) {
            return EMPTY;
          }
          this.attendeeVisibilityLocked = isShowMeetingAttendeesLocked(meetingTypeControl.value, restrictedControl.value);
          this.seedSessionAttendeeChoice(form, this.attendeeVisibilityLocked);
          return merge(
            merge(meetingTypeControl.valueChanges, restrictedControl.valueChanges).pipe(
              map(() => isShowMeetingAttendeesLocked(meetingTypeControl.value, restrictedControl.value))
            ),
            this.watchAttendeeEdits(form)
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe((locked) => {
        const wasLocked = this.attendeeVisibilityLocked;
        this.attendeeVisibilityLocked = locked;
        if (!wasLocked || locked) {
          return;
        }
        // The organizer's own value outranks a committee's: the lock wrote `false` over it
        // silently, so putting it back is undoing the lock, not making a choice for them.
        if (this.restoreOrganizerAttendeeChoice()) {
          return;
        }
        if (this.committeeOwnsAttendeeToggle) {
          this.applyCommitteeAttendeePreference();
        }
      });

    // Subscribe to voting status changes
    this.committeeForm
      .get('votingStatuses')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((votingStatuses: string[]) => {
        this.selectedVotingStatuses.set(votingStatuses || []);
        this.updateParentForm(this.selectedCommitteeIds());
      });

    // Subscribe to selected committees changes - wait for the options load to settle first.
    // `initializeFromSelectedCommittees` reads no option metadata, so it only has to wait for the
    // load to have an answer; see `committeeOptionsSettled` for why it cannot wait for a non-empty one.
    combineLatest([toObservable(this.selectedCommittees), toObservable(this.committeeOptionsSettled)])
      .pipe(
        takeUntilDestroyed(),
        filter(([, settled]) => settled)
      )
      .subscribe(([committees]) => this.initializeFromSelectedCommittees(committees));

    // Emit committee members whenever they change
    toObservable(this.filteredCommitteeMembers)
      .pipe(
        filter(() => this.membersResolved && !this.membersFetchError()),
        takeUntilDestroyed()
      )
      .subscribe((members) => {
        // Coverage first, so a consumer that gates on it while handling the roster it was just
        // given sees the selection as settled rather than still owed. Both are plain emissions
        // inside a subscription rather than an effect: writing parent state from an effect updates
        // it during change detection, which is what ExpressionChangedAfterItHasBeenCheckedError is.
        this.committeeMembersResolvedChange.emit(this.selectedCommitteeIds());
        this.committeeMembersChange.emit(members);
      });
  }

  /**
   * Re-runs the member fetch for the current selection, behind the error banner's Try again.
   * @description Deliberately not a re-selection: the locked group of a scoped create is exactly the
   * case that needs this, and it has no control to change.
   */
  public retryCommitteeMembers(): void {
    this.membersRetryToken.update((token) => token + 1);
  }

  /**
   * Re-runs the group-options fetch for the current project, behind the error banner's Try again.
   * @description The fetch hangs off the project uid, so re-picking groups was never a retry — there
   * are no groups to pick when the list failed to load.
   */
  public retryCommitteeOptions(): void {
    this.optionsRetryToken.update((token) => token + 1);
  }

  /**
   * Initialize the component state from the selected committees input
   */
  private initializeFromSelectedCommittees(committees: MeetingCommittee[]): void {
    this.selectionApplied = true;

    const validCommittees = sanitizeMeetingCommittees(committees);
    const committeeIds = validCommittees.map((c) => c.uid);
    this.selectedCommitteeIds.set(committeeIds);

    // Get voting statuses (stored in the meeting API vocabulary)
    const existingVotingStatuses: string[] = [];
    validCommittees.forEach((committee) => {
      if (committee.allowed_voting_statuses) {
        existingVotingStatuses.push(...committee.allowed_voting_statuses);
      }
    });

    // Map API values back to the display vocabulary the multiselect options use
    const uniqueVotingStatuses = fromMeetingApiVotingStatuses(existingVotingStatuses);
    this.selectedVotingStatuses.set(uniqueVotingStatuses);

    this.committeeForm.patchValue(
      {
        committees: committeeIds,
        votingStatuses: uniqueVotingStatuses,
      },
      { emitEvent: false }
    );
  }

  /**
   * Fetches committee options from API reactively based on project context
   */
  private initCommitteeOptions(): Signal<Committee[]> {
    // A fresh object per recompute, so a retry that leaves the project untouched still reaches the
    // pipe: `computed` settles on `Object.is`, and the uid would be the very same reference.
    const fetchTrigger = computed(() => ({
      uid: this.projectContextService.activeContextUid(),
      attempt: this.optionsRetryToken(),
    }));

    return toSignal(
      toObservable(fetchTrigger).pipe(
        tap(({ uid }) => {
          // A context with no project never reaches the fetch below, so the answer is already in:
          // there are no options to load. Leaving it pending is what the gate cannot survive.
          this.committeesLoading.set(!!uid);
          this._committeeOptionsFailed.set(false);
          if (!uid) {
            this.committeeOptionsSettled.set(true);
          }
        }),
        switchMap((trigger) => {
          const uid = trigger.uid;
          if (!uid) {
            return of([]);
          }

          return this.committeeService.getCommitteesByProjectOrThrow(uid).pipe(
            tap((committees) => {
              this.committeesLoading.set(false);
              this.committeeOptionsSettled.set(true);
              this._committeeOptionsFailed.set(false);
              // The options signal has not updated yet inside this tap, so persist against the
              // response itself: a retry that learns the group does not vote must drop the
              // statuses the failure window preserved, or Save would still submit them.
              this.reconcileVotingFilter(committees);
            }),
            catchError(() => {
              console.error('Failed to load committees for project', uid);
              this.committeesLoading.set(false);
              // Settled, not successful. The picker has nothing to offer either way, but the
              // selection the parent already holds still has to be applied and reconciled.
              this.committeeOptionsSettled.set(true);
              this._committeeOptionsFailed.set(true);
              return of([]);
            })
          );
        })
      ),
      { initialValue: [] }
    );
  }

  /**
   * Tracks the parent form's visibility control reactively, so the template can bind a
   * signal instead of calling form().get('visibility')?.value on every check cycle.
   */
  private initIsPublicVisibility(): Signal<boolean> {
    return toSignal(
      toObservable(this.form).pipe(
        switchMap((form) => {
          const control = form.get('visibility');
          return control ? control.valueChanges.pipe(startWith(control.value)) : of(null);
        }),
        map((value) => value === this.meetingVisibility.PUBLIC)
      ),
      { initialValue: false }
    );
  }

  /**
   * Coerce a MultiSelect model to valid UIDs. Writes `[]` back when PrimeNG
   * emits `null` / `[null]` so the trigger shows the placeholder, not "null".
   */
  private normalizeCommitteeUids(committeeIds: (string | null | undefined)[] | null | undefined): string[] {
    const ids = sanitizeMeetingCommitteeUids(committeeIds);
    if (!Array.isArray(committeeIds) || committeeIds.length !== ids.length) {
      this.committeeForm.get('committees')?.setValue(ids, { emitEvent: false });
    }
    return ids;
  }

  /**
   * Re-applies the voting-status filter against a just-loaded options list.
   * @description Called from the options-fetch `tap` with the response itself, because
   * `committeeOptions()` has not updated yet. A retry that learns the group does not vote must
   * drop statuses the failure window preserved before writing the parent form.
   *
   * No-op until `initializeFromSelectedCommittees` has run: this tap fires (and flips
   * `committeeOptionsSettled`) before the deferred `toObservable` combineLatest can seed
   * `selectedCommitteeIds` from the parent. Writing the parent form from `[]` would wipe saved
   * groups on an ordinary edit-mode load. Retry always has `selectionApplied` by then.
   */
  private reconcileVotingFilter(options: Committee[]): void {
    if (!this.selectionApplied) {
      return;
    }

    const ids = this.selectedCommitteeIds();
    if (!meetingSelectionHasVotingFilter(ids, options, this.selectedVotingStatuses().length)) {
      this.committeeForm.patchValue({ votingStatuses: [] }, { emitEvent: false });
      this.selectedVotingStatuses.set([]);
    }
    this.updateParentForm(ids, options);
  }

  /**
   * Watches the organizer's own edits to the attendees toggle, handing ownership of the value
   * back to them.
   * @description Only a dirty control counts. An emission alone does not mean the organizer did
   * anything: hydration patches this control loudly, and on a locked meeting it patches the very
   * stale `true` that {@link getSavedAttendeeVisibility} exists to discard, moments before the
   * lock silently forces it back off. Recording that as their choice would let the unlock
   * resurrect it through this cache instead of through the saved value, bypassing the guard
   * entirely. The toggle binds through `formControlName`, so a human flipping it marks the
   * control dirty and a programmatic patch does not — that, not the emission, is the signal.
   *
   * Read `dirty` as "edited since this control was last hydrated", not as "a human flipped it at
   * some point": the flag is sticky, and both hosts mark every control dirty in bulk when a
   * submit fails. They each mark this one pristine before hydrating to keep the reading true, and
   * {@link applyingAttendeeWrite} still covers this component's own writes, which land on whatever
   * dirty state the form happens to be in.
   *
   * Returned as part of the lock stream rather than subscribed on the side, so the `switchMap`
   * tears it down when the form input is replaced; a side subscription would outlive its control
   * and accumulate one per form. `ignoreElements` keeps it a side effect: the edits are the
   * point, the emissions are not.
   */
  private watchAttendeeEdits(form: FormGroup): Observable<never> {
    const attendeesControl = form.get('show_meeting_attendees');
    if (!attendeesControl) {
      return EMPTY;
    }
    return attendeesControl.valueChanges.pipe(
      tap((value) => {
        if (!this.applyingAttendeeWrite && attendeesControl.dirty) {
          this.committeeOwnsAttendeeToggle = false;
          this.sessionAttendeeChoice = value === true;
        }
      }),
      ignoreElements()
    );
  }

  /**
   * Picks up an organizer edit that predates this component.
   * @description The composer renders the Guests section under an `@switch`, so leaving it and
   * coming back destroys and rebuilds this component while the form — and the edit on it — lives
   * on in the host's form service. A rebuilt instance starting at `null` would read their opt-out
   * as "no decision" and let the next group default turn sharing back on, which is the case
   * {@link organizerAttendeeChoice} exists to prevent.
   *
   * The control already carries the answer. `dirty` is the same evidence {@link watchAttendeeEdits}
   * records an edit on, so a dirty control at mount means its value is the organizer's, made since
   * the last hydration. A pristine one clears the field rather than leaving it, so replacing the
   * form input does not carry a previous meeting's decision into the new one.
   *
   * Never while locked, though: `syncShowMeetingAttendeesLock` writes `false` and disables the
   * control without clearing `dirty`, so a locked control reads as an opt-out no matter what the
   * organizer actually chose. Seeding there would turn an opt-in into a phantom `false` that
   * outranks the saved value and every group default for the rest of the session, and no unlock
   * would undo it. A locked mount reports no decision instead — the same answer
   * {@link getSavedAttendeeVisibility} gives the hosts for a locked meeting, and for the same
   * reason: while the lock is on, nothing the form holds is evidence of a choice.
   */
  private seedSessionAttendeeChoice(form: FormGroup, locked: boolean): void {
    const control = form.get('show_meeting_attendees');
    this.sessionAttendeeChoice = control?.dirty && !locked ? control.value === true : null;
  }

  /**
   * The organizer's standing decision for this meeting, or `null` if they have not made one.
   * @description Their edit in this session if there is one, otherwise what the meeting was saved
   * with — a value the caller has already qualified, so a forced or stale saved flag arrives as
   * `null` rather than as a choice. Reading the lock here instead would sample it at whatever
   * moment this component happened to be asked, and the manage page mounts the picker against an
   * empty form well before the meeting it describes has loaded.
   */
  private organizerAttendeeChoice(): boolean | null {
    return this.sessionAttendeeChoice ?? this.savedAttendeeVisibility();
  }

  /** Puts back an organizer's own `true` that the lock overwrote. Reports whether it applied. */
  private restoreOrganizerAttendeeChoice(): boolean {
    if (this.organizerAttendeeChoice() !== true) {
      return false;
    }
    this.setAttendeeVisibility(true);
    this.committeeOwnsAttendeeToggle = false;
    return true;
  }

  /** Writes the toggle without the write being mistaken for an organizer edit. */
  private setAttendeeVisibility(value: boolean): void {
    const control = this.form().get('show_meeting_attendees');
    if (!control || control.value === value) {
      return;
    }
    this.applyingAttendeeWrite = true;
    control.setValue(value);
    this.applyingAttendeeWrite = false;
  }

  /**
   * Turns on the meeting-level attendees toggle when a selected committee has it enabled,
   * unless board/restricted meetings lock the control off.
   * @description An organizer who turned the toggle off outranks every committee default, so
   * neither picking a new committee nor lifting the lock can put it back on.
   *
   * Also maintains {@link committeeOwnsAttendeeToggle}: a preference applied or withheld here
   * is one the unlock may put back, and a selection that no longer carries a preference leaves
   * nothing to put back. The unlock calls this again rather than replaying a remembered value,
   * so it always acts on the committees selected at that moment.
   */
  private applyCommitteeAttendeePreference(): void {
    if (this.organizerAttendeeChoice() === false) {
      return;
    }

    const ids = this.selectedCommitteeIds();
    const hasShowMeetingAttendees = this.committeeOptions().some((committee) => ids.includes(committee.uid) && committee.show_meeting_attendees === true);
    const attendeesControl = this.form().get('show_meeting_attendees');
    if (!hasShowMeetingAttendees || !attendeesControl) {
      this.committeeOwnsAttendeeToggle = false;
      return;
    }
    if (isShowMeetingAttendeesLocked(this.form().get('meeting_type')?.value, this.form().get('restricted')?.value)) {
      this.committeeOwnsAttendeeToggle = true;
      return;
    }
    this.setAttendeeVisibility(true);
    this.committeeOwnsAttendeeToggle = true;
  }

  private updateParentForm(committeeIds: string[], options: Committee[] = this.committeeOptions()): void {
    const selectedVotingStatuses = this.selectedVotingStatuses();
    const ids = sanitizeMeetingCommitteeUids(committeeIds);
    const allowedVotingStatuses = meetingSelectionHasVotingFilter(ids, options, selectedVotingStatuses.length)
      ? toMeetingApiVotingStatuses(selectedVotingStatuses)
      : [];

    const committeeData: MeetingCommittee[] = ids.map((uid) => ({
      uid,
      allowed_voting_statuses: allowedVotingStatuses,
    }));

    // Update parent form
    this.form().get('committees')?.setValue(committeeData);

    // Emit change event
    this.committeesChange.emit(committeeData);
  }

  private initCommitteeMembers(): Signal<CommitteeMemberDisplay[]> {
    // A fresh object per recompute, so a retry that leaves the selection untouched still reaches the
    // pipe: `computed` settles on `Object.is`, and the uid array would be the very same reference.
    const fetchTrigger = computed(() => ({ committeeIds: this.selectedCommitteeIds(), attempt: this.membersRetryToken() }));

    return toSignal(
      toObservable(fetchTrigger).pipe(
        switchMap(({ committeeIds }) => {
          this.membersResolved = false;
          this._membersFetchError.set(false);

          if (!committeeIds || committeeIds.length === 0) {
            this.membersResolved = this.selectionApplied;
            return of([]);
          }

          // Load members for all selected committees
          const memberRequests = committeeIds.map((id) => {
            const committee = this.committeeOptions().find((c) => c.uid === id);
            return this.committeeService.getCommitteeMembers(id).pipe(
              map((members) =>
                members.map((member) => ({
                  ...member,
                  committeeName: committee?.name || '',
                }))
              ),
              catchError((error) => {
                console.error(`Failed to load members for committee ${id}:`, error);
                this._membersFetchError.set(true);
                return of([]);
              })
            );
          });

          return forkJoin(memberRequests).pipe(
            map((memberArrays) => {
              // Flatten and deduplicate by email
              const memberMap = new Map<string, CommitteeMemberDisplay>();

              memberArrays.forEach((members, index) => {
                const committeeName = this.committeeOptions().find((c) => c.uid === committeeIds[index])?.name || '';

                members.forEach((member) => {
                  if (!member.email) return;

                  const emailKey = member.email.toLowerCase();
                  const existingMember = memberMap.get(emailKey);
                  if (!existingMember) {
                    memberMap.set(emailKey, {
                      ...member,
                      committeeName,
                      committees: [committeeName],
                    });
                  } else {
                    if (!existingMember.committees?.includes(committeeName)) {
                      existingMember.committees?.push(committeeName);
                    }
                  }
                });
              });

              return Array.from(memberMap.values());
            }),
            tap(() => {
              this.membersResolved = true;
            })
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initFilteredCommitteeMembers(): Signal<CommitteeMemberDisplay[]> {
    return computed(() => {
      const members = this.committeeMembers();
      const selectedVotingStatuses = this.selectedVotingStatuses();
      const hasVotingCommittees = this.hasVotingEnabledCommittee();

      // If no voting committees selected, show all members
      if (!hasVotingCommittees || selectedVotingStatuses.length === 0) {
        return members;
      }

      // None is treated as Observer — normalize both sides so None-status members
      // are included when Observer is selected.
      const normalizeStatus = (s: string): string => (s === CommitteeMemberVotingStatus.NONE ? CommitteeMemberVotingStatus.OBSERVER : s);
      const normalizedSelected = selectedVotingStatuses.map(normalizeStatus);

      return members.filter((member) => {
        const votingStatus = member.voting?.status;
        if (!votingStatus) {
          return false;
        }
        return normalizedSelected.includes(normalizeStatus(votingStatus));
      });
    });
  }
}
