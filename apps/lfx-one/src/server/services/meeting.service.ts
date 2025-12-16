// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { QueryServiceMeetingType } from '@lfx-one/shared/enums';
import {
  CreateMeetingRegistrantRequest,
  CreateMeetingRequest,
  CreateMeetingRsvpRequest,
  Meeting,
  MeetingJoinURL,
  MeetingRegistrant,
  MeetingRsvp,
  PastMeetingParticipant,
  PastMeetingRecording,
  PastMeetingSummary,
  QueryServiceCountResponse,
  QueryServiceResponse,
  UpdateMeetingRegistrantRequest,
  UpdateMeetingRequest,
  UpdatePastMeetingSummaryRequest,
} from '@lfx-one/shared/interfaces';
import { isUuid, transformV1MeetingToV2, transformV1SummaryToV2 } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { getUsernameFromAuth } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';
import { AccessCheckService } from './access-check.service';
import { CommitteeService } from './committee.service';
import { ETagService } from './etag.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { ProjectService } from './project.service';

/**
 * Service for handling meeting business logic with microservice proxy
 */
export class MeetingService {
  private accessCheckService: AccessCheckService;
  private etagService: ETagService;
  private microserviceProxy: MicroserviceProxyService;
  private committeeService: CommitteeService;
  private projectService: ProjectService;

  public constructor() {
    this.accessCheckService = new AccessCheckService();
    this.microserviceProxy = new MicroserviceProxyService();
    this.etagService = new ETagService();
    this.committeeService = new CommitteeService();
    this.projectService = new ProjectService();
  }

  /**
   * Fetches all meetings based on query parameters
   */
  public async getMeetings(
    req: Request,
    query: Record<string, any> = {},
    meetingType: QueryServiceMeetingType = 'meeting',
    access: boolean = true
  ): Promise<Meeting[]> {
    logger.debug(req, 'get_meetings', 'Starting meeting fetch', {
      type: meetingType,
      query_params: Object.keys(query),
    });

    const params = {
      ...query,
      type: meetingType,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Meeting>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    logger.debug(req, 'get_meetings', 'Fetched resources from query service', {
      count: resources.length,
      type: meetingType,
    });

    // TODO(v1-migration): Remove V1 version determination once all meetings are migrated to V2
    // Determine meeting version based on type
    const isV1 = meetingType === 'v1_meeting' || meetingType === 'v1_past_meeting';
    const version: 'v1' | 'v2' = isV1 ? 'v1' : 'v2';

    let meetings: Meeting[] = resources.map((resource) => ({
      ...resource.data,
      version,
    }));

    // Transform V1 meetings to V2 format on the server side
    if (isV1) {
      logger.info(req, 'transform_v1_meetings', 'Transforming V1 meetings to V2 format', {
        count: meetings.length,
        type: meetingType,
      });
      meetings = meetings.map(transformV1MeetingToV2);
    }

    // Get project name for each meeting
    logger.debug(req, 'get_meetings', 'Enriching meetings with project names', {
      count: meetings.length,
    });
    meetings = await this.getMeetingProjectName(req, meetings);

    // Get committee data for each committee associated with the meeting
    if (meetings.some((m) => m.committees && m.committees.length > 0)) {
      const meetingsWithCommittees = meetings.filter((m) => m.committees && m.committees.length > 0).length;
      logger.info(req, 'enrich_committees', 'Enriching meetings with committee data', {
        total_meetings: meetings.length,
        meetings_with_committees: meetingsWithCommittees,
      });
      meetings = await this.getMeetingCommittees(req, meetings);
    }

    if (access) {
      logger.debug(req, 'get_meetings', 'Adding access control information', {
        count: meetings.length,
      });
      // Add writer access field to all meetings
      return await this.accessCheckService.addAccessToResources(req, meetings, meetingType, 'organizer');
    }

    logger.debug(req, 'get_meetings', 'Completed meeting fetch', {
      final_count: meetings.length,
    });

    return meetings;
  }

  /**
   * Fetches the count of meetings based on query parameters
   */
  public async getMeetingsCount(req: Request, query: Record<string, any> = {}, meetingType: string = 'meeting'): Promise<number> {
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
  public async getMeetingById(req: Request, meetingUid: string, meetingType: QueryServiceMeetingType = 'meeting', access: boolean = true): Promise<Meeting> {
    logger.debug(req, 'get_meeting_by_id', 'Fetching meeting by ID', {
      meeting_uid: meetingUid,
      type: meetingType,
    });

    // TODO(v1-migration): Remove V1 meeting handling branch once all meetings are migrated to V2
    let meeting;
    if (meetingType === 'v1_meeting') {
      const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Meeting>>(req, 'LFX_V2_SERVICE', `/query/resources`, 'GET', {
        type: 'v1_meeting',
        tags: `${meetingUid}`,
      });

      if (!resources || resources.length === 0) {
        throw new ResourceNotFoundError('Meeting', meetingUid, {
          operation: 'get_meeting_by_id',
          service: 'meeting_service',
          path: `/meetings/${meetingUid}`,
        });
      }

      meeting = resources[0].data;

      // Set version to v1 for legacy meetings
      meeting.version = 'v1';

      // Transform V1 meeting to V2 format
      logger.info(req, 'transform_v1_meeting', 'Transforming V1 meeting to V2 format', {
        meeting_uid: meetingUid,
      });
      meeting = transformV1MeetingToV2(meeting);
    } else {
      meeting = await this.microserviceProxy.proxyRequest<Meeting>(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}`, 'GET');
    }

    if (!meeting || (!meeting.uid && !meeting.id)) {
      throw new ResourceNotFoundError('Meeting', meetingUid, {
        operation: 'get_meeting_by_id',
        service: 'meeting_service',
        path: `/meetings/${meetingUid}`,
      });
    }

    if (meeting.committees && meeting.committees.length > 0) {
      logger.debug(req, 'get_meeting_by_id', 'Enriching meeting with committee data', {
        meeting_uid: meetingUid,
        committee_count: meeting.committees.length,
      });
      const meetingWithCommittees = await this.getMeetingCommittees(req, [meeting]);
      meeting = meetingWithCommittees[0];
    }

    if (access) {
      logger.debug(req, 'get_meeting_by_id', 'Adding access control information', {
        meeting_uid: meetingUid,
      });
      // Add writer access field to the meeting
      return await this.accessCheckService.addAccessToResource(req, meeting, 'meeting', 'organizer');
    }

    logger.debug(req, 'get_meeting_by_id', 'Completed meeting fetch', {
      meeting_uid: meetingUid,
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
    };

    const sanitizedPayload = logger.sanitize({ createPayload });
    logger.debug(req, 'create_meeting', 'Creating meeting payload', sanitizedPayload);

    const newMeeting = await this.microserviceProxy.proxyRequest<Meeting>(req, 'LFX_V2_SERVICE', '/meetings', 'POST', undefined, createPayload, {
      ['X-Sync']: 'true',
    });

    return newMeeting;
  }

  /**
   * Updates a meeting using ETag for concurrency control
   */
  public async updateMeeting(req: Request, meetingUid: string, meetingData: UpdateMeetingRequest, editType?: 'single' | 'future'): Promise<Meeting> {
    // Step 1: Fetch meeting with ETag
    const { etag, data } = await this.etagService.fetchWithETag<Meeting>(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}`, 'update_meeting');

    // Get the logged-in user's username to maintain organizer if not provided
    const username = await getUsernameFromAuth(req);

    // Create organizers array ensuring no duplicates or null values
    const existingOrganizers = data.organizers || [];
    const organizersSet = new Set(existingOrganizers.filter((organizer) => organizer != null));

    // Add current user as organizer if username exists and not already included
    if (username) {
      organizersSet.add(username);
    }

    // Include organizers in the update payload
    const updatePayload = {
      ...meetingData,
      organizers: Array.from(organizersSet),
    };

    const sanitizedPayload = logger.sanitize({ updatePayload, editType });
    logger.debug(req, 'update_meeting', 'Updating meeting payload', sanitizedPayload);

    // Step 2: Update meeting with ETag, including editType query parameter if provided
    let path = `/meetings/${meetingUid}`;
    if (editType) {
      path += `?editType=${editType}`;
    }

    const updatedMeeting = await this.etagService.updateWithETag<Meeting>(req, 'LFX_V2_SERVICE', path, etag, updatePayload, 'update_meeting');

    return updatedMeeting;
  }

  /**
   * Deletes a meeting using ETag for concurrency control
   */
  public async deleteMeeting(req: Request, meetingUid: string): Promise<void> {
    logger.debug(req, 'delete_meeting', 'Deleting meeting with ETag', {
      meeting_uid: meetingUid,
    });

    // Step 1: Fetch meeting with ETag
    const { etag } = await this.etagService.fetchWithETag<Meeting>(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}`, 'delete_meeting');

    logger.debug(req, 'delete_meeting', 'Fetched ETag for deletion', {
      meeting_uid: meetingUid,
    });

    // Step 2: Delete meeting with ETag
    await this.etagService.deleteWithETag(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}`, etag, 'delete_meeting');
  }

  /**
   * Cancels a meeting occurrence using ETag for concurrency control
   */
  public async cancelOccurrence(req: Request, meetingUid: string, occurrenceId: string): Promise<void> {
    logger.debug(req, 'cancel_occurrence', 'Canceling meeting occurrence', {
      meeting_uid: meetingUid,
      occurrence_id: occurrenceId,
    });

    // Step 1: Fetch meeting with ETag
    const { etag } = await this.etagService.fetchWithETag<Meeting>(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}`, 'cancel_occurrence');

    // Step 2: Cancel occurrence with ETag
    await this.etagService.deleteWithETag(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}/occurrences/${occurrenceId}`, etag, 'cancel_occurrence');
  }

  /**
   * Fetches all registrants for a meeting
   * @param includeRsvp - If true, includes RSVP status for each registrant
   */
  public async getMeetingRegistrants(req: Request, meetingUid: string, includeRsvp: boolean = false): Promise<MeetingRegistrant[]> {
    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRegistrant>>(req, 'LFX_V2_SERVICE', `/query/resources`, 'GET', {
      type: 'meeting_registrant',
      tags: `meeting_uid:${meetingUid}`,
    });

    let registrants = resources.map((resource) => resource.data);

    // If include_rsvp is true, fetch RSVP data and attach to registrants
    if (includeRsvp) {
      try {
        const rsvps = await this.getMeetingRsvps(req, meetingUid);

        // Create a map of username to RSVP for quick lookup
        const rsvpMap = new Map(rsvps.map((rsvp) => [rsvp.username, rsvp]));

        // Attach RSVP data to each registrant
        registrants = registrants.map((registrant) => ({
          ...registrant,
          rsvp: registrant.username ? rsvpMap.get(registrant.username) || null : null,
        }));
      } catch (error) {
        logger.warning(req, 'get_meeting_registrants', 'Failed to fetch RSVPs for registrants, returning registrants without RSVP data', {
          meeting_uid: meetingUid,
          err: error,
        });
      }
    }

    return registrants;
  }

  /**
   * Fetches all registrants for a meeting by email
   */
  public async getMeetingRegistrantsByEmail(
    req: Request,
    meetingUid: string,
    email: string,
    m2mToken?: string
  ): Promise<QueryServiceResponse<MeetingRegistrant[]>> {
    // TODO(v1-migration): Remove V1 registrant type detection once all meetings are migrated to V2
    const v1 = !isUuid(meetingUid);

    const params = {
      type: 'meeting_registrant',
      parent: `meeting:${meetingUid}`,
      tags_all: [`email:${email}`],
    };

    if (v1) {
      params.type = 'v1_meeting_registrant';
      params.tags_all.push(`meeting_uid:${meetingUid}`);
      params.parent = '';
    }

    logger.debug(req, 'get_meeting_registrants_by_email', 'Fetching meeting registrants by email params', { meeting_uid: meetingUid, email, v1, params });

    const headers = m2mToken ? { Authorization: `Bearer ${m2mToken}` } : undefined;

    const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRegistrant[]>>(
      req,
      'LFX_V2_SERVICE',
      `/query/resources`,
      'GET',
      params,
      undefined,
      headers
    );

    return response;
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
      `/meetings/${registrantData.meeting_uid}/registrants`,
      'POST',
      undefined,
      registrantData
    );

    return newRegistrant;
  }

  /**
   * Updates an existing meeting registrant using ETag for concurrency control
   */
  public async updateMeetingRegistrant(
    req: Request,
    meetingUid: string,
    registrantUid: string,
    updateData: UpdateMeetingRegistrantRequest
  ): Promise<MeetingRegistrant> {
    // Step 1: Fetch registrant with ETag
    const { etag } = await this.etagService.fetchWithETag<MeetingRegistrant>(
      req,
      'LFX_V2_SERVICE',
      `/meetings/${meetingUid}/registrants/${registrantUid}`,
      'update_meeting_registrant'
    );

    const sanitizedPayload = logger.sanitize({ updateData });
    logger.debug(req, 'update_meeting_registrant', 'Updating meeting registrant payload', sanitizedPayload);

    // Step 2: Update registrant with ETag
    const updatedRegistrant = await this.etagService.updateWithETag<MeetingRegistrant>(
      req,
      'LFX_V2_SERVICE',
      `/meetings/${meetingUid}/registrants/${registrantUid}`,
      etag,
      updateData,
      'update_meeting_registrant'
    );

    return updatedRegistrant;
  }

  /**
   * Deletes a meeting registrant using ETag for concurrency control
   */
  public async deleteMeetingRegistrant(req: Request, meetingUid: string, registrantUid: string): Promise<void> {
    logger.debug(req, 'delete_meeting_registrant', 'Deleting registrant with ETag', {
      meeting_uid: meetingUid,
      registrant_uid: registrantUid,
    });

    // Step 1: Fetch registrant with ETag
    const { etag } = await this.etagService.fetchWithETag<MeetingRegistrant>(
      req,
      'LFX_V2_SERVICE',
      `/meetings/${meetingUid}/registrants/${registrantUid}`,
      'delete_meeting_registrant'
    );

    logger.debug(req, 'delete_meeting_registrant', 'Fetched ETag for deletion', {
      meeting_uid: meetingUid,
      registrant_uid: registrantUid,
    });

    // Step 2: Delete registrant with ETag
    await this.etagService.deleteWithETag(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}/registrants/${registrantUid}`, etag, 'delete_meeting_registrant');
  }

  /**
   * Resend a meeting invitation to a specific registrant
   */
  public async resendMeetingInvitation(req: Request, meetingUid: string, registrantId: string): Promise<void> {
    logger.debug(req, 'resend_meeting_invitation', 'Resending meeting invitation to registrant', {
      meeting_uid: meetingUid,
      registrant_id: registrantId,
    });

    // Call the LFX API endpoint for resending invitation
    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}/registrants/${registrantId}/resend`, 'POST');
  }

  /**
   * Fetches meeting join URL by meeting UID
   */
  public async getMeetingJoinUrl(req: Request, meetingUid: string): Promise<MeetingJoinURL> {
    logger.debug(req, 'get_meeting_join_url', 'Fetching meeting join URL', {
      meeting_uid: meetingUid,
    });

    return await this.microserviceProxy.proxyRequest<MeetingJoinURL>(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}/join_url`, 'GET');
  }

  /**
   * Fetches past meeting participants by past meeting UID
   */
  public async getPastMeetingParticipants(req: Request, pastMeetingUid: string): Promise<PastMeetingParticipant[]> {
    logger.debug(req, 'get_past_meeting_participants', 'Fetching past meeting participants', {
      past_meeting_uid: pastMeetingUid,
    });

    const params = {
      type: 'past_meeting_participant',
      tags: `past_meeting_uid:${pastMeetingUid}`,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeetingParticipant>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      params
    );

    return resources.map((resource) => resource.data);
  }

  /**
   * Fetches past meeting recording by past meeting UID
   * @param v1 - If true, use v1_past_meeting_recording type and id tag format for legacy meetings
   */
  public async getPastMeetingRecording(req: Request, pastMeetingUid: string, v1: boolean = false): Promise<PastMeetingRecording | null> {
    logger.debug(req, 'get_past_meeting_recording', 'Fetching past meeting recording', {
      past_meeting_uid: pastMeetingUid,
      v1,
    });

    try {
      // V1 legacy meetings use different type and tag format
      const params = {
        type: v1 ? 'v1_past_meeting_recording' : 'past_meeting_recording',
        tags: v1 ? pastMeetingUid : `past_meeting_uid:${pastMeetingUid}`,
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
          past_meeting_uid: pastMeetingUid,
          v1,
          type: params.type,
        });
        return null;
      }

      return resources[0].data;
    } catch (error) {
      logger.warning(req, 'get_past_meeting_recording', 'Failed to fetch past meeting recording, returning null', {
        past_meeting_uid: pastMeetingUid,
        v1,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Fetches past meeting summary by past meeting UID
   * @param v1 - If true, use v1_past_meeting_summary type for legacy meetings
   */
  public async getPastMeetingSummary(req: Request, pastMeetingUid: string, v1: boolean = false): Promise<PastMeetingSummary | null> {
    logger.debug(req, 'get_past_meeting_summary', 'Fetching past meeting summary', {
      past_meeting_uid: pastMeetingUid,
      v1,
    });

    try {
      // V1 legacy meetings use different type and tag format
      const params = {
        type: v1 ? 'v1_past_meeting_summary' : 'past_meeting_summary',
        tags: `past_meeting_uid:${pastMeetingUid}`,
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
          past_meeting_uid: pastMeetingUid,
          v1,
          type: params.type,
        });
        return null;
      }

      let summary = resources[0].data;

      // Transform V1 summary to V2 format
      if (v1) {
        summary = transformV1SummaryToV2(summary);
      }

      return summary;
    } catch (error) {
      logger.warning(req, 'get_past_meeting_summary', 'Failed to fetch past meeting summary, returning null', {
        past_meeting_uid: pastMeetingUid,
        v1,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Updates past meeting summary edited content using ETag for concurrency control
   */
  public async updatePastMeetingSummary(
    req: Request,
    pastMeetingUid: string,
    summaryUid: string,
    updateData: UpdatePastMeetingSummaryRequest
  ): Promise<PastMeetingSummary> {
    logger.debug(req, 'update_past_meeting_summary', 'Updating past meeting summary', {
      past_meeting_uid: pastMeetingUid,
      summary_uid: summaryUid,
    });

    // Step 1: Fetch summary with ETag
    const { etag } = await this.etagService.fetchWithETag<PastMeetingSummary>(
      req,
      'LFX_V2_SERVICE',
      `/past_meetings/${pastMeetingUid}/summaries/${summaryUid}`,
      'update_past_meeting_summary'
    );

    const sanitizedPayload = logger.sanitize({ updateData });
    logger.debug(req, 'update_past_meeting_summary', 'Updating past meeting summary payload', sanitizedPayload);

    // Step 2: Update summary with ETag
    const updatedSummary = await this.etagService.updateWithETag<PastMeetingSummary>(
      req,
      'LFX_V2_SERVICE',
      `/past_meetings/${pastMeetingUid}/summaries/${summaryUid}`,
      etag,
      updateData,
      'update_past_meeting_summary'
    );

    return updatedSummary;
  }

  /**
   * Create or update a meeting RSVP
   */
  public async createMeetingRsvp(req: Request, meetingUid: string, rsvpData: CreateMeetingRsvpRequest): Promise<MeetingRsvp> {
    logger.debug(req, 'create_meeting_rsvp', 'Creating meeting RSVP', {
      meeting_uid: meetingUid,
      response: rsvpData.response,
      scope: rsvpData.scope,
    });

    // Backend derives user from bearer token, so we don't need to pass username/email/registrant_id
    const requestData: CreateMeetingRsvpRequest = {
      response: rsvpData.response,
      scope: rsvpData.scope,
      occurrence_id: rsvpData.occurrence_id,
      email: rsvpData.email,
      username: rsvpData.username,
    };

    const rsvp = await this.microserviceProxy.proxyRequest<MeetingRsvp>(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}/rsvp`, 'POST', {}, requestData);

    return rsvp;
  }

  /**
   * Get current user's RSVP by calling meeting service directly with M2M token
   * @param req Express request object
   * @param meetingUid Meeting UID to get RSVP for
   * @param occurrenceId Optional occurrence ID to filter RSVP for specific occurrence
   * @returns Promise resolving to user's RSVP or null
   */
  public async getMeetingRsvpByUsername(req: Request, meetingUid: string, occurrenceId?: string): Promise<MeetingRsvp | null> {
    logger.debug(req, 'get_meeting_rsvp_by_username', 'Fetching user RSVP', {
      meeting_uid: meetingUid,
      occurrence_id: occurrenceId,
    });

    try {
      // Get username from authenticated user
      const username = await getUsernameFromAuth(req);

      if (!username) {
        logger.warning(req, 'get_meeting_rsvp_by_username', 'No username found in auth context, returning null', {
          meeting_uid: meetingUid,
        });
        return null;
      }

      // Generate M2M token and set it on the request
      const m2mToken = await generateM2MToken(req);

      // Call meeting service directly to get all RSVPs for this meeting
      const response = await this.microserviceProxy.proxyRequest<{ rsvps: MeetingRsvp[] }>(
        req,
        'LFX_V2_SERVICE',
        `/meetings/${meetingUid}/rsvp`,
        'GET',
        undefined,
        undefined,
        {
          Authorization: `Bearer ${m2mToken}`,
        }
      );

      // Handle response - it might be wrapped in { data: [] } or be a direct array
      const allRsvps = response.rsvps ?? [];

      // Filter for current user's RSVP (optionally by occurrence)
      const userRsvp = allRsvps.find((rsvp) => rsvp.username === username && (!occurrenceId || rsvp.occurrence_id === occurrenceId));

      return userRsvp || null;
    } catch (error) {
      logger.warning(req, 'get_meeting_rsvp_by_username', 'Failed to fetch user RSVP, returning null', {
        meeting_uid: meetingUid,
        occurrence_id: occurrenceId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Get all RSVPs for a meeting
   */
  public async getMeetingRsvps(req: Request, meetingUid: string): Promise<MeetingRsvp[]> {
    logger.debug(req, 'get_meeting_rsvps', 'Fetching meeting RSVPs', { meeting_uid: meetingUid });

    try {
      const params = {
        tags: `meeting_uid:${meetingUid}`,
        type: 'meeting_rsvp',
      };

      const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRsvp>>(
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        params
      );

      return resources.map((resource) => resource.data);
    } catch (error) {
      logger.warning(req, 'get_meeting_rsvps', 'Failed to fetch meeting RSVPs, returning empty array', {
        meeting_uid: meetingUid,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Creates a new meeting attachment via LFX V2 API
   * @param req - Express request object
   * @param meetingUid - Meeting UID to attach file to
   * @param attachmentData - Form data including type, name, and file/url
   * @returns The created meeting attachment
   */
  public async createMeetingAttachment(req: Request, meetingUid: string, attachmentData: any): Promise<any> {
    logger.debug(req, 'create_meeting_attachment', 'Creating meeting attachment', { meeting_uid: meetingUid });

    // Call the LFX V2 API endpoint with multipart/form-data
    // The attachmentData should be a FormData object from the controller
    // The API client will automatically handle FormData and set the correct Content-Type with boundary
    const attachment = await this.microserviceProxy.proxyRequest<any>(
      req,
      'LFX_V2_SERVICE',
      `/meetings/${meetingUid}/attachments`,
      'POST',
      undefined,
      attachmentData
    );

    return attachment;
  }

  /**
   * Gets a meeting attachment (downloads file) via LFX V2 API
   * @param req - Express request object
   * @param meetingUid - Meeting UID that the attachment belongs to
   * @param attachmentUid - Attachment UID to get
   * @returns The attachment file data
   */
  public async getMeetingAttachment(req: Request, meetingUid: string, attachmentUid: string): Promise<Buffer> {
    logger.debug(req, 'get_meeting_attachment', 'Fetching meeting attachment', { meeting_uid: meetingUid, attachment_uid: attachmentUid });

    // Use the microservice proxy to download the binary file
    const buffer = await this.microserviceProxy.proxyBinaryRequest(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}/attachments/${attachmentUid}`, 'GET');

    return buffer;
  }

  /**
   * Deletes a meeting attachment via LFX V2 API
   * @param req - Express request object
   * @param meetingUid - Meeting UID that the attachment belongs to
   * @param attachmentUid - Attachment UID to delete
   */
  public async deleteMeetingAttachment(req: Request, meetingUid: string, attachmentUid: string): Promise<void> {
    logger.debug(req, 'delete_meeting_attachment', 'Deleting meeting attachment', { meeting_uid: meetingUid, attachment_uid: attachmentUid });

    // Call the LFX V2 API endpoint to delete the attachment
    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}/attachments/${attachmentUid}`, 'DELETE');
  }

  public async getMeetingAttachmentMetadata(req: Request, meetingUid: string, attachmentUid: string): Promise<any> {
    logger.debug(req, 'get_meeting_attachment_metadata', 'Fetching meeting attachment metadata', { meeting_uid: meetingUid, attachment_uid: attachmentUid });

    const metadata = await this.microserviceProxy.proxyRequest<any>(
      req,
      'LFX_V2_SERVICE',
      `/meetings/${meetingUid}/attachments/${attachmentUid}/metadata`,
      'GET'
    );

    return metadata;
  }

  /**
   * Gets all meeting attachments via Query Service
   * @param req - Express request object
   * @param meetingUid - Meeting UID to get attachments for
   * @returns Array of meeting attachments
   */
  public async getMeetingAttachments(req: Request, meetingUid: string): Promise<any[]> {
    const params = {
      type: 'meeting_attachment',
      tags: `meeting_uid:${meetingUid}`,
    };

    logger.debug(req, 'get_meeting_attachments', 'Fetching meeting attachments', { meeting_uid: meetingUid, query_params: params });

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<any>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    const attachments = resources.map((resource) => resource.data);

    return attachments;
  }

  /**
   * Gets all past meeting attachments via Query Service
   * @param req - Express request object
   * @param pastMeetingUid - Past meeting UID to get attachments for
   * @returns Array of past meeting attachments
   */
  public async getPastMeetingAttachments(req: Request, pastMeetingUid: string): Promise<any[]> {
    const params = {
      type: 'past_meeting_attachment',
      tags: `past_meeting_uid:${pastMeetingUid}`,
    };

    logger.debug(req, 'get_past_meeting_attachments', 'Fetching past meeting attachments', { past_meeting_uid: pastMeetingUid, query_params: params });

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<any>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    const attachments = resources.map((resource) => resource.data);

    return attachments;
  }

  /**
   * Creates a new meeting registrant using M2M token (for public endpoints)
   * @param req - Express request object
   * @param registrantData - Registrant data to create
   * @param m2mToken - M2M token for authentication
   * @returns The created meeting registrant
   */
  public async addMeetingRegistrantWithM2M(req: Request, registrantData: CreateMeetingRegistrantRequest, m2mToken: string): Promise<MeetingRegistrant> {
    const startTime = logger.startOperation(req, 'add_meeting_registrant_with_m2m', { meeting_uid: registrantData.meeting_uid });

    const sanitizedPayload = logger.sanitize({ registrantData });
    logger.debug(req, 'add_meeting_registrant_with_m2m', 'Creating meeting registrant with M2M token', sanitizedPayload);

    const newRegistrant = await this.microserviceProxy.proxyRequest<MeetingRegistrant>(
      req,
      'LFX_V2_SERVICE',
      `/meetings/${registrantData.meeting_uid}/registrants`,
      'POST',
      undefined,
      registrantData,
      { Authorization: `Bearer ${m2mToken}`, ['X-Sync']: 'true' }
    );

    logger.success(req, 'add_meeting_registrant_with_m2m', startTime, {
      meeting_uid: registrantData.meeting_uid,
      registrant_uid: newRegistrant.uid,
      host: registrantData.host || false,
    });

    return newRegistrant;
  }

  private async getMeetingCommittees(req: Request, meetings: Meeting[]): Promise<Meeting[]> {
    // Get unique committee UIDs
    const uniqueCommitteeUids = [
      ...new Set(
        meetings
          .filter((m) => m.committees && m.committees.length > 0)
          .map((m) => m.committees)
          .flat()
          .map((c: { uid: string }) => c.uid)
      ),
    ];

    // Get each committee
    const committees = await Promise.all(
      uniqueCommitteeUids.map(async (uid) => {
        try {
          const committee = await this.committeeService.getCommitteeById(req, uid);
          return { uid: committee.uid, name: committee.name };
        } catch (error) {
          logger.warning(req, 'get_meeting_committees', 'Committee enrichment failed; continuing without name', { committee_uid: uid, err: error });
          return { uid, name: undefined };
        }
      })
    );

    // Add committee data to each meeting
    meetings
      .filter((m) => m.committees && m.committees.length > 0)
      .forEach((m) => {
        m.committees = m.committees.map((c) => {
          const committee = committees.find((cc) => cc.uid === c.uid);
          return {
            uid: c.uid,
            name: committee?.name,
            allowed_voting_statuses: c.allowed_voting_statuses,
          };
        });
      });

    return meetings;
  }

  private async getMeetingProjectName(req: Request, meetings: Meeting[]): Promise<Meeting[]> {
    const projectUids = [...new Set(meetings.map((m) => m.project_uid))];
    const projects = await Promise.all(
      projectUids.map(async (uid) => {
        return await this.projectService.getProjectById(req, uid).catch(() => null);
      })
    );

    return meetings.map((m) => {
      const project = projects.find((p) => p?.uid === m.project_uid);
      return { ...m, project_name: project?.name || '', project_slug: project?.slug || '' };
    });
  }
}
