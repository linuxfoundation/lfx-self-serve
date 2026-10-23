// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Component, computed, DestroyRef, inject, input, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { ToggleComponent } from '@components/toggle/toggle.component';
import { UserSearchComponent } from '@components/user-search/user-search.component';
import { COMPOSER_ATTENDEE_LOCK, SHOW_MEETING_ATTENDEES_FEATURE } from '@lfx-one/shared/constants';
import type {
  ComposerGuestRemoval,
  ComposerGuestRow,
  CommitteeMember,
  ManualGuestDialogResult,
  MeetingCommittee,
  MeetingRegistrantWithState,
} from '@lfx-one/shared/interfaces';
import {
  avatarInitials,
  getSavedAttendeeVisibility,
  getShowMeetingAttendeesLockedNote,
  isMeetingInviteResponsesEnabled,
  isShowMeetingAttendeesLocked,
  isSameOccurrenceId,
} from '@lfx-one/shared/utils';
import { MeetingInviteResendService } from '@services/meeting-invite-resend.service';
import { MeetingService } from '@services/meeting.service';
import { controlValueSignal } from '@shared/utils/form-control-signals.util';
import { updateTruncatedKeys } from '@shared/utils/truncation.util';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { take } from 'rxjs';

import { MeetingCommitteeManagerComponent } from '../../components/meeting-committee-manager/meeting-committee-manager.component';
import { ManualGuestDialogComponent } from '../manual-guest-dialog/manual-guest-dialog.component';
import { MeetingComposerFormService } from '../meeting-composer-form.service';

/**
 * Guests section of the meeting composer (GH-1457).
 * @description Guests are editable before the meeting exists: the list lives on
 * `MeetingComposerFormService`, which derives the `RegistrantPendingChanges` persisted in the same
 * submit that creates the meeting. That removes the wizard's "create the meeting first" gate.
 */
@Component({
  selector: 'lfx-composer-guests',
  imports: [ButtonComponent, ConfirmDialogModule, InputTextComponent, ToggleComponent, UserSearchComponent, MeetingCommitteeManagerComponent, TooltipModule],
  providers: [ConfirmationService],
  templateUrl: './composer-guests.component.html',
})
export class ComposerGuestsComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  /** Adds and removes are otherwise silent rows changing below; it re-announces a repeated message, which a bound region would not. */
  private readonly liveAnnouncer = inject(LiveAnnouncer);
  protected readonly formService = inject(MeetingComposerFormService);
  protected readonly inviteResend = inject(MeetingInviteResendService);

  public readonly form = input.required<FormGroup>();

  protected readonly quickAddForm = this.meetingService.createRegistrantFormGroup();

  /** Free-text filter over the invited list; local to the view, never part of the meeting form. */
  protected readonly guestFilterForm = new FormGroup({ query: new FormControl('', { nonNullable: true }) });
  protected readonly guestFilter: Signal<string> = toSignal(this.guestFilterForm.controls.query.valueChanges, { initialValue: '' });
  /** The last removal when editing, offered back as Undo until the next add or remove replaces it. */
  protected readonly lastRemoval = signal<ComposerGuestRemoval | null>(null);
  /** Group chips whose label is currently cut off, by row `trackId`; only those get a tooltip. */
  protected readonly truncatedGroupChips = signal<ReadonlySet<string>>(new Set());

  protected readonly showMeetingAttendeesFeature = SHOW_MEETING_ATTENDEES_FEATURE;

  private readonly meetingTypeValue: Signal<string | null> = controlValueSignal<string>(this.form, 'meeting_type');
  private readonly restrictedValue: Signal<boolean | null> = controlValueSignal<boolean>(this.form, 'restricted');
  protected readonly showAttendeesToggleNote: Signal<string | null> = computed(() =>
    getShowMeetingAttendeesLockedNote(this.meetingTypeValue(), this.restrictedValue(), COMPOSER_ATTENDEE_LOCK)
  );
  /** The organizer's saved sharing decision, for the group picker; `null` on a create. */
  /**
   * The loaded meeting's sharing decision for the group picker; `null` when there is none to report.
   * @description Read through the default (pre-v2) lock, like hydration. A board meeting still reports no
   * decision, as everywhere else. A restricted meeting — locked before the composer allowed sharing — reads
   * as decided *off* instead, so a linked group's default can't switch sharing on for an existing meeting
   * just because it was opened here.
   */
  protected readonly savedAttendeeVisibility: Signal<boolean | null> = computed(() => {
    const meeting = this.formService.meeting();
    const saved = getSavedAttendeeVisibility(meeting);
    if (saved !== null || !meeting) {
      return saved;
    }
    return isShowMeetingAttendeesLocked(meeting.meeting_type, meeting.restricted, COMPOSER_ATTENDEE_LOCK) ? null : false;
  });

  /**
   * The committees currently on the form, for the group manager to render as selected.
   * @description A named signal rather than `form().get(...)` in the template: only signal reads,
   * computed values and pipes belong there (`docs/reviews/frontend-checklist.md` section 4). Empty
   * rather than null while the control is unset, since the manager takes a list.
   */
  private readonly committeesValue: Signal<MeetingCommittee[] | null> = controlValueSignal<MeetingCommittee[]>(this.form, 'committees');
  protected readonly selectedCommittees: Signal<MeetingCommittee[]> = computed(() => this.committeesValue() ?? []);

  protected readonly isOccurrenceEdit: Signal<boolean> = this.formService.isOccurrenceEdit;
  /**
   * Guests on screen: every live guest, or — editing one occurrence — those invited to every occurrence
   * plus those invited to this one. Guests scoped to other occurrences are left out but stay in
   * `formService.guests()`, so nothing is queued against them.
   */
  protected readonly visibleGuests = computed(() =>
    this.formService.guests().filter((guest) => guest.state !== 'deleted' && this.appliesToEditedOccurrence(guest))
  );
  protected readonly guestCount = computed(() => this.visibleGuests().length);

  /**
   * The guests an invitation has actually gone out to.
   * @description `invite_accepted` only means something for a registrant that exists upstream: a
   * row still in the `new` state has not been asked yet, so counting it as unaccepted would read
   * as a wall of non-responses the moment somebody adds a group. It is the denominator of the
   * acceptance summary for that reason, not `guestCount()`.
   */
  protected readonly invitedGuests: Signal<MeetingRegistrantWithState[]> = computed(() => this.visibleGuests().filter((guest) => guest.state !== 'new'));
  protected readonly invitedGuestCount: Signal<number> = computed(() => this.invitedGuests().length);
  protected readonly acceptedGuestCount: Signal<number> = computed(() => this.invitedGuests().filter((guest) => guest.invite_accepted === true).length);
  protected readonly declinedGuestCount: Signal<number> = computed(() => this.invitedGuests().filter((guest) => guest.invite_accepted === false).length);
  /**
   * Invited, but neither a yes nor a no yet.
   * @description Derived by exclusion rather than as `=== null` so a registrant that arrives with
   * the field absent lands here instead of vanishing from the breakdown: "awaiting a reply" is
   * true of an unknown response, and the three counts have to add up to `invitedGuestCount()`.
   */
  protected readonly pendingGuestCount: Signal<number> = computed(
    () => this.invitedGuests().filter((guest) => guest.invite_accepted !== true && guest.invite_accepted !== false).length
  );

  /**
   * The full RSVP split, for the tooltip on the acceptance summary.
   * @description The visible line answers "how many are in?" — the number issue #1457 asks for —
   * and hiding the rest keeps a stats line that already carries the group/direct split to one
   * row. The difference between a decline and a silence is what an organizer chases, though, so
   * it is a hover away rather than gone.
   */
  protected readonly acceptanceBreakdown: Signal<string> = computed(
    () => `${this.acceptedGuestCount()} accepted \u00b7 ${this.declinedGuestCount()} declined \u00b7 ${this.pendingGuestCount()} awaiting a reply`
  );

  protected readonly acceptanceSummary: Signal<string> = computed(() => `${this.acceptedGuestCount()} of ${this.invitedGuestCount()} accepted`);

  /**
   * The visible line and the hover detail, joined for assistive tech.
   * @description The breakdown hangs off `pTooltip`, which renders a styled element of its own —
   * not the native `title` affordance a screen reader announces. `tooltipEvent="both"` puts it in
   * front of a keyboard user; this label is what puts it in front of a screen-reader user, and it
   * has to repeat the visible text because `aria-label` replaces an element's content rather than
   * adding to it. Reading the breakdown alone would drop the summary entirely, not de-duplicate it.
   * The span carries `role="note"` for the same label to be honoured at all — see the template.
   */
  protected readonly acceptanceLabel: Signal<string> = computed(() => `${this.acceptanceSummary()} \u00b7 ${this.acceptanceBreakdown()}`);

  /**
   * Whether this meeting collects RSVPs at all.
   * @description `invite_accepted` is only ever populated for a meeting with invite responses
   * enabled. With the toggle off nobody can answer, so every invited guest stays "awaiting a
   * reply" forever and the summary reads as a guest list ignoring the organizer — a number they
   * cannot act on and did not ask for. Same gate the other RSVP surfaces apply
   * (`meeting-card.component.ts:191`, `meeting-registrants-display.component.ts:77`). In create
   * mode there is no meeting yet, which the util already answers `false` for, and nothing has
   * been invited there to summarise either.
   */
  protected readonly inviteResponsesEnabled: Signal<boolean> = computed(() => isMeetingInviteResponsesEnabled(this.formService.meeting()));

  /** The acceptance line needs both an RSVP worth reporting and somebody to report it for. */
  protected readonly showAcceptanceSummary: Signal<boolean> = computed(() => this.inviteResponsesEnabled() && this.invitedGuestCount() > 0);

  /**
   * The guest list, with every derived string resolved once per change.
   * @description Rendered instead of `visibleGuests()` directly: these strings used to be method
   * calls in the template, which Angular re-evaluates on every change-detection pass — the display
   * name three times per row and the secondary line twice. Computing them here runs each once per
   * guest, and only when the list itself changes.
   */
  protected readonly guestRows: Signal<ComposerGuestRow[]> = this.initGuestRows();
  /** The invited rows narrowed by {@link guestFilter}, from the first character typed. */
  protected readonly filteredGuestRows: Signal<ComposerGuestRow[]> = this.initFilteredGuestRows();

  /**
   * Grid for the step; see the template comment for the row/column placement.
   * @description From `lg` up: a main column plus a 340px groups rail, rows of search / list (fills the rest,
   * never under 320px) / switch. Below `lg`: one column in DOM order — search, groups, list, switch. Editing
   * one occurrence drops the groups and the switch, leaving search and list.
   */
  protected readonly layoutClass: Signal<string> = computed(() =>
    this.isOccurrenceEdit()
      ? 'grid flex-1 grid-cols-1 grid-rows-[auto_minmax(320px,1fr)] gap-y-4'
      : 'grid flex-1 grid-cols-1 grid-rows-[auto_auto_minmax(320px,1fr)_auto] gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_minmax(320px,1fr)_auto]'
  );

  /** Accessible name for the compact attendees switch, carrying the lock note when there is one. */
  protected readonly showAttendeesAriaLabel: Signal<string> = computed(() => {
    const note = this.showAttendeesToggleNote();
    return note ? `${this.showMeetingAttendeesFeature.title}. ${note}` : this.showMeetingAttendeesFeature.title;
  });

  /**
   * Emails already on the meeting, for the duplicate guard.
   * @description Built from every live guest, not just the visible ones: editing one occurrence hides guests
   * scoped to other occurrences, and adding one of them here again could be rejected upstream at save time.
   */
  private readonly invitedEmails: Signal<Set<string>> = computed(
    () =>
      new Set(
        this.formService
          .guests()
          .filter((guest) => guest.state !== 'deleted')
          .map((guest) => guest.email?.toLowerCase() ?? '')
      )
  );

  /**
   * The removal Undo can still put back; `null` once putting it back would be wrong.
   * @description A removed direct guest isn't suppressed, so a group picked afterwards can re-add the
   * same person; restoring the row on top would queue a duplicate invite. Rows that already shared the
   * email at removal don't count. A group guest's row also carries the group it came through, which a
   * change of selected groups can make stale, so Undo is withdrawn for them on any group change.
   */
  protected readonly undoableRemoval: Signal<ComposerGuestRemoval | null> = computed(() => {
    const removal = this.lastRemoval();
    if (!removal) return null;

    if (this.liveEmailCount(removal.guest.email) > removal.liveSameEmail) return null;
    if (removal.guest.type === 'committee' && this.committeeKey() !== removal.committeeKey) return null;

    return removal;
  });

  private readonly committeeKey: Signal<string> = computed(() =>
    this.selectedCommittees()
      .map((committee) => committee.uid)
      .sort()
      .join(',')
  );

  /**
   * Adds the person picked from search straight to the invited list.
   * @description The directory can return a person without a usable first/last name, which the add
   * payload requires. Handing those to the dialog prefilled beats dropping the pick silently.
   * No per-pick confirmation: nothing is sent until the composer's Next / Save changes.
   */
  protected onUserSelected(): void {
    if (this.quickAddForm.valid) {
      const guest = this.quickAddForm.value as Record<string, unknown>;
      this.quickAddForm.reset();
      this.addDirectGuest(guest);
      return;
    }

    const prefill = this.quickAddForm.value;
    this.quickAddForm.reset();
    this.openManualDialog(prefill);
  }

  protected onOpenManualDialog(): void {
    this.openManualDialog(null);
  }

  /**
   * Puts the last removed guest back exactly as they were.
   * @description A saved guest is still in the list marked deleted, so its row is swapped back for the
   * original; a never-saved one was dropped, so it goes back where it sat. A group guest's email was
   * suppressed on removal and is released, or group reconciliation would keep treating it as removed.
   */
  protected onUndoRemove(): void {
    const removal = this.undoableRemoval();
    this.lastRemoval.set(null);
    if (!removal) return;

    const { guest, index, label } = removal;
    const key = guest.uid || guest.tempId || null;
    const email = guest.email?.toLowerCase() ?? '';

    if (guest.type === 'committee') {
      this.formService.unsuppressGuestEmail(guest.email);
    }

    this.formService.updateGuests((current) => {
      // A keyless saved row was replaced by a deleted copy, so the reference is gone; its email is what is left.
      const at = current.findIndex((candidate) =>
        key === null ? candidate.state === 'deleted' && candidate.email?.toLowerCase() === email : (candidate.uid || candidate.tempId) === key
      );

      if (at !== -1) {
        return current.map((candidate, i) => (i === at ? guest : candidate));
      }

      return [...current.slice(0, index), guest, ...current.slice(index)];
    });

    void this.liveAnnouncer.announce(`${label} restored to the guest list.`, 'polite');
  }

  protected onDismissUndo(): void {
    this.lastRemoval.set(null);
  }

  /** Resend is only offered once the meeting exists upstream (edit mode) and the guest is saved. */
  protected canResendInvite(guest: MeetingRegistrantWithState): boolean {
    return this.formService.isEditMode() && !!this.formService.meetingId() && this.inviteResend.canResend(guest);
  }

  protected onRequestResendInvite(guest: MeetingRegistrantWithState): void {
    const meetingId = this.formService.meetingId();
    if (meetingId) {
      this.inviteResend.confirmAndResend(this.confirmationService, meetingId, guest);
    }
  }

  protected onRemoveGuest(guest: MeetingRegistrantWithState): void {
    const label = this.guestLabel(guest);
    // When editing, Undo appears above the list while focus is lost with the removed row, so say it is there.
    const undoHint = this.formService.isEditMode() ? ' Undo is available above the list.' : '';
    void this.liveAnnouncer.announce(`${label} removed from the guest list.${undoHint}`, 'polite');

    // Null, not `undefined`, so the reduce below can tell "no identity" apart from a key that
    // happens to be missing on the candidate: `undefined === undefined` matched every other
    // keyless row, and removing one such guest dropped all of them.
    const key = guest.uid || guest.tempId || null;

    // Undo only when editing: a removed saved guest there is an invite withdrawn on save. On a create
    // nobody is invited yet, and picking the person again is the whole way back.
    if (this.formService.isEditMode()) {
      const index = this.formService.guests().findIndex((candidate) => (key === null ? candidate === guest : (candidate.uid || candidate.tempId) === key));
      const original = index === -1 ? guest : this.formService.guests()[index];
      this.lastRemoval.set({
        guest: original,
        index: Math.max(index, 0),
        label,
        liveSameEmail: this.liveEmailCount(original.email) - (original.state === 'deleted' ? 0 : 1),
        committeeKey: this.committeeKey(),
      });
    }

    // A group re-emission would otherwise undo the removal — re-adding an unsaved group guest, or
    // un-deleting a saved one who is still a member of a selected group. Only group guests are
    // suppressed: a removed direct guest with the same email must stay addable through a group later.
    if (guest.type === 'committee') {
      this.formService.suppressGuestEmail(guest.email);
    }

    this.formService.updateGuests((current) =>
      current.reduce<MeetingRegistrantWithState[]>((kept, candidate) => {
        // The same two rungs `guestRows` tracks by, with the same last resort: a guest carrying
        // neither is only identifiable by reference. `guestRows` can fall back to the render index
        // because it is keying a list it is iterating; this is mutating the array that list came
        // from, so the object itself is the only stable handle left.
        const isRemoved = key === null ? candidate === guest : (candidate.uid || candidate.tempId) === key;

        if (!isRemoved) {
          kept.push(candidate);
          return kept;
        }

        // A guest that was never saved upstream just disappears; a saved one has to be reported as a
        // deletion, so it stays in the list carrying the 'deleted' state.
        if (candidate.state !== 'new') {
          kept.push({ ...candidate, state: 'deleted' });
        }

        return kept;
      }, [])
    );
  }

  protected onCommitteeMembersChange(members: CommitteeMember[]): void {
    this.formService.syncCommitteeMembers(members);
  }

  /** Records whether a group chip's label is cut off, so its tooltip only shows when it adds something. */
  protected onGroupChipEnter(trackId: string, event: Event): void {
    this.truncatedGroupChips.set(updateTruncatedKeys(this.truncatedGroupChips(), trackId, event.currentTarget as HTMLElement));
  }

  /**
   * Matches the start of any word in the name, the secondary line (email · title · org) or the email — so "a"
   * narrows to Anna and Andre rather than every name containing an "a" — and also the start of each whole
   * value, so a typed or pasted email ("ada.byron@…") or hyphenated name still matches.
   */
  private initFilteredGuestRows(): Signal<ComposerGuestRow[]> {
    return computed(() => {
      const term = this.guestFilter().trim().toLowerCase();

      if (!term) {
        return this.guestRows();
      }

      const matches = (value: string | null | undefined): boolean => {
        const text = (value ?? '').toLowerCase();
        return text.startsWith(term) || text.split(/[\s@._\-·,()]+/).some((word) => word.startsWith(term));
      };

      return this.guestRows().filter((row) => matches(row.displayName) || matches(row.secondaryLine) || matches(row.guest.email));
    });
  }

  private initGuestRows(): Signal<ComposerGuestRow[]> {
    return computed(() =>
      this.visibleGuests().map((guest, index) => {
        // Filtered and joined rather than interpolated into a template literal. The template this
        // replaced rendered the two names with `{{ }}`, which prints nothing for a nullish value; a
        // literal prints the string `"undefined"`. Both names are typed as required, so this only
        // matters for a registrant that arrives from upstream without one — but that is exactly the
        // row where a visible `"undefined"` would be worst.
        const displayName = [guest.first_name, guest.last_name].filter(Boolean).join(' ');

        return {
          guest,
          // The index is the last resort, not the preferred key: it is unstable across a reorder,
          // which is exactly what `track` exists to survive. It is still better than the `''` it
          // replaced — two uid-less, tempId-less guests would both key on the empty string, and a
          // duplicate `track` key is a runtime error rather than a degraded animation. Nothing
          // produces such a guest today (`newGuestDefaults` always stamps a `tempId`, and loaded
          // registrants carry a `uid`), so this arm only fires if upstream returns one with neither.
          //
          // The email is deliberately not a rung between the two: it is not an identity here. The
          // same address can appear twice — once carried in from a committee and once added by
          // hand — and two rows keyed alike is the runtime error the index arm exists to avoid.
          trackId: guest.uid || guest.tempId || `guest-${index}`,
          initials: avatarInitials(guest.first_name, guest.last_name, guest.email),
          displayName,
          secondaryLine: [guest.email, guest.org_name].filter(Boolean).join(' · '),
          // The button's only content is an icon, so this string is the whole accessible name. A
          // nameless registrant would otherwise announce a bare "Remove", leaving a screen-reader
          // user to count rows to find out which guest they are about to drop — the email is what
          // identifies the row on screen in that case, so it identifies the button too.
          removeLabel: `Remove ${displayName || guest.email || 'guest'}`,
          scopeLabel: this.scopeLabel(guest),
          // Editing one occurrence, only guests invited to it alone can go: upstream can't drop a series
          // guest from a single occurrence, so those rows are read-only.
          removable: !this.isOccurrenceEdit() || !!guest.occurrence_id,
        };
      })
    );
  }

  private appliesToEditedOccurrence(guest: MeetingRegistrantWithState): boolean {
    if (!this.isOccurrenceEdit() || !guest.occurrence_id) {
      return true;
    }

    return isSameOccurrenceId(guest.occurrence_id, this.formService.occurrence()?.occurrence_id ?? this.formService.occurrenceId());
  }

  private scopeLabel(guest: MeetingRegistrantWithState): string | null {
    if (!this.isOccurrenceEdit()) {
      return null;
    }

    return guest.occurrence_id ? 'This occurrence' : 'All occurrences';
  }

  private openManualDialog(prefill: Record<string, unknown> | null): void {
    const dialogRef = this.dialogService.open(ManualGuestDialogComponent, {
      header: 'Add guest manually',
      width: 'min(560px, 94vw)',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { prefill },
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: ManualGuestDialogResult | undefined) => {
      if (result?.guest) {
        this.addDirectGuest(result.guest);
      }
    });
  }

  private addDirectGuest(formValue: Record<string, unknown>): void {
    const email = (formValue['email'] as string | null) ?? '';

    if (email && this.invitedEmails().has(email.toLowerCase())) {
      const onScreen = this.visibleGuests().some((guest) => guest.email?.toLowerCase() === email.toLowerCase());
      const detail = onScreen ? `${email} is already on the guest list.` : `${email} is already invited to another occurrence of this meeting.`;
      this.messageService.add({ severity: 'warn', summary: 'Already invited', detail });
      return;
    }

    const guest: MeetingRegistrantWithState = {
      ...this.formService.newGuestDefaults(),
      email,
      first_name: (formValue['first_name'] as string | null) ?? '',
      last_name: (formValue['last_name'] as string | null) ?? '',
      job_title: (formValue['job_title'] as string | null) || null,
      org_name: (formValue['org_name'] as string | null) || null,
      host: (formValue['host'] as boolean | null) ?? false,
      type: 'direct',
    };

    this.formService.updateGuests((current) => [guest, ...current]);
    // Undo restores a row by position and identity, so it is only offered while nothing else has moved.
    this.lastRemoval.set(null);
    void this.liveAnnouncer.announce(`${this.guestLabel(guest)} added to the guest list.`, 'polite');
  }

  private liveEmailCount(email: string | null | undefined): number {
    const target = email?.toLowerCase();
    if (!target) return 0;
    return this.formService.guests().filter((guest) => guest.state !== 'deleted' && guest.email?.toLowerCase() === target).length;
  }

  private guestLabel(guest: MeetingRegistrantWithState): string {
    return [guest.first_name, guest.last_name].filter(Boolean).join(' ') || guest.email || 'Guest';
  }
}
