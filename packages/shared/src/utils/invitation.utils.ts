// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PENDING_ACTION_BUTTON_ICON, PENDING_ACTION_SEVERITY } from '../constants/pending-action.constants';
import { PendingActionItem } from '../interfaces/components.interface';
import type { CommitteeOrganizationFormValue, CommitteeOrganizationReference, PendingInvitation } from '../interfaces/committee.interface';
import type { WorkExperienceEntry } from '../interfaces/profile.interface';

/**
 * Returns true when a committee requires organization on invite create/accept.
 */
export function committeeRequiresOrganization(flags: { enable_voting?: boolean; business_email_required?: boolean }): boolean {
  return !!flags.enable_voting || !!flags.business_email_required;
}

/**
 * Picks the current employer from a CDP work-experience array.
 * Prefers an entry without an endDate; falls back to the most recent by startDate.
 * Returns null when the array is empty.
 *
 * startDate is formatted as "MMM YYYY" by the BFF — parsed deterministically to
 * avoid relying on new Date() with non-ISO strings, which is unreliable in Safari.
 */
export function currentEmployerFromWorkExperiences(experiences: WorkExperienceEntry[]): CommitteeOrganizationReference | null {
  if (!experiences.length) return null;
  const current = experiences.find((e) => !e.endDate) ?? [...experiences].sort((a, b) => monthYearToOrdinal(b.startDate) - monthYearToOrdinal(a.startDate))[0];
  return { name: current.organization, id: current.organizationId ?? null };
}

function monthYearToOrdinal(monthYear: string): number {
  const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const [mon, yr] = monthYear.split(' ');
  const month = MONTHS[mon] ?? 0;
  const year = parseInt(yr, 10);
  return isNaN(year) ? 0 : year * 12 + month;
}

/**
 * Resolves whether an invitation accept flow must collect organization.
 *
 * Precedence (highest first):
 * 1. `organization_required` — authoritative field on the invite itself (committee-service ≥ v1.1).
 *    Preferred because it is access-safe: the invitee can read their own invite without being a
 *    committee viewer, whereas the committee/settings endpoints fail the access check for non-members.
 * 2. `inviteRequiresOrganization` — precomputed flag carried through the accept context.
 * 3. `enable_voting` / `business_email_required` — legacy enriched flags; fail-closed to `true`
 *    when both are undefined (unknown committee settings).
 */
export function invitationRequiresOrganization(flags: {
  organization_required?: boolean | null;
  enable_voting?: boolean;
  business_email_required?: boolean;
  inviteRequiresOrganization?: boolean;
}): boolean {
  if (flags.organization_required != null) {
    return flags.organization_required;
  }
  if (flags.inviteRequiresOrganization !== undefined) {
    return flags.inviteRequiresOrganization;
  }
  const { enable_voting, business_email_required } = flags;
  if (enable_voting === undefined && business_email_required === undefined) {
    return true;
  }
  return committeeRequiresOrganization(flags);
}

/**
 * Maps organization form controls to the committee-service organization payload.
 */
export function buildCommitteeOrganizationPayload(
  formValue: Pick<CommitteeOrganizationFormValue, 'organization' | 'organization_url' | 'organization_id'>
): CommitteeOrganizationReference | null {
  const name = formValue.organization?.trim() || null;
  const website = formValue.organization_url?.trim() || null;
  const id = formValue.organization_id?.trim() || null;

  if (name || website || id) {
    return { id, name, website };
  }
  return null;
}

/**
 * Formats an invite expiry (RFC3339) into a short display string (e.g. "Jun 20, 2026"), or null when
 * the value is missing or not a parseable date. Guarding the parse keeps a malformed upstream
 * timestamp from surfacing "Invalid Date" in the UI — callers fall back to no-expiry copy on null.
 */
export function formatInviteExpiry(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) {
    return null;
  }
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Pure mapping from enriched pending committee invitations to dashboard pending-action rows.
 *
 * Extracted from the server aggregator so the row shape — the copy fallback, the accept/decline
 * identifiers, and the per-type tag tone — is unit-testable without standing up the Express stack.
 * Both the inviter name and the expiry are usually absent in the current committee-service contract;
 * the title degrades to "You've been invited to {Group}" and no `date` is set when `expires_at` is
 * missing, so the row never depends on email dispatch (the LFXV2-2117 fallback requirement). When an
 * expiry IS present it's formatted for display (`PendingActionItem.date` is a human-readable string,
 * not a raw ISO timestamp).
 */
export function buildInvitationActions(invitations: PendingInvitation[]): PendingActionItem[] {
  return invitations.map((invitation) => {
    const expiry = formatInviteExpiry(invitation.expires_at);
    // Build the title and its prefix from the same inputs so the UI can link just the group name
    // without runtime string-splitting (`text` = `${prefix}${committee_name}`).
    const titlePrefix = invitation.inviter_name ? `${invitation.inviter_name} invited you to ` : `You've been invited to `;
    const inviteRequiresOrganization = invitationRequiresOrganization(invitation);
    return {
      type: 'Invitation',
      badge: invitation.project_name || invitation.committee_name,
      text: `${titlePrefix}${invitation.committee_name}`,
      inviteTitlePrefix: titlePrefix,
      icon: PENDING_ACTION_BUTTON_ICON.Invitation,
      severity: PENDING_ACTION_SEVERITY.Invitation,
      buttonText: 'Accept',
      inviteUid: invitation.uid,
      committeeUid: invitation.committee_uid,
      inviteGroupName: invitation.committee_name,
      inviteOrganization: invitation.organization ?? null,
      inviteRequiresOrganization,
      ...(expiry ? { date: expiry } : {}),
    };
  });
}

/**
 * Finds the current user's unresolved pending invitation for a specific committee, or null.
 *
 * Shared by the group-detail invite banner: it matches the shared invitation cache against the
 * committee being viewed, excluding any invite already accepted/declined this session (so the banner
 * disappears the moment the user acts, in sync with the other surfaces). Returns null when there is
 * no committee UID or no matching pending invite.
 */
export function findPendingInvitationForCommittee(
  invitations: PendingInvitation[],
  resolvedUids: ReadonlySet<string>,
  committeeUid: string | null | undefined
): PendingInvitation | null {
  if (!committeeUid) {
    return null;
  }
  return invitations.find((invite) => invite.committee_uid === committeeUid && !resolvedUids.has(invite.uid)) ?? null;
}

/**
 * Pure builder for the secondary line on a pending-invitation row.
 *
 * Base copy is "{inviter_name} invited you" when an inviter is known (usually it isn't), otherwise
 * "You've been invited". When the invite carries an expiry, " · expires {formattedExpiry}" is
 * appended — the caller passes the already-formatted date string (e.g. via {@link formatInviteExpiry})
 * so this stays framework-free and testable.
 */
export function buildInvitationSubtext(invitation: PendingInvitation, formattedExpiry?: string | null): string {
  const base = invitation.inviter_name ? `${invitation.inviter_name} invited you` : `You've been invited`;
  if (!invitation.expires_at || !formattedExpiry) {
    return base;
  }
  return `${base} · expires ${formattedExpiry}`;
}
