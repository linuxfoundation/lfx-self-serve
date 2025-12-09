// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Meeting } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MeetingService } from '../services/meeting.service';
import { generateM2MToken } from '../utils/m2m-token.util';

const meetingService = new MeetingService();

/**
 * Checks if a user is invited to a meeting by their email
 * @param req - Express request object
 * @param meetingUid - The meeting UID to check
 * @param email - The user's email address
 * @param m2mToken - Optional M2M token (will be generated if not provided)
 * @returns True if the user is invited to the meeting
 */
export async function isUserInvitedToMeeting(req: Request, meetingUid: string, email: string, m2mToken?: string): Promise<boolean> {
  if (!email || !meetingUid) {
    return false;
  }

  const token = m2mToken || (await generateM2MToken(req));
  const registrants = await meetingService.getMeetingRegistrantsByEmail(req, meetingUid, email, token);

  return registrants.resources.length > 0;
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
  // V1 meetings are now transformed server-side to have uid populated
  const invited = meeting.organizer ? false : await isUserInvitedToMeeting(req, meeting.uid, email, m2mToken);

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
  if (!email || meetings.length === 0) {
    return meetings.map((m) => ({ ...m, invited: false }));
  }

  // Filter out meetings that are organizers
  const nonOrganizerMeetings = meetings.filter((m) => !m.organizer);

  // If there are no non-organizer meetings, return the meetings with invited status set to false
  if (nonOrganizerMeetings.length === 0) {
    return meetings.map((m) => ({ ...m, invited: false }));
  }

  const m2mToken = await generateM2MToken(req);

  return Promise.all(meetings.map((meeting) => addInvitedStatusToMeeting(req, meeting, email, m2mToken)));
}
