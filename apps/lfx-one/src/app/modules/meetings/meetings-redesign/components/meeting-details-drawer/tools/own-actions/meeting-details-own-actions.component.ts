// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, Signal, signal, TemplateRef, viewChild } from '@angular/core';
import { PHONE_MEDIA_QUERY } from '@lfx-one/shared/constants';
import { getMeetingSelfRemovalNotes, getMeetingSelfRemovalQuestion } from '@lfx-one/shared/utils';
import { MeetingOwnInviteResendService } from '@services/meeting-own-invite-resend.service';
import { MeetingSelfRemovalService } from '@services/meeting-self-removal.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { injectIsMobileViewport } from '@shared/utils/mobile-viewport.util';
import { finalize, take } from 'rxjs';

import { MeetingDetailsContext } from '../../meeting-details.context';

/** The viewer's own Resend Invite and Remove Myself in the meeting details drawer, with the legacy meeting page's gates and copy; on phones the header's ⋯ menu shows them. */
@Component({
  selector: 'lfx-meeting-details-own-actions',
  imports: [UiButtonComponent, UiModalComponent],
  templateUrl: './meeting-details-own-actions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
})
export class MeetingDetailsOwnActionsComponent {
  private readonly inviteResend = inject(MeetingOwnInviteResendService);
  private readonly selfRemoval = inject(MeetingSelfRemovalService);
  private readonly modal = inject(UiModalService);
  private readonly toast = inject(UiToastService);
  private readonly context = inject(MeetingDetailsContext);
  private readonly removeDialog = viewChild.required<TemplateRef<unknown>>('removeDialog');
  private dialogRef: DialogRef | null = null;

  protected readonly removing = signal(false);
  protected readonly phone: Signal<boolean> = injectIsMobileViewport(PHONE_MEDIA_QUERY);
  public readonly resending: Signal<boolean> = computed(() => this.inviteResend.isResendingOwn(this.context.meeting().id));
  /** Invited to an upcoming date; an organizer only with a registration of their own (legacy `canLeaveMeeting`). */
  public readonly canRemove: Signal<boolean> = computed(
    () => this.context.state() !== 'ended' && this.context.invited() && (!this.context.organizer() || this.hasOwnRegistration())
  );
  /** A resend goes to the viewer's own registrant row, so one must exist (legacy `canResendInvite`). */
  public readonly canResend: Signal<boolean> = computed(() => this.canRemove() && this.hasOwnRegistration());
  protected readonly removalQuestion: Signal<string> = computed(() => getMeetingSelfRemovalQuestion(this.context.shownRow().title));
  protected readonly removalNotes: Signal<string[]> = computed(() =>
    getMeetingSelfRemovalNotes({ viaCommittee: this.context.meeting().invited_via_committee, organizer: this.context.organizer() })
  );

  private readonly hasOwnRegistration: Signal<boolean> = computed(() => {
    const registrantIds = this.context.meeting().my_registrant_ids;
    if (this.context.listedSelfRegistrantUids().length > 0) return true;
    return registrantIds ? registrantIds.length > 0 : this.context.invited();
  });

  public constructor() {
    inject(DestroyRef).onDestroy(() => this.dialogRef?.close());
  }

  public resendInvite(): void {
    this.inviteResend
      .resendOwn$(this.context.meeting().id, this.context.shownRow().occurrenceId)
      .pipe(take(1))
      .subscribe({
        next: () => this.toast.show({ variant: 'dark', message: 'Meeting invitation sent' }),
        error: (error: unknown) => this.showError('Error', this.inviteResend.describeOwnResendFailure(error)),
      });
  }

  public confirmRemove(): void {
    // Nothing closes the dialog while the removal runs, since closing would not stop it.
    this.dialogRef = this.modal.open(
      this.removeDialog(),
      { role: 'alertdialog', describedBy: true, autoFocus: '[data-autofocus] button' },
      { closePredicate: () => !this.removing() }
    );
  }

  protected remove(): void {
    if (this.removing()) return;
    const ref = this.dialogRef;
    this.removing.set(true);
    this.selfRemoval
      .remove$(this.context.meeting().id, 'meetings-home')
      .pipe(
        take(1),
        finalize(() => {
          this.removing.set(false);
          ref?.close();
        })
      )
      .subscribe({
        next: (result) => {
          // The drawer stays open as the meeting page did; the service marks the meeting removed or refreshes the list.
          if (result.remaining_registrant_ids.length > 0) {
            this.context.refreshList();
            this.showError('Removal incomplete', 'Some of your registrations could not be removed. You are still invited to this meeting. Please try again.');
            return;
          }
          this.toast.show({ variant: 'dark', message: 'Removed from meeting' });
        },
        error: (error: unknown) => this.showError('Error', this.selfRemoval.describeFailure(error)),
      });
  }

  private showError(message: string, description: string): void {
    this.toast.show({ variant: 'error', position: 'bottom-center', message, description });
  }
}
