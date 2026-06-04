// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { inject, Pipe, PipeTransform } from '@angular/core';
import { PendingInvitation } from '@lfx-one/shared/interfaces';
import { buildInvitationSubtext } from '@lfx-one/shared/utils';

/**
 * Builds the secondary line for a pending committee invitation row.
 *
 * Base text is "{inviter_name} invited you" when an inviter name is present (it usually isn't in the
 * current committee-service contract), otherwise "You've been invited". When the invite carries an
 * expiry (also usually absent), " · expires {date}" is appended. The string assembly lives in the
 * framework-free, unit-tested `buildInvitationSubtext`; the pipe only formats the date for it.
 * Keeping this in a pipe avoids a template method and keeps the row template declarative.
 */
@Pipe({
  name: 'invitationSubtext',
})
export class InvitationSubtextPipe implements PipeTransform {
  private readonly datePipe = inject(DatePipe);

  public transform(invitation: PendingInvitation): string {
    const formattedExpiry = invitation.expires_at ? this.datePipe.transform(invitation.expires_at, 'mediumDate') : null;
    return buildInvitationSubtext(invitation, formattedExpiry);
  }
}
