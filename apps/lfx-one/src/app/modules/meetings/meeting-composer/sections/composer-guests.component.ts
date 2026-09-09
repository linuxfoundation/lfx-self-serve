// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormGroup } from '@angular/forms';
import { FeatureToggleComponent } from '@components/feature-toggle/feature-toggle.component';
import { UserSearchComponent } from '@components/user-search/user-search.component';
import { COMMITTEE_LABEL, SHOW_MEETING_ATTENDEES_FEATURE } from '@lfx-one/shared/constants';
import type { ComposerGuestRow, CommitteeMember, ManualGuestDialogResult, MeetingRegistrantWithState } from '@lfx-one/shared/interfaces';
import { avatarInitials } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
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
  imports: [FeatureToggleComponent, UserSearchComponent, MeetingCommitteeManagerComponent],
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

  protected readonly committeeLabel = COMMITTEE_LABEL;
  protected readonly showMeetingAttendeesFeature = SHOW_MEETING_ATTENDEES_FEATURE;

  protected readonly visibleGuests = computed(() => this.formService.guests().filter((guest) => guest.state !== 'deleted'));
  protected readonly guestCount = computed(() => this.visibleGuests().length);
  protected readonly groupGuestCount = computed(() => this.visibleGuests().filter((guest) => guest.type === 'committee').length);
  protected readonly directGuestCount = computed(() => this.visibleGuests().filter((guest) => guest.type === 'direct').length);

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
    const key = guest.uid || guest.tempId;

    // A group re-emission would otherwise undo the removal — re-adding an unsaved group guest, or
    // un-deleting a saved one who is still a member of a selected group. Only group guests are
    // suppressed: a removed direct guest with the same email must stay addable through a group later.
    if (guest.type === 'committee') {
      this.formService.suppressGuestEmail(guest.email);
    }

    this.formService.updateGuests((current) =>
      current.reduce<MeetingRegistrantWithState[]>((kept, candidate) => {
        if ((candidate.uid || candidate.tempId) !== key) {
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
