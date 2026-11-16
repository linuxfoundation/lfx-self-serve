// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import {
  MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_LIST_NOTE,
  MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_SEND_LABEL,
  MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_STEPS,
  MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_STEPS_HEADING,
} from '@lfx-one/shared/constants';
import { MentorshipEmailInviteDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Invite-by-email dialog of the Mentors tab. Before an invitation goes to an address no LF account uses, it shows the
 * admin what the invitee must do; it closes with `true` on Send invite, or with nothing when cancelled or dismissed.
 */
@Component({
  selector: 'lfx-mentorship-email-invite-dialog',
  imports: [ButtonComponent],
  templateUrl: './email-invite-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailInviteDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject<DynamicDialogConfig<MentorshipEmailInviteDialogData>>(DynamicDialogConfig);

  protected readonly data: MentorshipEmailInviteDialogData = this.dialogConfig.data ?? { email: '', programName: '' };
  protected readonly stepsHeading = MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_STEPS_HEADING;
  protected readonly steps = MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_STEPS;
  protected readonly listNote = MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_LIST_NOTE;
  protected readonly sendLabel = MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_SEND_LABEL;

  protected onSend(): void {
    this.dialogRef.close(true);
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }
}
