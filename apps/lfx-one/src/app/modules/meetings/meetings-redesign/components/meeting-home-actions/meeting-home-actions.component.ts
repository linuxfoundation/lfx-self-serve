// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, Signal, signal, TemplateRef, viewChild } from '@angular/core';
import { MeetingDashboardView, MeetingHomeRow, MeetingHomeRowProject, MeetingHomeRowType } from '@lfx-one/shared/interfaces';
import {
  formatMeetingDateTime,
  getMeetingHomeRowProject,
  getMeetingHomeRowType,
  getMeetingRecurrenceTooltip,
  getMeetingSelfRemovalMessage,
  getPastMeetingResourceId,
} from '@lfx-one/shared/utils';
import { environment } from '@environments/environment';
import { MeetingOwnInviteResendService } from '@services/meeting-own-invite-resend.service';
import { MeetingSelfRemovalService } from '@services/meeting-self-removal.service';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiMenuItemComponent } from '@shared/uikit/menu/menu-item.component';
import { UiMenuSeparatorComponent } from '@shared/uikit/menu/menu-separator.component';
import { UiMenuComponent } from '@shared/uikit/menu/menu.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { finalize, take } from 'rxjs';

import { MeetingsHomeDeleteService } from '../../services/meetings-home-delete.service';
import { MeetingsHomeEditService } from '../../services/meetings-home-edit.service';

/**
 * The ⋯ menu of a meetings home row: Copy Link, and for upcoming meetings Edit Meeting, Resend Invite, Remove Myself and Delete Meeting.
 * @description Edit, Delete, Resend and Remove follow the legacy meeting card's gates. Feedback is uikit toasts at the bottom centre.
 */
@Component({
  selector: 'lfx-meeting-home-actions',
  imports: [UiAvatarComponent, UiButtonComponent, UiMenuComponent, UiMenuItemComponent, UiMenuSeparatorComponent, UiModalComponent],
  templateUrl: './meeting-home-actions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
})
export class MeetingHomeActionsComponent {
  private readonly clipboard = inject(Clipboard);
  private readonly toast = inject(UiToastService);
  private readonly modal = inject(UiModalService);
  private readonly inviteResend = inject(MeetingOwnInviteResendService);
  private readonly selfRemoval = inject(MeetingSelfRemovalService);
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  private readonly editService = inject(MeetingsHomeEditService);
  private readonly deleteService = inject(MeetingsHomeDeleteService);
  private readonly removeDialog = viewChild.required<TemplateRef<unknown>>('removeDialog');
  private dialogRef: DialogRef | null = null;

  public readonly row = input.required<MeetingHomeRow>();
  public readonly view = input.required<MeetingDashboardView>();

  protected readonly removing = signal(false);
  protected readonly resending: Signal<boolean> = computed(() => this.inviteResend.isResendingOwn(this.row().meeting.id));
  protected readonly checkingEdit: Signal<boolean> = computed(() => this.editService.isChecking(this.row().meeting.id));
  /** `organizer` is the meeting's FGA organizer relation; the edit route needs the project slug (legacy edit button). */
  protected readonly canEdit: Signal<boolean> = computed(
    () => this.view() === 'upcoming' && this.row().meeting.organizer === true && !!this.row().meeting.project_slug
  );
  /** Upcoming only: a past row would delete its whole parent meeting, possibly a live series. */
  protected readonly canDelete: Signal<boolean> = computed(() => this.view() === 'upcoming' && this.row().meeting.organizer === true);
  /** Registered to this upcoming meeting; an organizer only with a registration of their own (legacy `isRegisteredAttendee`). */
  protected readonly canRemove: Signal<boolean> = this.initCanRemove();
  /** A resend goes to the viewer's own registrant row, so one must exist (legacy `canResendInvite`). */
  protected readonly canResend: Signal<boolean> = computed(() => this.canRemove() && this.hasOwnRegistration());
  protected readonly removalMessage: Signal<string> = computed(() =>
    getMeetingSelfRemovalMessage(this.row().title, { viaCommittee: this.row().meeting.invited_via_committee, organizer: this.row().meeting.organizer })
  );
  /** "Thu, Oct 1 · 6:30 AM PDT" for the dialog's meeting card. */
  protected readonly when: Signal<string> = computed(() => formatMeetingDateTime(this.row().startTime));
  protected readonly recurring: Signal<boolean> = computed(() => getMeetingRecurrenceTooltip(this.row().meeting, this.row().occurrence) !== null);
  protected readonly project: Signal<MeetingHomeRowProject | null> = computed(() => getMeetingHomeRowProject(this.row().meeting));
  protected readonly meetingType: Signal<MeetingHomeRowType | null> = computed(() => getMeetingHomeRowType(this.row().meeting));

  private readonly invited: Signal<boolean> = computed(
    () => !!this.row().meeting.invited && !this.meetingService.removedRegistrationMeetingIds().has(this.row().meeting.id)
  );
  private readonly hasOwnRegistration: Signal<boolean> = computed(() => {
    const registrantIds = this.row().meeting.my_registrant_ids;
    return registrantIds ? registrantIds.length > 0 : this.invited();
  });

  public constructor() {
    inject(DestroyRef).onDestroy(() => this.dialogRef?.close());
  }

  protected copyLink(): void {
    const meeting = this.row().meeting;
    const id = this.view() === 'past' ? getPastMeetingResourceId(meeting) : meeting.id;
    let url: URL;
    try {
      url = new URL(`${environment.urls.home}/meetings/${id}`);
    } catch {
      this.showError('Copy Failed', 'Unable to build the meeting link. Please try again.');
      return;
    }
    // The past meeting page does not take the passcode, so a shared past link leaves it out.
    if (meeting.password && this.view() === 'upcoming') url.searchParams.set('password', meeting.password);

    if (!this.clipboard.copy(url.toString())) {
      this.showError('Copy Failed', 'Failed to copy link. Please try again.');
      return;
    }
    this.toast.show({ variant: 'dark', message: 'Meeting Link Copied', description: 'The meeting link has been copied to your clipboard' });
  }

  protected editMeeting(): void {
    this.editService.edit(this.row());
  }

  protected deleteMeeting(): void {
    this.deleteService.delete(this.row());
  }

  protected resendInvite(): void {
    this.inviteResend
      .resendOwn$(this.row().meeting.id, this.row().occurrenceId)
      .pipe(take(1))
      .subscribe({
        next: () => this.toast.show({ variant: 'dark', message: 'Invitation Sent', description: 'We sent the meeting invitation to your email.' }),
        error: (error: unknown) => this.showError('Error', this.inviteResend.describeOwnResendFailure(error)),
      });
  }

  protected confirmRemove(): void {
    // Nothing closes the dialog while the removal runs, since closing would not stop it.
    this.dialogRef = this.modal.open(
      this.removeDialog(),
      { role: 'alertdialog', describedBy: true, autoFocus: '[data-autofocus] button' },
      { closePredicate: () => !this.removing() }
    );
  }

  protected remove(): void {
    // A second click can land before the button renders as loading.
    if (this.removing()) return;
    const ref = this.dialogRef;
    this.removing.set(true);
    this.selfRemoval
      .remove$(this.row().meeting.id, 'meetings-home')
      .pipe(
        take(1),
        finalize(() => {
          this.removing.set(false);
          ref?.close();
        })
      )
      .subscribe({
        next: (result) => {
          if (result.remaining_registrant_ids.length > 0) {
            // The home list has no per-meeting refetch, so reload the feed to show what is left.
            this.userService.refreshUserMeetings();
            this.toast.show({
              variant: 'warning',
              position: 'bottom-center',
              message: 'Removal incomplete',
              description: 'Some of your registrations could not be removed. You are still invited to this meeting. Please try again.',
            });
            return;
          }
          this.toast.show({ variant: 'dark', message: 'Removed', description: 'You have been removed from this meeting.' });
        },
        error: (error: unknown) => this.showError('Error', this.selfRemoval.describeFailure(error)),
      });
  }

  private initCanRemove(): Signal<boolean> {
    return computed(
      () => this.view() === 'upcoming' && this.userService.authenticated() && this.invited() && (!this.row().meeting.organizer || this.hasOwnRegistration())
    );
  }

  private showError(message: string, description: string): void {
    this.toast.show({ variant: 'error', position: 'bottom-center', message, description });
  }
}
