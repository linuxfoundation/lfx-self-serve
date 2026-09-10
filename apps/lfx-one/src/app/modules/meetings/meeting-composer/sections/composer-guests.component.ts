// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormGroup } from '@angular/forms';
import { FeatureToggleComponent } from '@components/feature-toggle/feature-toggle.component';
import { UserSearchComponent } from '@components/user-search/user-search.component';
import { SHOW_MEETING_ATTENDEES_FEATURE } from '@lfx-one/shared/constants';
import type { ComposerGuestRow, CommitteeMember, ManualGuestDialogResult, MeetingCommittee, MeetingRegistrantWithState } from '@lfx-one/shared/interfaces';
import { avatarInitials, isMeetingInviteResponsesEnabled } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { controlValueSignal } from '@shared/utils/form-control-signals.util';
import { MessageService } from 'primeng/api';
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
  imports: [FeatureToggleComponent, UserSearchComponent, MeetingCommitteeManagerComponent, TooltipModule],
  templateUrl: './composer-guests.component.html',
})
export class ComposerGuestsComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);
  protected readonly formService = inject(MeetingComposerFormService);

  public readonly form = input.required<FormGroup>();

  protected readonly quickAddForm = this.meetingService.createRegistrantFormGroup();

  protected readonly showMeetingAttendeesFeature = SHOW_MEETING_ATTENDEES_FEATURE;

  /**
   * The committees currently on the form, for the group manager to render as selected.
   * @description A named signal rather than `form().get(...)` in the template: only signal reads,
   * computed values and pipes belong there (`docs/reviews/frontend-checklist.md` section 4). Empty
   * rather than null while the control is unset, since the manager takes a list.
   */
  private readonly committeesValue: Signal<MeetingCommittee[] | null> = controlValueSignal<MeetingCommittee[]>(this.form, 'committees');
  protected readonly selectedCommittees: Signal<MeetingCommittee[]> = computed(() => this.committeesValue() ?? []);

  protected readonly visibleGuests = computed(() => this.formService.guests().filter((guest) => guest.state !== 'deleted'));
  protected readonly guestCount = computed(() => this.visibleGuests().length);
  protected readonly groupGuestCount = computed(() => this.visibleGuests().filter((guest) => guest.type === 'committee').length);
  protected readonly directGuestCount = computed(() => this.visibleGuests().filter((guest) => guest.type === 'direct').length);

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
   * adding to it.
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

  private readonly invitedEmails: Signal<Set<string>> = computed(() => new Set(this.visibleGuests().map((guest) => guest.email?.toLowerCase() ?? '')));

  /**
   * Adds the person picked from search, or falls back to the manual dialog.
   * @description The directory can return a person without a usable first/last name, which the add
   * payload requires. Handing those to the dialog prefilled beats dropping the pick silently.
   */
  protected onUserSelected(): void {
    if (this.quickAddForm.valid) {
      this.addDirectGuest(this.quickAddForm.value);
      this.quickAddForm.reset();
      return;
    }

    const prefill = this.quickAddForm.value;
    this.quickAddForm.reset();
    this.openManualDialog(prefill);
  }

  protected onOpenManualDialog(): void {
    this.openManualDialog(null);
  }

  protected onRemoveGuest(guest: MeetingRegistrantWithState): void {
    // Null, not `undefined`, so the reduce below can tell "no identity" apart from a key that
    // happens to be missing on the candidate: `undefined === undefined` matched every other
    // keyless row, and removing one such guest dropped all of them.
    const key = guest.uid || guest.tempId || null;

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
        };
      })
    );
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
      this.messageService.add({ severity: 'warn', summary: 'Already invited', detail: `${email} is already on the guest list.` });
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
  }
}
