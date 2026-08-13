// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { FeatureToggleComponent } from '@components/feature-toggle/feature-toggle.component';
import { UserSearchComponent } from '@components/user-search/user-search.component';
import { COMMITTEE_LABEL, SHOW_MEETING_ATTENDEES_FEATURE } from '@lfx-one/shared/constants';
import type { CommitteeMember, MeetingRegistrant, MeetingRegistrantWithState, RegistrantPendingChanges, RegistrantState } from '@lfx-one/shared/interfaces';
import { avatarInitials, generateTempId } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { DialogModule } from 'primeng/dialog';
import { catchError, of, switchMap, tap } from 'rxjs';

import { MeetingCommitteeManagerComponent } from '../../components/meeting-committee-manager/meeting-committee-manager.component';
import { RegistrantFormComponent } from '../../components/registrant-form/registrant-form.component';
import { MeetingComposerFormService } from '../meeting-composer-form.service';

/**
 * Guests section of the meeting composer (LFXV2-3238).
 * @description Guests are editable before the meeting exists: the list is held locally and emitted as
 * `RegistrantPendingChanges`, which the form service persists in the same submit that creates the
 * meeting. That removes the wizard's "create the meeting first" gate.
 */
@Component({
  selector: 'lfx-composer-guests',
  imports: [
    ReactiveFormsModule,
    DialogModule,
    ButtonComponent,
    FeatureToggleComponent,
    UserSearchComponent,
    MeetingCommitteeManagerComponent,
    RegistrantFormComponent,
  ],
  templateUrl: './composer-guests.component.html',
})
export class ComposerGuestsComponent {
  private readonly meetingService = inject(MeetingService);
  protected readonly formService = inject(MeetingComposerFormService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly form = input.required<FormGroup>();

  protected readonly committeeLabel = COMMITTEE_LABEL;
  protected readonly showMeetingAttendeesFeature = SHOW_MEETING_ATTENDEES_FEATURE;

  protected readonly loading = signal<boolean>(false);
  protected readonly manualDialogVisible = signal<boolean>(false);
  protected readonly registrants = signal<MeetingRegistrantWithState[]>([]);

  protected readonly visibleRegistrants = computed(() => this.registrants().filter((registrant) => registrant.state !== 'deleted'));
  protected readonly guestCount = computed(() => this.visibleRegistrants().length);
  protected readonly groupGuestCount = computed(() => this.visibleRegistrants().filter((registrant) => registrant.type === 'committee').length);
  protected readonly directGuestCount = computed(() => this.visibleRegistrants().filter((registrant) => registrant.type === 'direct').length);

  protected readonly quickAddForm = this.meetingService.createRegistrantFormGroup();
  protected readonly manualForm = this.meetingService.createRegistrantFormGroup();

  /** Emails already invited, so the search can tell the organizer a person is a duplicate. */
  private readonly invitedEmails: Signal<Set<string>> = computed(
    () => new Set(this.visibleRegistrants().map((registrant) => registrant.email?.toLowerCase() ?? ''))
  );

  public constructor() {
    // The form signal is replaced on every `initialize()`, so it doubles as a per-open token: a reopen
    // re-loads the saved guests, while the create-time id assignment on submit does not.
    toObservable(this.form)
      .pipe(
        tap(() => {
          this.registrants.set([]);
          this.loading.set(true);
        }),
        switchMap(() => {
          const meetingUid = this.formService.meetingId();
          if (!meetingUid) {
            return of([] as MeetingRegistrant[]);
          }

          return this.meetingService.getMeetingRegistrants(meetingUid, false).pipe(
            catchError((error: unknown) => {
              console.error('Failed to load meeting guests:', error);
              return of([] as MeetingRegistrant[]);
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((loaded) => {
        this.registrants.set(loaded.map((registrant) => this.toExistingState(registrant)));
        this.loading.set(false);
      });
  }

  protected initials(registrant: MeetingRegistrantWithState): string {
    return avatarInitials(registrant.first_name, registrant.last_name, registrant.email);
  }

  /** `email · org` secondary line, collapsing to just the email when the org is unknown. */
  protected secondaryLine(registrant: MeetingRegistrantWithState): string {
    return [registrant.email, registrant.org_name].filter(Boolean).join(' · ');
  }

  protected isDuplicate(email: string | null | undefined): boolean {
    return !!email && this.invitedEmails().has(email.toLowerCase());
  }

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

    this.manualForm.reset();
    this.manualForm.patchValue(this.quickAddForm.value);
    this.manualForm.markAllAsTouched();
    this.manualForm.markAsDirty();
    this.quickAddForm.reset();
    this.manualDialogVisible.set(true);
  }

  protected onOpenManualDialog(): void {
    this.manualForm.reset();
    this.manualDialogVisible.set(true);
  }

  protected onAddManualGuest(): void {
    if (!this.manualForm.valid) {
      this.manualForm.markAllAsTouched();
      this.manualForm.markAsDirty();
      return;
    }

    this.addDirectGuest(this.manualForm.value);
    this.manualForm.reset();
    this.manualDialogVisible.set(false);
  }

  protected onRemoveGuest(registrant: MeetingRegistrantWithState): void {
    const key = registrant.uid || registrant.tempId;

    this.registrants.update((current) =>
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

    this.emitRegistrantUpdates();
  }

  /**
   * Reconciles the guest list against the members of the currently selected groups.
   * @description Members already invited keep their saved state so they aren't deleted and re-created,
   * members that dropped out of every selected group are queued for deletion, and the rest are added.
   */
  protected onCommitteeMembersChange(members: CommitteeMember[]): void {
    const selectedCommittees = this.form().get('committees')?.value as unknown[] | null;

    // The group manager loads its members asynchronously and emits an empty list first. Acting on that
    // while groups are selected would queue every group guest for deletion and re-add them a tick later.
    if (members.length === 0 && (selectedCommittees?.length ?? 0) > 0) {
      return;
    }

    const memberByEmail = new Map<string, CommitteeMember>();
    members.forEach((member) => {
      if (member.email) {
        memberByEmail.set(member.email.toLowerCase(), member);
      }
    });

    this.registrants.update((current) => {
      const reconciled = current.reduce<MeetingRegistrantWithState[]>((kept, registrant) => {
        if (registrant.type !== 'committee') {
          kept.push(registrant);
          return kept;
        }

        const email = registrant.email?.toLowerCase() ?? '';
        if (memberByEmail.has(email)) {
          memberByEmail.delete(email);
          kept.push(registrant);
          return kept;
        }

        if (registrant.state !== 'new') {
          kept.push({ ...registrant, state: 'deleted' });
        }

        return kept;
      }, []);

      // Whatever is left in the map is a member nobody has invited yet.
      const additions = Array.from(memberByEmail.values())
        .filter((member) => !reconciled.some((registrant) => registrant.state !== 'deleted' && registrant.email?.toLowerCase() === member.email?.toLowerCase()))
        .map((member) => this.toGroupRegistrant(member));

      return [...reconciled, ...additions];
    });

    this.emitRegistrantUpdates();
  }

  private addDirectGuest(formValue: Record<string, unknown>): void {
    const email = (formValue['email'] as string | null) ?? '';

    if (this.isDuplicate(email)) {
      return;
    }

    const now = new Date().toISOString();
    const guest: MeetingRegistrantWithState = {
      uid: '',
      meeting_id: this.formService.meetingId() ?? '',
      occurrence_id: null,
      email,
      first_name: (formValue['first_name'] as string | null) ?? '',
      last_name: (formValue['last_name'] as string | null) ?? '',
      job_title: (formValue['job_title'] as string | null) || null,
      org_name: (formValue['org_name'] as string | null) || null,
      host: (formValue['host'] as boolean | null) ?? false,
      org_is_member: false,
      org_is_project_member: false,
      avatar_url: null,
      username: null,
      linkedin_profile: (formValue['linkedin_profile'] as string | null) || null,
      created_at: now,
      updated_at: now,
      type: 'direct',
      invite_accepted: null,
      attended: null,
      state: 'new',
      tempId: generateTempId(),
    };

    this.registrants.update((current) => [guest, ...current]);
    this.emitRegistrantUpdates();
  }

  private toGroupRegistrant(member: CommitteeMember): MeetingRegistrantWithState {
    const now = new Date().toISOString();

    return {
      uid: '',
      meeting_id: this.formService.meetingId() ?? '',
      occurrence_id: null,
      email: member.email,
      first_name: member.first_name,
      last_name: member.last_name,
      job_title: member.job_title || null,
      org_name: member.organization?.name || null,
      host: false,
      org_is_member: false,
      org_is_project_member: false,
      avatar_url: null,
      username: member.username || null,
      linkedin_profile: member.linkedin_profile || null,
      created_at: now,
      updated_at: now,
      type: 'committee',
      committee_uid: member.committee_uid,
      committee_name: member.committee_name,
      committee_role: member.role?.name || null,
      committee_voting_status: member.voting?.status || null,
      invite_accepted: null,
      attended: null,
      state: 'new',
      tempId: generateTempId(),
    };
  }

  private toExistingState(registrant: MeetingRegistrant): MeetingRegistrantWithState {
    return {
      ...registrant,
      state: 'existing' as RegistrantState,
      originalData: { ...registrant },
    };
  }

  private emitRegistrantUpdates(): void {
    const registrants = this.registrants();
    // In create mode there is no id yet; the form service re-stamps it once the meeting is saved.
    const meetingUid = this.formService.meetingId() ?? '';

    this.formService.registrantUpdates.set({
      toAdd: registrants.filter((registrant) => registrant.state === 'new').map((registrant) => this.meetingService.stripMetadata(meetingUid, registrant)),
      toUpdate: registrants
        .filter((registrant) => registrant.state === 'modified')
        .map((registrant) => ({ uid: registrant.uid, changes: this.meetingService.getChangedFields(registrant) })),
      toDelete: registrants.filter((registrant) => registrant.state === 'deleted').map((registrant) => registrant.uid),
    } satisfies RegistrantPendingChanges);
  }
}
