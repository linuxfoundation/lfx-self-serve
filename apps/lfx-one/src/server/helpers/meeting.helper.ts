// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingVisibility } from '@lfx-one/shared/enums';
import { HOST_KEY_EARLY_MINUTES, HOST_KEY_LATE_MINUTES } from '@lfx-one/shared/constants';
import { Meeting, PastMeeting } from '@lfx-one/shared/interfaces';
import { resolveMeetingOrganizer, resolveMeetingOwner } from '@lfx-one/shared/utils';
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
 * Enriches meetings that lack a human organizer identity (`created_by` and/or `owner`) by
 * joining back to the live `v1_meeting` index (the only source that carries them). Upcoming
 * meetings key on their own UID; past meetings key on `meeting_id` (the originating series
 * meeting — `v1_past_meeting` never carries `owner`). Meetings that already carry both, or
 * whose series no longer exists, are left untouched so the organizer display simply falls
 * back (owner → human created_by → omitted).
 *
 * @param req - Express request object
 * @param meetings - Meetings to enrich (mutated copies returned; input is not modified)
 * @param keyOf - Extracts the live `v1_meeting` UID to look up for a given meeting
 * @returns The meetings with `created_by` / `owner` populated where they could be resolved
 */
export async function enrichMeetingsWithCreatedBy<T extends Meeting>(req: Request, meetings: T[], keyOf: (meeting: T) => string | undefined): Promise<T[]> {
  if (meetings.length === 0) {
    return meetings;
  }

  // A meeting needs the join when either identity is missing: no resolvable organizer at all,
  // OR no resolvable owner — OR, not AND, because a past meeting with a human created_by must
  // still pick up the owner so a transferred ownership shows instead of the original creator.
  const needsEnrichment = (meeting: T): boolean => (!resolveMeetingOrganizer(meeting) || !resolveMeetingOwner(meeting)) && !!keyOf(meeting);
  const uids = meetings.filter(needsEnrichment).map((meeting) => keyOf(meeting)!);
  if (uids.length === 0) {
    return meetings;
  }

  const identityMap = await meetingService.resolveCreatedByForMeetings(req, uids);
  if (identityMap.size === 0) {
    return meetings;
  }

  return meetings.map((meeting) => {
    if (!needsEnrichment(meeting)) {
      return meeting;
    }
    const identity = identityMap.get(keyOf(meeting)!);
    if (!identity) {
      return meeting;
    }
    // Fill each field only where the meeting lacks a resolvable value — never clobber an
    // existing human created_by, and never write a zero-valued or service-account owner.
    const hasHumanCreatedBy = !!resolveMeetingOrganizer({ created_by: meeting.created_by });
    const createdBy = !hasHumanCreatedBy && identity.created_by ? identity.created_by : undefined;
    const owner = !resolveMeetingOwner(meeting) && resolveMeetingOwner({ owner: identity.owner }) ? identity.owner : undefined;
    if (!createdBy && !owner) {
      return meeting;
    }
    return {
      ...meeting,
      ...(createdBy ? { created_by: createdBy } : {}),
      ...(owner ? { owner } : {}),
    };
  });
}

/**
 * Removes the Zoom host key from a meeting response.
 *
 * The host key is a 6-digit credential that grants Zoom host privileges to whoever holds it,
 * so it must never reach a client that isn't authorized to see it (see {@link resolveOrganizerAndHostKey}).
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
 * Returns true when the current wall-clock time falls inside the host-key visibility window:
 * [effective_start − 70 min, effective_start + duration + 40 min).
 *
 * Mirrors PCC's showHostKey() logic. The key is account-level and can change leading up to a
 * meeting, so surfacing it days in advance risks showing a stale value.
 *
 * For recurring meetings `start_time` is the series origin, which can be far in the past.
 * `next_occurrence_start_time` is preferred when present so the window tracks the actual
 * upcoming occurrence rather than the series root.
 *
 * Falls back to false when no usable start time is present or parseable.
 */
export function isWithinHostKeyWindow(meeting: Pick<Meeting, 'start_time' | 'duration' | 'next_occurrence_start_time'>, now = new Date()): boolean {
  const effectiveStart = meeting.next_occurrence_start_time || meeting.start_time;
  if (!effectiveStart) return false;
  const startMs = Date.parse(effectiveStart);
  if (isNaN(startMs)) return false;
  const windowStart = startMs - HOST_KEY_EARLY_MINUTES * 60_000;
  const windowEnd = startMs + (meeting.duration ?? 0) * 60_000 + HOST_KEY_LATE_MINUTES * 60_000;
  const nowMs = now.getTime();
  return nowMs >= windowStart && nowMs < windowEnd;
}

/**
 * Resolves whether the current user is a meeting organizer AND (if inside the host-key time
 * window) attempts to fetch the meeting's Zoom host key. This is the single source of truth for
 * host-key visibility on detail endpoints.
 *
 * `organizer` is resolved via `v1_meeting#organizer` — it gates private-meeting access and
 * registrant-count fetches independently of host-key visibility.
 *
 * `can_view_host_key` and `host_key` are derived from whether the host-key fetch returned a
 * value. The query-service enforces the FGA `host` relation on `v1_meeting_host_credentials`
 * (covering direct co-hosts AND anyone with the derived organizer relation — project writers,
 * committee writers, meeting coordinators), so a separate local `host` access-check is
 * redundant with the query-service's gate and is intentionally NOT performed here. This drops
 * one round trip on every request that would otherwise fetch a host key.
 *
 * Time-window check: current time must be within
 * [effective_start − 70 min, effective_start + duration + 40 min), where
 * effective_start = next_occurrence_start_time ?? start_time (mirrors PCC). Outside the window
 * we skip the host-key fetch entirely — the key would be stripped anyway.
 *
 * Runs the organizer check and the host-key fetch in parallel (both use the user's bearer
 * token). The optional `bearerToken` parameter lets the caller fan this out alongside other
 * calls that use a different identity (e.g. M2M) without racing on `req.bearerToken`. When
 * omitted, the calls use `req.bearerToken`.
 *
 * Returns a plain result object — callers apply it to the meeting after other parallel work
 * completes, avoiding races on shared object fields.
 *
 * @param req - Express request object with the user's auth context
 * @param accessCheckService - Access-check service instance
 * @param meetingService - Meeting service instance (used to fetch the host-key credentials doc)
 * @param meeting - The meeting to gate (read-only here; not mutated)
 * @param bearerToken - Optional per-call bearer token override (typically the user's token
 *   captured before an M2M token swap on `req.bearerToken`)
 */
export async function resolveOrganizerAndHostKey(
  req: Request,
  accessCheckService: AccessCheckService,
  meetingService: MeetingService,
  meeting: Pick<Meeting, 'id' | 'start_time' | 'duration' | 'next_occurrence_start_time'>,
  bearerToken?: string
): Promise<{ organizer: boolean; canViewHostKey: boolean; hostKey?: string }> {
  const withinWindow = isWithinHostKeyWindow(meeting);
  const callOptions = bearerToken ? { bearerToken } : undefined;

  // Fire both the organizer FGA check and the host-key fetch in parallel. `checkSingleAccess`
  // already degrades to `false` on upstream failure; the host-key fetch we wrap in Promise.allSettled
  // so a query-service blip cannot fail the whole meeting response.
  const [organizerResult, hostKeyResult] = await Promise.allSettled([
    accessCheckService.checkSingleAccess(req, { resource: 'v1_meeting', id: meeting.id, access: 'organizer' }, callOptions),
    withinWindow ? meetingService.getMeetingHostKey(req, meeting.id, callOptions) : Promise.resolve(null),
  ]);

  if (organizerResult.status === 'rejected') {
    // checkSingleAccess.degrades to false internally, so this branch is only for genuinely
    // unexpected throws (e.g. code bug). Log and fail closed.
    logger.warning(req, 'resolve_organizer_and_host_key', 'Organizer FGA check threw, failing closed', {
      meeting_id: meeting.id,
      err: organizerResult.reason,
    });
  }
  if (hostKeyResult.status === 'rejected') {
    logger.warning(req, 'resolve_organizer_and_host_key', 'Host key fetch failed, continuing without host key', {
      meeting_id: meeting.id,
      err: hostKeyResult.reason,
    });
  }

  const organizer = organizerResult.status === 'fulfilled' ? organizerResult.value : false;
  const hostKey = hostKeyResult.status === 'fulfilled' ? hostKeyResult.value : null;

  return hostKey ? { organizer, canViewHostKey: true, hostKey } : { organizer, canViewHostKey: false };
}

/**
 * Applies a {@link resolveOrganizerAndHostKey} result to a meeting object. Sets `organizer`,
 * `can_view_host_key`, and either sets or strips `host_key` accordingly. Kept as a small helper
 * so both consumer controllers apply the result the same way.
 */
export function applyOrganizerAndHostKeyResult(meeting: Meeting, result: { organizer: boolean; canViewHostKey: boolean; hostKey?: string }): void {
  meeting.organizer = result.organizer;
  meeting.can_view_host_key = result.canViewHostKey;
  if (result.hostKey) {
    meeting.host_key = result.hostKey;
  } else {
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
