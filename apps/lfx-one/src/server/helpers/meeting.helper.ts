// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingVisibility } from '@lfx-one/shared/enums';
import { AccessCheckAccessType, AccessCheckRequest, AccessCheckResourceType, Meeting, PastMeeting } from '@lfx-one/shared/interfaces';
import { resolveMeetingOrganizer } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { AccessCheckService } from '../services/access-check.service';
import { CommitteeService } from '../services/committee.service';
import { logger } from '../services/logger.service';
import { MeetingService } from '../services/meeting.service';
import { getEffectiveEmail, getUsernameFromAuth } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';

const meetingService = new MeetingService();
const committeeService = new CommitteeService();

/**
 * Checks if a user is invited to a meeting by their email, falling back to username
 * The meeting service may store a different email (e.g. "meeting email" preference) than the
 * auth email, so we also check by username to ensure we find the registrant.
 * @param req - Express request object
 * @param meetingUid - The meeting UID to check
 * @param email - The user's email address
 * @param m2mToken - Optional M2M token (will be generated if not provided)
 * @returns True if the user is invited to the meeting
 */
export async function isUserInvitedToMeeting(req: Request, meetingUid: string, email: string, m2mToken?: string): Promise<boolean> {
  if (!meetingUid) {
    return false;
  }

  const username = (await getUsernameFromAuth(req)) ?? undefined;

  if (!email && !username) {
    return false;
  }

  const token = m2mToken || (await generateM2MToken(req));
  const registrants = await meetingService.getMeetingRegistrantsForUser(req, meetingUid, email || undefined, username, token);
  return registrants.length > 0;
}

/**
 * Adds invited status to a single meeting
 * @param req - Express request object
 * @param meeting - The meeting to check
 * @param email - The user's email address
 * @param m2mToken - Optional M2M token (will be generated if not provided)
 * @returns The meeting with the invited property added
 */
export async function addInvitedStatusToMeeting(req: Request, meeting: Meeting, email: string, m2mToken?: string): Promise<Meeting> {
  // Check invitation status for all users, including organizers (who may also be invited)
  const invited = await isUserInvitedToMeeting(req, meeting.id, email, m2mToken);

  return {
    ...meeting,
    invited,
  };
}

/**
 * Adds invited status to multiple meetings in parallel
 * @param req - Express request object
 * @param meetings - Array of meetings to check
 * @param email - The user's email address
 * @returns Array of meetings with the invited property added
 */
export async function addInvitedStatusToMeetings(req: Request, meetings: Meeting[], email: string): Promise<Meeting[]> {
  if (meetings.length === 0) {
    return meetings.map((m) => ({ ...m, invited: false }));
  }

  const m2mToken = await generateM2MToken(req);

  // Check invitation status for all meetings, including organizer meetings
  // (organizers may also be invited to their own meetings)
  return Promise.all(meetings.map((meeting) => addInvitedStatusToMeeting(req, meeting, email, m2mToken)));
}

/**
 * Enriches meetings that lack a human `created_by` by joining back to the live
 * `v1_meeting` index (the only source that carries it). Upcoming meetings key on their
 * own UID; past meetings key on `meeting_id` (the originating series meeting). Meetings
 * that already carry a human creator, or whose series no longer exists, are left untouched
 * so the organizer display is simply omitted.
 *
 * @param req - Express request object
 * @param meetings - Meetings to enrich (mutated copies returned; input is not modified)
 * @param keyOf - Extracts the live `v1_meeting` UID to look up for a given meeting
 * @returns The meetings with `created_by` populated where it could be resolved
 */
export async function enrichMeetingsWithCreatedBy<T extends Meeting>(req: Request, meetings: T[], keyOf: (meeting: T) => string | undefined): Promise<T[]> {
  if (meetings.length === 0) {
    return meetings;
  }

  // Only meetings without a resolvable human creator need the join.
  const needsEnrichment = (meeting: T): boolean => !resolveMeetingOrganizer(meeting) && !!keyOf(meeting);
  const uids = meetings.filter(needsEnrichment).map((meeting) => keyOf(meeting)!);
  if (uids.length === 0) {
    return meetings;
  }

  const createdByMap = await meetingService.resolveCreatedByForMeetings(req, uids);
  if (createdByMap.size === 0) {
    return meetings;
  }

  return meetings.map((meeting) => {
    if (!needsEnrichment(meeting)) {
      return meeting;
    }
    const createdBy = createdByMap.get(keyOf(meeting)!);
    return createdBy ? { ...meeting, created_by: createdBy } : meeting;
  });
}

/**
 * Removes the Zoom host key from a meeting response.
 *
 * The host key is a 6-digit credential that grants Zoom host privileges to whoever holds it,
 * so it must never reach a client that isn't authorized to see it (see {@link applyHostKeyVisibility}).
 * Used directly on response paths where the host key is never surfaced (list views, past meetings,
 * anonymous callers, create echoes).
 *
 * @param meeting - The meeting (or partial) to strip; no-ops on null/undefined
 */
export function stripHostKey(meeting: Partial<Meeting> | null | undefined): void {
  if (meeting) {
    delete meeting.host_key;
  }
}

/**
 * Resolves whether the current user may view a meeting's Zoom host key and mutates the meeting
 * accordingly. This is the single source of truth for host-key visibility on detail endpoints.
 *
 * The audience is any of three DISTINCT OpenFGA relations, OR-ed together:
 *   - meeting organizer (`v1_meeting#organizer`)
 *   - project writer (`project#writer`)
 *   - writer on ANY committee attached to the meeting (`committee#writer`)
 *
 * All checks are batched into a single `/access-check` round-trip (no sequential per-committee
 * calls). The check is fail-closed: on any upstream error the access-check service returns
 * all-false, so the host key is stripped.
 *
 * Sets `meeting.organizer` (still consumed downstream for registrant-count gating) and
 * `meeting.can_view_host_key` (the single gate the frontend reads), and deletes `host_key`
 * when the user is not authorized.
 *
 * MUST be called with the user's own bearer token active on `req` — NOT an M2M token — or the
 * access check evaluates against the application identity instead of the user.
 *
 * @param req - Express request object with the user's auth context
 * @param accessCheckService - Access-check service instance
 * @param meeting - The meeting to gate (mutated in place)
 */
export async function applyHostKeyVisibility(req: Request, accessCheckService: AccessCheckService, meeting: Meeting): Promise<void> {
  const requests: AccessCheckRequest[] = [
    { resource: 'v1_meeting', id: meeting.id, access: 'organizer' },
    { resource: 'project', id: meeting.project_uid, access: 'writer' },
    ...(meeting.committees ?? [])
      .filter((committee) => committee?.uid)
      .map((committee) => ({ resource: 'committee' as AccessCheckResourceType, id: committee.uid, access: 'writer' as AccessCheckAccessType })),
  ];

  const results = await accessCheckService.checkAccess(req, requests);

  meeting.organizer = results.get(meeting.id) ?? false;
  meeting.can_view_host_key = Array.from(results.values()).some(Boolean);

  if (!meeting.can_view_host_key) {
    stripHostKey(meeting);
  }
}

/**
 * Determines whether a user has full access to a past meeting based on
 * visibility, authentication, and membership (registrant, participant,
 * organizer, or committee member).
 */
export async function checkPastMeetingAccess(req: Request, meeting: PastMeeting, m2mToken: string, isOrganizer: boolean): Promise<boolean> {
  // Public, non-restricted meetings are accessible to everyone
  if (meeting.visibility === MeetingVisibility.PUBLIC && !meeting.restricted) {
    return true;
  }

  // Organizer status was already determined by the controller
  if (isOrganizer) {
    return true;
  }

  // Non-authenticated users cannot access non-public meetings
  if (!req.oidc?.isAuthenticated()) {
    logger.debug(req, 'check_past_meeting_access', 'Unauthenticated user denied access to non-public meeting', {
      past_meeting_id: meeting.id,
    });
    return false;
  }

  const email = getEffectiveEmail(req) || '';
  const username = await getUsernameFromAuth(req);

  logger.debug(req, 'check_past_meeting_access', 'Running membership checks', {
    past_meeting_id: meeting.id,
    meeting_id: meeting.meeting_id,
    has_email: !!email,
    has_username: !!username,
    committee_count: meeting.committees?.length ?? 0,
  });

  // Run registrant, participant, and committee checks in parallel
  const registrantCheck = isUserInvitedToMeeting(req, meeting.meeting_id, email, m2mToken);
  const participantCheck = meetingService.isUserPastMeetingParticipant(req, meeting.id, email, username ?? undefined);

  const committeeChecks: Promise<boolean>[] = [];
  if (username && meeting.committees?.length) {
    for (const committee of meeting.committees) {
      committeeChecks.push(
        committeeService
          .getCommitteeMembers(req, committee.uid, { tags_all: [`username:${username}`] })
          .then((members) => members.length > 0)
          .catch(() => false)
      );
    }
  }

  const [isRegistrant, isParticipant, ...committeeResults] = await Promise.all([registrantCheck, participantCheck, ...committeeChecks]);
  const isCommitteeMember = committeeResults.some((r) => r);

  logger.debug(req, 'check_past_meeting_access', 'Membership check complete', {
    past_meeting_id: meeting.id,
    has_email: !!email,
    has_username: !!username,
    is_registrant: isRegistrant,
    is_participant: isParticipant,
    is_committee_member: isCommitteeMember,
    committee_results: committeeResults,
  });

  const hasAccess = isRegistrant || isParticipant || isCommitteeMember;

  return hasAccess;
}
