// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingVisibility } from '@lfx-one/shared/enums';
import { Meeting, PastMeeting } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

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

  const token = m2mToken || (await generateM2MToken(req));

  // Try email first
  if (email) {
    const registrants = await meetingService.getMeetingRegistrantsByEmail(req, meetingUid, email, token);
    if (registrants.length > 0) {
      return true;
    }
  }

  // Fall back to username
  const username = await getUsernameFromAuth(req);
  if (username) {
    const registrants = await meetingService.getMeetingRegistrantsByUsername(req, meetingUid, username, token);
    return registrants.length > 0;
  }

  return false;
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
