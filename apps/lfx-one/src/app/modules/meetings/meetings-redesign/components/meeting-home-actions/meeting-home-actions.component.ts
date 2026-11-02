// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { DialogRef } from '@angular/cdk/dialog';
import { formatDate } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, Signal, signal, TemplateRef, viewChild } from '@angular/core';
import { DEFAULT_MEETING_TYPE_CONFIG, MEETING_TYPE_CONFIGS } from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import { MeetingDashboardView, MeetingHomeRow, MeetingHomeRowType } from '@lfx-one/shared/interfaces';
import { getMeetingRecurrenceTooltip, getMeetingSelfRemovalMessage, getPastMeetingResourceId } from '@lfx-one/shared/utils';
import { environment } from '@environments/environment';
import { MeetingInviteResendService } from '@services/meeting-invite-resend.service';
import { MeetingSelfRemovalService } from '@services/meeting-self-removal.service';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiMenuItemComponent } from '@shared/uikit/menu/menu-item.component';
import { UiMenuComponent } from '@shared/uikit/menu/menu.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { finalize } from 'rxjs';

/**
 * The ⋯ menu of a meetings home row or card: Copy Link, and for upcoming meetings Resend Invite and Remove Myself.
 * @description Resend and Remove follow the legacy meeting card's gates. Feedback is uikit toasts at the bottom centre.
 */
@Component({
  selector: 'lfx-meeting-home-actions',
  imports: [UiAvatarComponent, UiButtonComponent, UiMenuComponent, UiMenuItemComponent, UiModalComponent],
  templateUrl: './meeting-home-actions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
})
export class MeetingHomeActionsComponent {
  private readonly clipboard = inject(Clipboard);
  private readonly toast = inject(UiToastService);
  private readonly modal = inject(UiModalService);
  private readonly inviteResend = inject(MeetingInviteResendService);
  private readonly selfRemoval = inject(MeetingSelfRemovalService);
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  private readonly removeDialog = viewChild.required<TemplateRef<unknown>>('removeDialog');
  private dialogRef: DialogRef | null = null;

  public readonly row = input.required<MeetingHomeRow>();
  public readonly view = input.required<MeetingDashboardView>();

  protected readonly removing = signal(false);
  protected readonly resending: Signal<boolean> = computed(() => this.inviteResend.isResendingOwn(this.row().meeting.id));
  /** Registered to this upcoming meeting; an organizer only with a registration of their own (legacy `isRegisteredAttendee`). */
  protected readonly canRemove: Signal<boolean> = this.initCanRemove();
  /** A resend goes to the viewer's own registrant row, so one must exist (legacy `canResendInvite`). */
  protected readonly canResend: Signal<boolean> = computed(() => this.canRemove() && this.hasOwnRegistration());
  protected readonly removalMessage: Signal<string> = computed(() =>
    getMeetingSelfRemovalMessage(this.row().title, { viaCommittee: this.row().meeting.invited_via_committee, organizer: this.row().meeting.organizer })
  );
  /** "Thu, Oct 1 · 6:30 AM PDT" for the dialog's meeting card. */
  protected readonly when: Signal<string> = this.initWhen();
  protected readonly recurring: Signal<boolean> = computed(() => getMeetingRecurrenceTooltip(this.row().meeting, this.row().occurrence) !== null);
  protected readonly meetingType: Signal<MeetingHomeRowType | null> = this.initMeetingType();

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
    if (meeting.password) url.searchParams.set('password', meeting.password);

    if (!this.clipboard.copy(url.toString())) {
      this.showError('Copy Failed', 'Failed to copy link. Please try again.');
      return;
    }
    this.toast.show({ variant: 'dark', message: 'Meeting Link Copied', description: 'The meeting link has been copied to your clipboard' });
  }

  protected resendInvite(): void {
    this.inviteResend.resendOwn$(this.row().meeting.id, this.row().occurrenceId).subscribe({
      next: () => this.toast.show({ variant: 'dark', message: 'Invitation Sent', description: 'We sent the meeting invitation to your email.' }),
      error: (error: unknown) => this.showError('Error', this.inviteResend.describeOwnResendFailure(error)),
    });
  }

  protected confirmRemove(): void {
    this.dialogRef = this.modal.open(this.removeDialog(), { role: 'alertdialog', autoFocus: '[data-autofocus] button' });
  }

  protected remove(): void {
    const ref = this.dialogRef;
    this.removing.set(true);
    this.selfRemoval
      .remove$(this.row().meeting.id, 'meetings-home')
      .pipe(
        finalize(() => {
          this.removing.set(false);
          ref?.close();
        })
      )
      .subscribe({
        next: (result) => {
          if (result.remaining_registrant_ids.length > 0) {
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

  private showError(message: string, description: string): void {
    this.toast.show({ variant: 'error', position: 'bottom-center', message, description });
  }

  private initCanRemove(): Signal<boolean> {
    return computed(
      () => this.view() === 'upcoming' && this.userService.authenticated() && this.invited() && (!this.row().meeting.organizer || this.hasOwnRegistration())
    );
  }

  private initWhen(): Signal<string> {
    return computed(() => {
      const start = new Date(this.row().startTime);
      const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(start);
      return `${formatDate(start, 'EEE, MMM d', 'en-US')} · ${time}`;
    });
  }

  private initMeetingType(): Signal<MeetingHomeRowType | null> {
    return computed(() => {
      const type = this.row().meeting.meeting_type?.trim();
      if (!type || type === MeetingType.NONE) return null;
      const config = MEETING_TYPE_CONFIGS[type.toLowerCase()];
      return { label: config?.label ?? type, icon: (config ?? DEFAULT_MEETING_TYPE_CONFIG).icon };
    });
  }
}
