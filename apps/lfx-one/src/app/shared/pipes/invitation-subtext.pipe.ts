// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { PendingInvitation } from '@lfx-one/shared/interfaces';
import { buildInvitationSubtext, formatInviteExpiry } from '@lfx-one/shared/utils';

/**
 * Builds the secondary line for a pending committee invitation row.
 *
 * Base text is "{inviter_name} invited you" when an inviter name is present (it usually isn't in the
 * current committee-service contract), otherwise "You've been invited". When the invite carries an
 * expiry (also usually absent), " · expires {date}" is appended. The string assembly lives in the
 * framework-free, unit-tested `buildInvitationSubtext`; the pipe only formats the date for it.
 *
 * Formats the date with `toLocaleDateString` (no `DatePipe` injection) so the pipe is self-sufficient
 * in any component — injecting `DatePipe` would NullInjector-crash any host that uses the pipe without
 * adding `DatePipe` to its `providers`.
 */
@Pipe({
  name: 'invitationSubtext',
  standalone: true,
})
export class InvitationSubtextPipe implements PipeTransform {
  public transform(invitation: PendingInvitation): string {
    // formatInviteExpiry guards malformed timestamps (returns null), so the subtext falls back to the
    // base copy instead of rendering "Invalid Date".
    return buildInvitationSubtext(invitation, formatInviteExpiry(invitation.expires_at));
  }
}
