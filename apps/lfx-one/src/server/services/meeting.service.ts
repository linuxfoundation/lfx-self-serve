// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { QueryServiceMeetingType } from '@lfx-one/shared/enums';
import {
  ApiResponse,
  AttachmentDownloadUrlResponse,
  CreateMeetingAttachmentRequest,
  CreateMeetingRegistrantRequest,
  CreateMeetingRequest,
  CreateMeetingRsvpRequest,
  ITXCreateMeetingResponseRequest,
  ITXMeetingResponseResult,
  Meeting,
  MeetingAttachment,
  MeetingJoinURL,
  MeetingRecurrence,
  MeetingRegistrant,
  MeetingRsvp,
  PaginatedResponse,
  PastMeeting,
  PastMeetingAttachment,
  PastMeetingParticipant,
  PastMeetingRecording,
  PastMeetingSummary,
  PresignAttachmentRequest,
  PresignAttachmentResponse,
  QueryServiceCountResponse,
  QueryServiceResponse,
  UpdateMeetingAttachmentRequest,
  UpdateMeetingRegistrantRequest,
  UpdateMeetingRequest,
  UpdatePastMeetingSummaryRequest,
} from '@lfx-one/shared/interfaces';
import { mapITXResponseToMeetingRsvp, transformV1SummaryToV2 } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { pollEndpoint } from '../helpers/poll-endpoint.helper';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { getEffectiveEmail, getUsernameFromAuth, stripAuthPrefix, usernameMatches } from '../utils/auth-helper';
import { AccessCheckService } from './access-check.service';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { ProjectService } from './project.service';

/**
 * Service for handling meeting business logic with microservice proxy
 */
export class MeetingService {
  private accessCheckService: AccessCheckService;
  private microserviceProxy: MicroserviceProxyService;
  private committeeService: CommitteeService;
  private projectService: ProjectService;

  public constructor() {
    this.accessCheckService = new AccessCheckService();
    this.microserviceProxy = new MicroserviceProxyService();
    this.committeeService = new CommitteeService();
    this.projectService = new ProjectService();
  }

  /**
   * Fetches all meetings based on query parameters
   */
  public async getMeetings(
    req: Request,
    query: Record<string, any> = {},
    meetingType: QueryServiceMeetingType = 'v1_meeting',
    access: boolean = true
  ): Promise<PaginatedResponse<Meeting>> {
    logger.debug(req, 'get_meetings', 'Starting meeting fetch', {
      type: meetingType,
      query_params: Object.keys(query),
    });

    const params = {
      ...query,
      type: meetingType,
    };

    const { resources, page_token } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Meeting>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      params
    );

    logger.debug(req, 'get_meetings', 'Fetched resources from query service', {
      count: resources.length,
      type: meetingType,
      has_more_pages: !!page_token,
    });

    let meetings: Meeting[] = resources.map((resource) => ({
      ...resource.data,
      id: resource.data.id || resource.id?.split(':').pop() || resource.id,
    }));

    // Enrich meetings with project names and committee data in parallel (independent enrichments)
    const hasCommittees = meetings.some((m) => m.committees && m.committees.length > 0);

    logger.debug(req, 'get_meetings', 'Enriching meetings with project names and committee data', {
      count: meetings.length,
      has_committees: hasCommittees,
    });

    const [meetingsWithProjects, committeeNameMap] = await Promise.all([
      this.getMeetingProjectName(req, meetings),
      hasCommittees ? this.getCommitteeNameMap(req, meetings) : Promise.resolve(new Map<string, string>()),
    ]);

    // Merge committee names into project-enriched meetings
    meetings = meetingsWithProjects;
    if (hasCommittees && committeeNameMap.size > 0) {
      meetings
        .filter((m) => m.committees && m.committees.length > 0)
        .forEach((m) => {
          m.committees = m.committees.map((c) => ({
            uid: c.uid,
            name: committeeNameMap.get(c.uid) || c.name,
            allowed_voting_statuses: c.allowed_voting_statuses,
          }));
        });
    }

    if (access) {
      logger.debug(req, 'get_meetings', 'Adding access control information', {
        count: meetings.length,
      });
      // Add writer access field to all meetings
      const accessMeetings = await this.accessCheckService.addAccessToResources(req, meetings, meetingType, 'organizer');
      return { data: accessMeetings, page_token };
    }

    logger.debug(req, 'get_meetings', 'Completed meeting fetch', {
      final_count: meetings.length,
    });

    return { data: meetings, page_token };
  }

  /**
   * Fetches the count of meetings based on query parameters
   */
  public async getMeetingsCount(req: Request, query: Record<string, any> = {}, meetingType: string = 'v1_meeting'): Promise<number> {
    logger.debug(req, 'get_meetings_count', 'Fetching meeting count', {
      type: meetingType,
      query_params: Object.keys(query),
    });

    const params = {
      ...query,
      type: meetingType,
    };

    const { count } = await this.microserviceProxy.proxyRequest<QueryServiceCountResponse>(req, 'LFX_V2_SERVICE', '/query/resources/count', 'GET', params);

    return count;
  }

  /**
   * Fetches a single meeting by UID
   */
  public async getMeetingById(req: Request, meetingUid: string, meetingType: QueryServiceMeetingType = 'v1_meeting', access: boolean = true): Promise<Meeting> {
    logger.debug(req, 'get_meeting_by_id', 'Fetching meeting by ID', {
      meeting_id: meetingUid,
      type: meetingType,
    });

    // All meetings are now ITX-managed, use the ITX endpoint
    const meeting = await this.microserviceProxy.proxyRequest<Meeting>(req, 'LFX_V2_SERVICE', `/itx/meetings/${meetingUid}`, 'GET');

    // Set the meeting ID from the URL param
    meeting.id = meetingUid;

    if (!meeting || !meeting.id) {
      throw new ResourceNotFoundError('Meeting', meetingUid, {
        operation: 'get_meeting_by_id',
        service: 'meeting_service',
        path: `/itx/meetings/${meetingUid}`,
      });
    }

    if (meeting.committees && meeting.committees.length > 0) {
      logger.debug(req, 'get_meeting_by_id', 'Enriching meeting with committee data', {
        meeting_id: meetingUid,
        committee_count: meeting.committees.length,
      });
      const committeeNameMap = await this.getCommitteeNameMap(req, [meeting]);
      meeting.committees = meeting.committees.map((c) => ({
        uid: c.uid,
        name: committeeNameMap.get(c.uid) || c.name,
        allowed_voting_statuses: c.allowed_voting_statuses,
      }));
    }

    if (access) {
      logger.debug(req, 'get_meeting_by_id', 'Adding access control information', {
        meeting_id: meetingUid,
      });
      // Add writer access field to the meeting
      return await this.accessCheckService.addAccessToResource(req, meeting, meetingType, 'organizer');
    }

    logger.debug(req, 'get_meeting_by_id', 'Completed meeting fetch', {
      meeting_id: meetingUid,
    });

    return meeting;
  }

  /**
   * Fetches a single past meeting by UID via ITX endpoint
   */
  public async getPastMeetingById(req: Request, pastMeetingUid: string): Promise<PastMeeting> {
    logger.debug(req, 'get_past_meeting_by_id', 'Fetching past meeting by ID', {
      past_meeting_id: pastMeetingUid,
    });

    const meeting = await this.microserviceProxy.proxyRequest<PastMeeting>(req, 'LFX_V2_SERVICE', `/itx/past_meetings/${pastMeetingUid}`, 'GET');

    if (!meeting) {
      throw new ResourceNotFoundError('Past Meeting', pastMeetingUid, {
        operation: 'get_past_meeting_by_id',
        service: 'meeting_service',
        path: `/itx/past_meetings/${pastMeetingUid}`,
      });
    }

    meeting.id = pastMeetingUid;

    if (meeting.committees && meeting.committees.length > 0) {
      logger.debug(req, 'get_past_meeting_by_id', 'Enriching past meeting with committee data', {
        past_meeting_id: pastMeetingUid,
        committee_count: meeting.committees.length,
      });
      const committeeNameMap = await this.getCommitteeNameMap(req, [meeting]);
      meeting.committees = meeting.committees.map((c) => ({
        uid: c.uid,
        name: committeeNameMap.get(c.uid) || c.name,
        allowed_voting_statuses: c.allowed_voting_statuses,
      }));
    }

    logger.debug(req, 'get_past_meeting_by_id', 'Completed past meeting fetch', {
      past_meeting_id: pastMeetingUid,
    });

    return meeting;
  }

  /**
   * Creates a new meeting with automatic organizer assignment
   */
  public async createMeeting(req: Request, meetingData: CreateMeetingRequest): Promise<Meeting> {
    // Get the logged-in user's username to set as organizer
    const username = await getUsernameFromAuth(req);

    // Include organizers in the create payload
    const createPayload = {
      ...meetingData,
      ...(username && { organizers: [username] }),
      ...(meetingData.recurrence && { recurrence: this.normalizeRecurrence(meetingData.recurrence) }),
    };

    const sanitizedPayload = logger.sanitize({ createPayload });
    logger.debug(req, 'create_meeting', 'Creating meeting payload', sanitizedPayload);

    const newMeeting = await this.microserviceProxy.proxyRequest<Meeting>(req, 'LFX_V2_SERVICE', '/itx/meetings', 'POST', undefined, createPayload, {
      ['X-Sync']: 'true',
    });

    // After creating, fetch the meeting with retry to handle permission propagation delay.
    // The GET may return 403 initially due to a race condition — permissions are eventually consistent.
    const meetingId = newMeeting.id;
    let fetchedMeeting: Meeting | undefined;

    const resolved = await pollEndpoint({
      req,
      operation: 'create_meeting',
      pollFn: async () => {
        try {
          const meeting = await this.microserviceProxy.proxyRequest<Meeting>(req, 'LFX_V2_SERVICE', `/itx/meetings/${meetingId}`, 'GET');
          meeting.id = meetingId;
          fetchedMeeting = meeting;
          return true;
        } catch (error: any) {
          const is403 = error?.statusCode === 403 || error?.status === 403;
          if (is403) return false;
          throw error;
        }
      },
      metadata: { meeting_id: meetingId },
    });

    if (resolved && fetchedMeeting) {
      return fetchedMeeting;
    }

    logger.warning(req, 'create_meeting', 'Failed to fetch created meeting, returning POST response', { meeting_id: meetingId });
    return newMeeting;
  }

  /**
   * Updates a meeting directly via microservice proxy
   */
  public async updateMeeting(req: Request, meetingUid: string, meetingData: UpdateMeetingRequest, editType?: 'single' | 'future'): Promise<ApiResponse<void>> {
    // Fetch existing meeting to merge organizers
    const existingMeeting = await this.microserviceProxy.proxyRequest<Meeting>(req, 'LFX_V2_SERVICE', `/itx/meetings/${meetingUid}`, 'GET');

    // Get the logged-in user's username to maintain organizer if not provided
    const username = await getUsernameFromAuth(req);

    // Create organizers array ensuring no duplicates or null values
    const existingOrganizers = existingMeeting.organizers || [];
    const organizersSet = new Set(existingOrganizers.filter((organizer) => organizer != null));

    // Add current user as organizer if username exists and not already included
    if (username) {
      organizersSet.add(username);
    }

    // Include organizers in the update payload
    const updatePayload = {
      ...meetingData,
      organizers: Array.from(organizersSet),
      ...(meetingData.recurrence && { recurrence: this.normalizeRecurrence(meetingData.recurrence) }),
    };

    const sanitizedPayload = logger.sanitize({ updatePayload, editType });
    logger.debug(req, 'update_meeting', 'Updating meeting payload', sanitizedPayload);

    const query = editType ? { editType } : undefined;

    return await this.microserviceProxy.proxyRequestWithResponse<void>(req, 'LFX_V2_SERVICE', `/itx/meetings/${meetingUid}`, 'PUT', query, updatePayload);
  }

  /**
   * Deletes a meeting directly via microservice proxy
   */
  public async deleteMeeting(req: Request, meetingUid: string): Promise<void> {
    logger.debug(req, 'delete_meeting', 'Deleting meeting', {
      meeting_id: meetingUid,
    });

    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/itx/meetings/${meetingUid}`, 'DELETE');

    // After deleting, poll the query service until the meeting no longer appears.
    // The upstream service uses eventual consistency, so the resource may still be indexed briefly.
    await pollEndpoint({
      req,
      operation: 'delete_meeting',
      pollFn: async () => {
        const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Meeting>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'v1_meeting',
          tags: `${meetingUid}`,
        });
        return resources.length === 0;
      },
      metadata: { meeting_id: meetingUid },
    });
  }

  /**
   * Cancels a meeting occurrence directly via microservice proxy
   */
  public async cancelOccurrence(req: Request, meetingUid: string, occurrenceId: string): Promise<void> {
    logger.debug(req, 'cancel_occurrence', 'Canceling meeting occurrence', {
      meeting_id: meetingUid,
      occurrence_id: occurrenceId,
    });

    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/itx/meetings/${meetingUid}/occurrences/${occurrenceId}`, 'DELETE');
  }

  /**
   * Fetches all registrants for a meeting
   * @param includeRsvp - If true, includes RSVP status for each registrant
   */
  public async getMeetingRegistrants(req: Request, meetingUid: string, includeRsvp: boolean = false): Promise<MeetingRegistrant[]> {
    // Registrant records carry `parent_refs: ['meeting:<uid>']` but no indexed tags — use `parent`
    // to query parent_refs, matching the working pattern in getMeetingRsvps.
    const params: Record<string, any> = {
      type: 'v1_meeting_registrant',
      parent: `meeting:${meetingUid}`,
    };

    logger.debug(req, 'get_meeting_registrants', 'Fetching meeting registrants', { meeting_id: meetingUid, params });

    let registrants = await fetchAllQueryResources<MeetingRegistrant>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRegistrant>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        ...params,
        ...(pageToken && { page_token: pageToken }),
      })
    );

    // If include_rsvp is true, fetch RSVP data and attach to registrants
    if (includeRsvp) {
      try {
        const rsvps = await this.getMeetingRsvps(req, meetingUid);

        // Group RSVPs by registrant_id for lookup
        const rsvpsByRegistrant = new Map<string, MeetingRsvp[]>();
        for (const rsvp of rsvps) {
          const key = rsvp.registrant_id;
          if (!rsvpsByRegistrant.has(key)) {
            rsvpsByRegistrant.set(key, []);
          }
          rsvpsByRegistrant.get(key)!.push(rsvp);
        }

        // Attach most recent RSVP to each registrant by uid
        registrants = registrants.map((registrant) => {
          const registrantRsvps = rsvpsByRegistrant.get(registrant.uid);
          if (!registrantRsvps || registrantRsvps.length === 0) {
            return { ...registrant, rsvp: null };
          }

          // Sort by most recent modification and pick the first
          const sorted = [...registrantRsvps].sort((a, b) => {
            const dateA = new Date(a.modified_at || a.created_at).getTime();
            const dateB = new Date(b.modified_at || b.created_at).getTime();
            return dateB - dateA;
          });

          return { ...registrant, rsvp: sorted[0] };
        });
      } catch (error) {
        logger.warning(req, 'get_meeting_registrants', 'Failed to fetch RSVPs for registrants, returning registrants without RSVP data', {
          meeting_id: meetingUid,
          err: error,
        });
      }
    }

    return registrants;
  }

  /**
   * Fetches all registrants for a meeting by email
   */
  public async getMeetingRegistrantsByEmail(req: Request, meetingUid: string, email: string, m2mToken?: string): Promise<MeetingRegistrant[]> {
    // Registrant records carry email/meeting_id as data fields, not indexed tags — use `filters` (field-level AND).
    const normalizedEmail = email.toLowerCase();
    const params: Record<string, any> = {
      type: 'v1_meeting_registrant',
      parent: '',
      filters: [`email:${normalizedEmail}`, `meeting_id:${meetingUid}`],
    };

    logger.debug(req, 'get_meeting_registrants_by_email', 'Fetching meeting registrants by email params', {
      meeting_id: meetingUid,
      email: normalizedEmail,
      params,
    });

    const headers = m2mToken ? { Authorization: `Bearer ${m2mToken}` } : undefined;

    return fetchAllQueryResources<MeetingRegistrant>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRegistrant>>(
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        { ...params, ...(pageToken && { page_token: pageToken }) },
        undefined,
        headers
      )
    );
  }

  /**
   * Fetches registrants for a meeting that match the caller's email or username in a single query.
   * Uses `filters=meeting_id:X` (AND) combined with `filters_or=[email:Y, username:Z]` so the
   * query service resolves the intersection in one call instead of two sequential lookups.
   */
  public async getMeetingRegistrantsForUser(
    req: Request,
    meetingUid: string,
    email: string | undefined,
    username: string | undefined,
    m2mToken?: string
  ): Promise<MeetingRegistrant[]> {
    const orClauses: string[] = [];
    if (email) orClauses.push(`email:${email.toLowerCase()}`);
    if (username) orClauses.push(`username:${stripAuthPrefix(username)}`);
    if (orClauses.length === 0) return [];

    const params: Record<string, any> = {
      type: 'v1_meeting_registrant',
      parent: '',
      filters: [`meeting_id:${meetingUid}`],
      filters_or: orClauses,
    };

    logger.debug(req, 'get_meeting_registrants_for_user', 'Fetching registrants for current user', {
      meeting_id: meetingUid,
      has_email: !!email,
      has_username: !!username,
    });

    const headers = m2mToken ? { Authorization: `Bearer ${m2mToken}` } : undefined;

    return fetchAllQueryResources<MeetingRegistrant>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRegistrant>>(
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        { ...params, ...(pageToken && { page_token: pageToken }) },
        undefined,
        headers
      )
    );
  }

  /**
   * Fetches all registrants for a meeting by username.
   * Strips any auth provider prefix (e.g. "auth0|") since the query service stores plain usernames.
   */
  public async getMeetingRegistrantsByUsername(req: Request, meetingUid: string, username: string, m2mToken?: string): Promise<MeetingRegistrant[]> {
    const plainUsername = stripAuthPrefix(username);
    // Registrant records carry username/meeting_id as data fields, not indexed tags — use `filters` (field-level AND).
    const params: Record<string, any> = {
      type: 'v1_meeting_registrant',
      parent: '',
      filters: [`username:${plainUsername}`, `meeting_id:${meetingUid}`],
    };

    logger.debug(req, 'get_meeting_registrants_by_username', 'Fetching meeting registrants by username', { meeting_id: meetingUid, username: plainUsername });

    const headers = m2mToken ? { Authorization: `Bearer ${m2mToken}` } : undefined;

    return fetchAllQueryResources<MeetingRegistrant>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRegistrant>>(
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        { ...params, ...(pageToken && { page_token: pageToken }) },
        undefined,
        headers
      )
    );
  }

  /**
   * Creates a new meeting registrant
   */
  public async addMeetingRegistrant(req: Request, registrantData: CreateMeetingRegistrantRequest): Promise<MeetingRegistrant> {
    const sanitizedPayload = logger.sanitize({ registrantData });
    logger.debug(req, 'add_meeting_registrant', 'Creating meeting registrant', sanitizedPayload);

    const newRegistrant = await this.microserviceProxy.proxyRequest<MeetingRegistrant>(
      req,
      'LFX_V2_SERVICE',
      `/itx/meetings/${registrantData.meeting_id}/registrants`,
      'POST',
      undefined,
      registrantData
    );

    return newRegistrant;
  }

  /**
   * Updates an existing meeting registrant directly via microservice proxy
   */
  public async updateMeetingRegistrant(
    req: Request,
    meetingUid: string,
    registrantUid: string,
    updateData: UpdateMeetingRegistrantRequest
  ): Promise<MeetingRegistrant> {
    const sanitizedPayload = logger.sanitize({ updateData });
    logger.debug(req, 'update_meeting_registrant', 'Updating meeting registrant payload', sanitizedPayload);

    const updatedRegistrant = await this.microserviceProxy.proxyRequest<MeetingRegistrant>(
      req,
      'LFX_V2_SERVICE',
      `/itx/meetings/${meetingUid}/registrants/${registrantUid}`,
      'PUT',
      undefined,
      updateData
    );

    return updatedRegistrant;
  }

  /**
   * Deletes a meeting registrant directly via microservice proxy
   */
  public async deleteMeetingRegistrant(req: Request, meetingUid: string, registrantUid: string): Promise<void> {
    logger.debug(req, 'delete_meeting_registrant', 'Deleting registrant', {
      meeting_id: meetingUid,
      registrant_uid: registrantUid,
    });

    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/itx/meetings/${meetingUid}/registrants/${registrantUid}`, 'DELETE');
  }

  /**
   * Resend a meeting invitation to a specific registrant
   */
  public async resendMeetingInvitation(req: Request, meetingUid: string, registrantId: string): Promise<void> {
    logger.debug(req, 'resend_meeting_invitation', 'Resending meeting invitation to registrant', {
      meeting_id: meetingUid,
      registrant_id: registrantId,
    });

    // Call the LFX API endpoint for resending invitation
    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/itx/meetings/${meetingUid}/registrants/${registrantId}/resend`, 'POST');
  }

  /**
   * Fetches meeting join URL by meeting UID
   */
  public async getMeetingJoinUrl(req: Request, meetingUid: string, email?: string): Promise<MeetingJoinURL> {
    logger.debug(req, 'get_meeting_link', 'Fetching meeting join URL', {
      meeting_id: meetingUid,
    });

    const params = {
      email: email,
    };

    const response = await this.microserviceProxy.proxyRequest<{ join_url: string; link: string }>(
      req,
      'LFX_V2_SERVICE',
      `/itx/meetings/${meetingUid}/join_link`,
      'GET',
      params
    );

    return { link: response.join_url || response.link };
  }

  /**
   * Fetches past meeting participants by past meeting UID
   */
  public async getPastMeetingParticipants(req: Request, pastMeetingUid: string): Promise<PastMeetingParticipant[]> {
    logger.debug(req, 'get_past_meeting_participants', 'Fetching past meeting participants', {
      past_meeting_id: pastMeetingUid,
    });

    const params = {
      type: 'v1_past_meeting_participant',
      tags: `meeting_and_occurrence_id:${pastMeetingUid}`,
    };

    return fetchAllQueryResources<PastMeetingParticipant>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeetingParticipant>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        ...params,
        ...(pageToken && { page_token: pageToken }),
      })
    );
  }

  /**
   * Checks if a user was a participant in a past meeting by email or username.
   * Uses `filters` (AND on meeting id) + `filters_or` (OR across email/username) to resolve the
   * match in a single query. `tags_all` can't be used here because `username` is not synthesized
   * into the participant record's indexed tags — username-only matches silently failed before.
   */
  public async isUserPastMeetingParticipant(req: Request, pastMeetingUid: string, email: string, username?: string): Promise<boolean> {
    logger.debug(req, 'is_user_past_meeting_participant', 'Checking if user was a past meeting participant', {
      past_meeting_id: pastMeetingUid,
      email,
      username,
    });

    const filtersOr: string[] = [];
    if (email) filtersOr.push(`email:${email.toLowerCase()}`);
    if (username) filtersOr.push(`username:${stripAuthPrefix(username)}`);

    if (filtersOr.length === 0) {
      return false;
    }

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeetingParticipant>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      {
        type: 'v1_past_meeting_participant',
        filters: [`meeting_and_occurrence_id:${pastMeetingUid}`],
        filters_or: filtersOr,
      }
    );

    const matched = resources.length > 0;

    logger.debug(req, 'is_user_past_meeting_participant', 'Participant check complete', {
      past_meeting_id: pastMeetingUid,
      matched,
    });

    return matched;
  }

  /**
   * Fetches past meeting recording by past meeting UID
   */
  public async getPastMeetingRecording(req: Request, pastMeetingUid: string): Promise<PastMeetingRecording | null> {
    logger.debug(req, 'get_past_meeting_recording', 'Fetching past meeting recording', {
      past_meeting_id: pastMeetingUid,
    });

    try {
      const params = {
        type: 'v1_past_meeting_recording',
        tags: `meeting_and_occurrence_id:${pastMeetingUid}`,
      };

      const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeetingRecording>>(
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        params
      );

      if (!resources || resources.length === 0) {
        logger.warning(req, 'get_past_meeting_recording', 'No recording found for past meeting', {
          past_meeting_id: pastMeetingUid,
          type: params.type,
        });
        return null;
      }

      return resources[0].data;
    } catch (error) {
      logger.warning(req, 'get_past_meeting_recording', 'Failed to fetch past meeting recording, returning null', {
        past_meeting_id: pastMeetingUid,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Fetches past meeting summary by past meeting UID
   */
  public async getPastMeetingSummary(req: Request, pastMeetingUid: string): Promise<PastMeetingSummary | null> {
    logger.debug(req, 'get_past_meeting_summary', 'Fetching past meeting summary', {
      past_meeting_id: pastMeetingUid,
    });

    try {
      const params = {
        type: 'v1_past_meeting_summary',
        tags: `meeting_and_occurrence_id:${pastMeetingUid}`,
      };

      const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeetingSummary>>(
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        params
      );

      if (!resources || resources.length === 0) {
        logger.warning(req, 'get_past_meeting_summary', 'No summary found for past meeting', {
          past_meeting_id: pastMeetingUid,
          type: params.type,
        });
        return null;
      }

      // Always transform from V1 summary format to V2
      const summary = transformV1SummaryToV2(resources[0].data);

      return summary;
    } catch (error) {
      logger.warning(req, 'get_past_meeting_summary', 'Failed to fetch past meeting summary, returning null', {
        past_meeting_id: pastMeetingUid,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Updates past meeting summary edited content directly via microservice proxy
   */
  public async updatePastMeetingSummary(
    req: Request,
    pastMeetingUid: string,
    summaryUid: string,
    updateData: UpdatePastMeetingSummaryRequest
  ): Promise<PastMeetingSummary> {
    logger.debug(req, 'update_past_meeting_summary', 'Updating past meeting summary', {
      past_meeting_id: pastMeetingUid,
      summary_uid: summaryUid,
    });

    const sanitizedPayload = logger.sanitize({ updateData });
    logger.debug(req, 'update_past_meeting_summary', 'Updating past meeting summary payload', sanitizedPayload);

    const updatedSummary = await this.microserviceProxy.proxyRequest<PastMeetingSummary>(
      req,
      'LFX_V2_SERVICE',
      `/itx/past_meetings/${pastMeetingUid}/summaries/${summaryUid}`,
      'PUT',
      undefined,
      updateData
    );

    return updatedSummary;
  }

  /**
   * Create or update a meeting RSVP via the ITX responses endpoint
   */
  public async createMeetingRsvp(req: Request, meetingUid: string, rsvpData: CreateMeetingRsvpRequest): Promise<MeetingRsvp> {
    logger.debug(req, 'create_meeting_rsvp', 'Creating meeting RSVP', {
      meeting_id: meetingUid,
      response: rsvpData.response,
      scope: rsvpData.scope,
    });

    // Resolve registrant_id — single query matches email OR username against this meeting.
    const email = getEffectiveEmail(req) ?? undefined;
    const username = (await getUsernameFromAuth(req)) ?? undefined;
    const registrants = await this.getMeetingRegistrantsForUser(req, meetingUid, email, username);

    if (registrants.length === 0) {
      throw new ResourceNotFoundError('Registrant', email || username || 'unknown', {
        operation: 'create_meeting_rsvp',
      });
    }

    const registrantId = registrants[0].uid;

    // occurrence_id goes in the request body — the upstream meeting-service concatenates it with
    // meeting_id internally when calling the Zoom ITX API (see the OpenAPI description for
    // SubmitItxMeetingResponseRequestBody.occurrence_id in lfx-v2-meeting-service).
    const requestData: ITXCreateMeetingResponseRequest = {
      response: rsvpData.response,
      scope: rsvpData.scope,
      registrant_id: registrantId,
      ...(rsvpData.occurrence_id ? { occurrence_id: rsvpData.occurrence_id } : {}),
    };

    const result = await this.microserviceProxy.proxyRequest<ITXMeetingResponseResult>(
      req,
      'LFX_V2_SERVICE',
      `/itx/meetings/${meetingUid}/responses`,
      'POST',
      {},
      requestData
    );

    const rsvp = mapITXResponseToMeetingRsvp(result);

    // Poll query service until the RSVP is propagated so the UI can fetch it immediately
    await pollEndpoint({
      req,
      operation: 'create_meeting_rsvp_poll',
      pollFn: async () => {
        const allRsvps = await this.getMeetingRsvps(req, meetingUid);
        return allRsvps.some((r) => r.id === rsvp.id && r.response_type === rsvp.response_type);
      },
      maxRetries: 5,
      retryDelayMs: 1000,
      metadata: { meeting_id: meetingUid, rsvp_id: rsvp.id },
    });

    return rsvp;
  }

  /**
   * Get current user's RSVP via the query service
   * @param req Express request object
   * @param meetingUid Meeting UID to get RSVP for
   * @param occurrenceId Optional occurrence ID to filter RSVP for specific occurrence
   * @returns Promise resolving to user's RSVP or null
   */
  public async getMeetingRsvpForCurrentUser(req: Request, meetingUid: string, occurrenceId?: string): Promise<MeetingRsvp | null> {
    logger.debug(req, 'get_meeting_rsvp_for_current_user', 'Fetching user RSVP', {
      meeting_id: meetingUid,
      occurrence_id: occurrenceId,
    });

    try {
      // Match by email first (always populated on RSVP records); fall back to username for safety.
      const normalizedEmail = getEffectiveEmail(req)?.toLowerCase() ?? null;
      const username = await getUsernameFromAuth(req);

      if (!normalizedEmail && !username) {
        logger.warning(req, 'get_meeting_rsvp_for_current_user', 'No email or username in auth context, returning null', {
          meeting_id: meetingUid,
        });
        return null;
      }

      // Fetch all RSVPs for this meeting via query service
      const allRsvps = await this.getMeetingRsvps(req, meetingUid);

      // Filter RSVPs for current user — RSVP records carry email reliably; username is often absent.
      const userRsvps = allRsvps.filter((rsvp) => {
        if (normalizedEmail && rsvp.email?.toLowerCase() === normalizedEmail) return true;
        if (username && rsvp.username && usernameMatches(username, rsvp.username)) return true;
        return false;
      });

      if (occurrenceId) {
        // First try to find an occurrence-specific RSVP (takes precedence)
        const occurrenceRsvp = userRsvps.find((rsvp) => rsvp.occurrence_id === occurrenceId);
        if (occurrenceRsvp) {
          return occurrenceRsvp;
        }

        // Fall back to meeting-level RSVP (no occurrence_id means RSVP for all occurrences)
        const meetingRsvp = userRsvps.find((rsvp) => !rsvp.occurrence_id);
        return meetingRsvp || null;
      }

      // No occurrence specified - return any RSVP for this user
      return userRsvps[0] || null;
    } catch (error) {
      logger.warning(req, 'get_meeting_rsvp_for_current_user', 'Failed to fetch user RSVP, returning null', {
        meeting_id: meetingUid,
        occurrence_id: occurrenceId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Get all RSVPs for a meeting, filtered to current registrants only.
   * The v1_meeting_rsvp records persist historical RSVPs including for registrants
   * who have since been removed or re-registered with a new registrant_id. We filter
   * to only those RSVPs whose registrant_id matches a currently-active registrant.
   */
  public async getMeetingRsvps(req: Request, meetingUid: string): Promise<MeetingRsvp[]> {
    logger.debug(req, 'get_meeting_rsvps', 'Fetching meeting RSVPs', { meeting_id: meetingUid });

    try {
      const rsvpParams = {
        tags: `meeting_id:${meetingUid}`,
        type: 'v1_meeting_rsvp',
      };

      const registrantParams = {
        type: 'v1_meeting_registrant',
        parent: `meeting:${meetingUid}`,
      };

      let registrantsFetchFailed = false;
      const [rsvps, registrants] = await Promise.all([
        fetchAllQueryResources<MeetingRsvp>(req, (pageToken) =>
          this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRsvp>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
            ...rsvpParams,
            ...(pageToken && { page_token: pageToken }),
          })
        ),
        fetchAllQueryResources<MeetingRegistrant>(
          req,
          (pageToken) =>
            this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRegistrant>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
              ...registrantParams,
              ...(pageToken && { page_token: pageToken }),
            }),
          { failOnPartial: true }
        ).catch((error) => {
          registrantsFetchFailed = true;
          logger.warning(req, 'get_meeting_rsvps', 'Failed to fetch complete registrants for RSVP filtering, returning unfiltered RSVPs', {
            meeting_id: meetingUid,
            err: error,
          });
          return [] as MeetingRegistrant[];
        }),
      ]);

      // If the registrant fetch failed, return unfiltered RSVPs rather than hiding data.
      if (registrantsFetchFailed) {
        return rsvps;
      }

      const activeRegistrantIds = new Set(registrants.map((r) => r.uid).filter(Boolean));
      const filtered = rsvps.filter((rsvp) => activeRegistrantIds.has(rsvp.registrant_id));

      logger.debug(req, 'get_meeting_rsvps', 'Filtered RSVPs to active registrants', {
        meeting_id: meetingUid,
        raw_rsvp_count: rsvps.length,
        active_registrant_count: activeRegistrantIds.size,
        filtered_rsvp_count: filtered.length,
      });

      return filtered;
    } catch (error) {
      logger.warning(req, 'get_meeting_rsvps', 'Failed to fetch meeting RSVPs, returning empty array', {
        meeting_id: meetingUid,
        err: error,
      });
      return [];
    }
  }

  /**
   * Gets all meeting attachments via Query Service
   */
  public async getMeetingAttachments(req: Request, meetingUid: string): Promise<MeetingAttachment[]> {
    const params = {
      type: 'v1_meeting_attachment',
      parent: `meeting:${meetingUid}`,
    };

    logger.debug(req, 'get_meeting_attachments', 'Fetching meeting attachments', { meeting_id: meetingUid, query_params: params });

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingAttachment>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      params
    );

    return resources.map((resource) => resource.data);
  }

  /**
   * Creates a new meeting attachment (link or file record) via ITX proxy
   */
  public async createMeetingAttachment(req: Request, meetingUid: string, attachmentData: CreateMeetingAttachmentRequest): Promise<MeetingAttachment> {
    logger.debug(req, 'create_meeting_attachment', 'Creating meeting attachment', { meeting_id: meetingUid, type: attachmentData.type });

    return this.microserviceProxy.proxyRequest<MeetingAttachment>(
      req,
      'LFX_V2_SERVICE',
      `/itx/meetings/${meetingUid}/attachments`,
      'POST',
      undefined,
      attachmentData
    );
  }

  /**
   * Updates an existing meeting attachment via ITX proxy
   * Returns 204 No Content on success
   */
  public async updateMeetingAttachment(req: Request, meetingUid: string, attachmentUid: string, updateData: UpdateMeetingAttachmentRequest): Promise<void> {
    logger.debug(req, 'update_meeting_attachment', 'Updating meeting attachment', { meeting_id: meetingUid, attachment_uid: attachmentUid });

    await this.microserviceProxy.proxyRequest<void>(
      req,
      'LFX_V2_SERVICE',
      `/itx/meetings/${meetingUid}/attachments/${attachmentUid}`,
      'PUT',
      undefined,
      updateData
    );
  }

  /**
   * Deletes a meeting attachment via ITX proxy
   */
  public async deleteMeetingAttachment(req: Request, meetingUid: string, attachmentUid: string): Promise<void> {
    logger.debug(req, 'delete_meeting_attachment', 'Deleting meeting attachment', { meeting_id: meetingUid, attachment_uid: attachmentUid });

    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/itx/meetings/${meetingUid}/attachments/${attachmentUid}`, 'DELETE');
  }

  /**
   * Gets metadata for a single meeting attachment via ITX proxy
   */
  public async getMeetingAttachmentInfo(req: Request, meetingUid: string, attachmentUid: string): Promise<MeetingAttachment> {
    logger.debug(req, 'get_meeting_attachment_info', 'Fetching meeting attachment info', { meeting_id: meetingUid, attachment_uid: attachmentUid });

    return this.microserviceProxy.proxyRequest<MeetingAttachment>(req, 'LFX_V2_SERVICE', `/itx/meetings/${meetingUid}/attachments/${attachmentUid}`, 'GET');
  }

  /**
   * Generates a presigned upload URL for a meeting file attachment
   */
  public async presignMeetingAttachment(req: Request, meetingUid: string, presignData: PresignAttachmentRequest): Promise<PresignAttachmentResponse> {
    logger.debug(req, 'presign_meeting_attachment', 'Generating presigned upload URL', { meeting_id: meetingUid, file_name: presignData.name });

    return this.microserviceProxy.proxyRequest<PresignAttachmentResponse>(
      req,
      'LFX_V2_SERVICE',
      `/itx/meetings/${meetingUid}/attachments/presign`,
      'POST',
      undefined,
      presignData
    );
  }

  /**
   * Presigns a meeting file attachment then uploads the binary directly to S3.
   * Consolidates the two-step presign+upload flow into a single server-side call,
   * avoiding browser CORS restrictions on S3.
   */
  public async uploadMeetingAttachment(
    req: Request,
    meetingUid: string,
    fileBuffer: Buffer,
    presignData: PresignAttachmentRequest
  ): Promise<PresignAttachmentResponse> {
    logger.debug(req, 'upload_meeting_attachment', 'Presigning attachment', { meeting_id: meetingUid, file_name: presignData.name });

    const presignResponse = await this.presignMeetingAttachment(req, meetingUid, presignData);

    logger.debug(req, 'upload_meeting_attachment', 'Uploading file to S3', {
      meeting_id: meetingUid,
      attachment_uid: presignResponse.uid,
      file_size: presignData.file_size,
    });

    const s3Response = await fetch(presignResponse.file_url, {
      method: 'PUT',
      body: new Uint8Array(fileBuffer),
      headers: {
        'Content-Type': presignData.file_type,
        'Content-Length': String(presignData.file_size),
      },
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });

    if (!s3Response.ok) {
      const errorText = await s3Response.text().catch(() => '');
      throw new Error(`S3 upload failed with status ${s3Response.status}: ${errorText}`);
    }

    logger.info(req, 'upload_meeting_attachment', 'File uploaded to S3 successfully', {
      meeting_id: meetingUid,
      attachment_uid: presignResponse.uid,
      file_name: presignData.name,
    });

    return presignResponse;
  }

  /**
   * Gets a presigned download URL for a meeting attachment
   */
  public async getMeetingAttachmentDownloadUrl(req: Request, meetingUid: string, attachmentUid: string): Promise<AttachmentDownloadUrlResponse> {
    logger.debug(req, 'get_meeting_attachment_download_url', 'Getting download URL', { meeting_id: meetingUid, attachment_uid: attachmentUid });

    return this.microserviceProxy.proxyRequest<AttachmentDownloadUrlResponse>(
      req,
      'LFX_V2_SERVICE',
      `/itx/meetings/${meetingUid}/attachments/${attachmentUid}/download`,
      'GET'
    );
  }

  /**
   * Gets all past meeting attachments via Query Service
   */
  public async getPastMeetingAttachments(req: Request, pastMeetingUid: string): Promise<PastMeetingAttachment[]> {
    const params = {
      type: 'v1_past_meeting_attachment',
      tags: `meeting_and_occurrence_id:${pastMeetingUid}`,
    };

    logger.debug(req, 'get_past_meeting_attachments', 'Fetching past meeting attachments', { past_meeting_id: pastMeetingUid });

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeetingAttachment>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      params
    );

    return resources.map((resource) => resource.data);
  }

  /**
   * Gets a single past meeting attachment by UID via ITX proxy
   */
  public async getPastMeetingAttachmentInfo(req: Request, pastMeetingUid: string, attachmentUid: string): Promise<PastMeetingAttachment> {
    logger.debug(req, 'get_past_meeting_attachment_info', 'Fetching past meeting attachment info', {
      past_meeting_id: pastMeetingUid,
      attachment_uid: attachmentUid,
    });

    return this.microserviceProxy.proxyRequest<PastMeetingAttachment>(
      req,
      'LFX_V2_SERVICE',
      `/itx/past_meetings/${pastMeetingUid}/attachments/${attachmentUid}`,
      'GET'
    );
  }

  /**
   * Gets a presigned download URL for a past meeting attachment
   */
  public async getPastMeetingAttachmentDownloadUrl(req: Request, pastMeetingUid: string, attachmentUid: string): Promise<AttachmentDownloadUrlResponse> {
    logger.debug(req, 'get_past_meeting_attachment_download_url', 'Getting download URL', { past_meeting_id: pastMeetingUid, attachment_uid: attachmentUid });

    return this.microserviceProxy.proxyRequest<AttachmentDownloadUrlResponse>(
      req,
      'LFX_V2_SERVICE',
      `/itx/past_meetings/${pastMeetingUid}/attachments/${attachmentUid}/download`,
      'GET'
    );
  }

  /**
   * Creates a new meeting registrant using M2M token (for public endpoints)
   * @param req - Express request object
   * @param registrantData - Registrant data to create
   * @param m2mToken - M2M token for authentication
   * @returns The created meeting registrant
   */
  public async addMeetingRegistrantWithM2M(req: Request, registrantData: CreateMeetingRegistrantRequest, m2mToken: string): Promise<MeetingRegistrant> {
    const startTime = logger.startOperation(req, 'add_meeting_registrant_with_m2m', { meeting_id: registrantData.meeting_id });

    const sanitizedPayload = logger.sanitize({ registrantData });
    logger.debug(req, 'add_meeting_registrant_with_m2m', 'Creating meeting registrant with M2M token', sanitizedPayload);

    const newRegistrant = await this.microserviceProxy.proxyRequest<MeetingRegistrant>(
      req,
      'LFX_V2_SERVICE',
      `/itx/meetings/${registrantData.meeting_id}/registrants`,
      'POST',
      undefined,
      registrantData,
      { Authorization: `Bearer ${m2mToken}`, ['X-Sync']: 'true' }
    );

    logger.success(req, 'add_meeting_registrant_with_m2m', startTime, {
      meeting_id: registrantData.meeting_id,
      registrant_uid: newRegistrant.uid,
      host: registrantData.host || false,
    });

    return newRegistrant;
  }

  public async getMeetingProjectName<T extends Meeting>(req: Request, meetings: T[]): Promise<T[]> {
    return this.projectService.enrichWithProjectData(req, meetings) as Promise<T[]>;
  }

  /**
   * Fetches committee names for all unique committees referenced in meetings.
   * Returns a Map of committee UID -> committee name for merging into meeting data.
   */
  private async getCommitteeNameMap(req: Request, meetings: Meeting[]): Promise<Map<string, string>> {
    const uniqueCommitteeUids = [
      ...new Set(
        meetings
          .filter((m) => m.committees && m.committees.length > 0)
          .flatMap((m) => m.committees)
          .map((c: { uid: string }) => c.uid)
      ),
    ];

    const meetingsWithCommittees = meetings.filter((m) => m.committees && m.committees.length > 0).length;
    logger.info(req, 'enrich_committees', 'Enriching meetings with committee data', {
      total_meetings: meetings.length,
      meetings_with_committees: meetingsWithCommittees,
      unique_committees: uniqueCommitteeUids.length,
    });

    const results = await Promise.all(
      uniqueCommitteeUids.map(async (uid) => {
        try {
          const committee = await this.committeeService.getCommitteeById(req, uid);
          return { uid, name: committee.name };
        } catch (error) {
          logger.warning(req, 'get_meeting_committees', 'Committee enrichment failed; continuing without name', { committee_uid: uid, err: error });
          return { uid, name: undefined };
        }
      })
    );

    const nameMap = new Map<string, string>();
    for (const { uid, name } of results) {
      if (name) {
        nameMap.set(uid, name);
      }
    }

    return nameMap;
  }

  /**
   * Ensures a recurrence object always has an end condition.
   * The upstream meeting service requires either end_date_time or end_times.
   * Defaults to 100 years from now when neither is specified.
   */
  private normalizeRecurrence(recurrence: MeetingRecurrence): MeetingRecurrence {
    if (recurrence.end_date_time || recurrence.end_times) {
      return recurrence;
    }
    const hundredYearsFromNow = new Date();
    hundredYearsFromNow.setFullYear(hundredYearsFromNow.getFullYear() + 100);
    return { ...recurrence, end_date_time: hundredYearsFromNow.toISOString() };
  }
}
