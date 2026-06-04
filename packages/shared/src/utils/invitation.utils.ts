// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PENDING_ACTION_BUTTON_ICON, PENDING_ACTION_SEVERITY } from '../constants/pending-action.constants';
import { PendingActionItem } from '../interfaces/components.interface';
import { PendingInvitation } from '../interfaces/committee.interface';

/**
 * Pure mapping from enriched pending committee invitations to dashboard pending-action rows.
 *
 * Extracted from the server aggregator so the row shape — the copy fallback, the accept/decline
 * identifiers, and the per-type tag tone — is unit-testable without standing up the Express stack.
 * Both the inviter name and the expiry are usually absent in the current committee-service contract;
 * the title degrades to "You've been invited to {Group}" and no `date` is set when `expires_at` is
 * missing, so the row never depends on email dispatch (the LFXV2-2117 fallback requirement).
 */
export function buildInvitationActions(invitations: PendingInvitation[]): PendingActionItem[] {
  return invitations.map((invitation) => ({
    type: 'Invitation',
    badge: invitation.project_name || invitation.committee_name,
    text: invitation.inviter_name
      ? `${invitation.inviter_name} invited you to ${invitation.committee_name}`
      : `You've been invited to ${invitation.committee_name}`,
    icon: PENDING_ACTION_BUTTON_ICON.Invitation,
    severity: PENDING_ACTION_SEVERITY.Invitation,
    buttonText: 'Accept',
    inviteUid: invitation.uid,
    committeeUid: invitation.committee_uid,
    inviteGroupName: invitation.committee_name,
    ...(invitation.expires_at ? { date: invitation.expires_at } : {}),
  }));
}

/**
 * Pure builder for the secondary line on a pending-invitation row.
 *
 * Base copy is "{inviter_name} invited you" when an inviter is known (usually it isn't), otherwise
 * "You've been invited". When the invite carries an expiry, " · expires {formattedExpiry}" is
 * appended — the caller passes the already-formatted date string (e.g. via Angular's `DatePipe`) so
 * this stays framework-free and testable.
 */
export function buildInvitationSubtext(invitation: PendingInvitation, formattedExpiry?: string | null): string {
  const base = invitation.inviter_name ? `${invitation.inviter_name} invited you` : `You've been invited`;
  if (!invitation.expires_at || !formattedExpiry) {
    return base;
  }
  return `${base} · expires ${formattedExpiry}`;
}
