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
import { isUuid } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { Logger } from '../helpers/logger';
import { getUsernameFromAuth } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';
import { AccessCheckService } from './access-check.service';
import { CommitteeService } from './committee.service';
import { ETagService } from './etag.service';
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
    const params = {
      ...query,
      type: meetingType,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Meeting>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    // TODO(v1-migration): Remove V1 version determination once all meetings are migrated to V2
    // Determine meeting version based on type
    const isV1 = meetingType === 'v1_meeting' || meetingType === 'v1_past_meeting';
    const version: 'v1' | 'v2' = isV1 ? 'v1' : 'v2';

    let meetings: Meeting[] = resources.map((resource) => ({
      ...resource.data,
      version,
    }));

    // Get project name for each meeting
    meetings = await this.getMeetingProjectName(req, meetings);

    // Get committee data for each committee associated with the meeting
    if (meetings.some((m) => m.committees && m.committees.length > 0)) {
      meetings = await this.getMeetingCommittees(req, meetings);
    }

    if (access) {
      // Add writer access field to all meetings
      return await this.accessCheckService.addAccessToResources(req, meetings, meetingType, 'organizer');
    }

    return meetings;
  }

  /**
   * Fetches the count of meetings based on query parameters
   */
  public async getMeetingsCount(req: Request, query: Record<string, any> = {}, meetingType: string = 'meeting'): Promise<number> {
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
      // Remove join_url, passcode, host_key, user_id from V1 meetings
      delete meeting.host_key;
      delete meeting.user_id;

      // Set version to v1 for legacy meetings
      meeting.version = 'v1';
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
      const meetingWithCommittees = await this.getMeetingCommittees(req, [meeting]);
      meeting = meetingWithCommittees[0];
    }

    if (access) {
      // Add writer access field to the meeting
      return await this.accessCheckService.addAccessToResource(req, meeting, 'meeting', 'organizer');
    }

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

    const sanitizedPayload = Logger.sanitize({ createPayload });
    req.log.debug(sanitizedPayload, 'Creating meeting payload');

    const newMeeting = await this.microserviceProxy.proxyRequest<Meeting>(req, 'LFX_V2_SERVICE', '/meetings', 'POST', undefined, createPayload, {
      ['X-Sync']: 'true',
    });

    req.log.info(
      {
        operation: 'create_meeting',
        meeting_id: newMeeting.uid,
        project_uid: newMeeting.project_uid,
        title: newMeeting.title,
        organizer: username || 'none',
      },
      'Meeting created successfully'
    );

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

    const sanitizedPayload = Logger.sanitize({ updatePayload, editType });
    req.log.debug(sanitizedPayload, 'Updating meeting payload');

    // Step 2: Update meeting with ETag, including editType query parameter if provided
    let path = `/meetings/${meetingUid}`;
    if (editType) {
      path += `?editType=${editType}`;
    }

    const updatedMeeting = await this.etagService.updateWithETag<Meeting>(req, 'LFX_V2_SERVICE', path, etag, updatePayload, 'update_meeting');

    req.log.info(
      {
        operation: 'update_meeting',
        meeting_uid: meetingUid,
        project_uid: updatedMeeting.project_uid,
        title: updatedMeeting.title,
        edit_type: editType || 'single',
        organizer: username || 'none',
      },
      'Meeting updated successfully'
    );

    return updatedMeeting;
  }

  /**
   * Deletes a meeting using ETag for concurrency control
   */
  public async deleteMeeting(req: Request, meetingUid: string): Promise<void> {
    // Step 1: Fetch meeting with ETag
    const { etag } = await this.etagService.fetchWithETag<Meeting>(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}`, 'delete_meeting');

    // Step 2: Delete meeting with ETag
    await this.etagService.deleteWithETag(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}`, etag, 'delete_meeting');

    req.log.info(
      {
        operation: 'delete_meeting',
        meeting_uid: meetingUid,
      },
      'Meeting deleted successfully'
    );
  }

  /**
   * Cancels a meeting occurrence using ETag for concurrency control
   */
  public async cancelOccurrence(req: Request, meetingUid: string, occurrenceId: string): Promise<void> {
    // Step 1: Fetch meeting with ETag
    const { etag } = await this.etagService.fetchWithETag<Meeting>(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}`, 'cancel_occurrence');

    // Step 2: Cancel occurrence with ETag
    await this.etagService.deleteWithETag(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}/occurrences/${occurrenceId}`, etag, 'cancel_occurrence');

    req.log.info(
      {
        operation: 'cancel_occurrence',
        meeting_uid: meetingUid,
        occurrence_id: occurrenceId,
      },
      'Meeting occurrence canceled successfully'
    );
  }

  /**
   * Fetches all registrants for a meeting
   * @param includeRsvp - If true, includes RSVP status for each registrant
   */
  public async getMeetingRegistrants(req: Request, meetingUid: string, includeRsvp: boolean = false): Promise<MeetingRegistrant[]> {
    try {
      const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRegistrant>>(
        req,
        'LFX_V2_SERVICE',
        `/query/resources`,
        'GET',
        {
          type: 'meeting_registrant',
          tags: `meeting_uid:${meetingUid}`,
        }
      );

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

          req.log.info(
            {
              operation: 'get_meeting_registrants',
              meeting_uid: meetingUid,
              registrant_count: registrants.length,
              rsvp_count: rsvps.length,
              include_rsvp: true,
            },
            'Meeting registrants with RSVPs fetched successfully'
          );
        } catch (error) {
          req.log.warn(
            {
              operation: 'get_meeting_registrants',
              meeting_uid: meetingUid,
              err: error,
            },
            'Failed to fetch RSVPs for registrants, returning registrants without RSVP data'
          );
        }
      } else {
        req.log.info(
          {
            operation: 'get_meeting_registrants',
            meeting_uid: meetingUid,
            registrant_count: registrants.length,
          },
          'Meeting registrants fetched successfully'
        );
      }

      return registrants;
    } catch (error) {
      req.log.error(
        {
          operation: 'get_meeting_registrants',
          meeting_uid: meetingUid,
          err: error,
        },
        'Failed to fetch meeting registrants'
      );
      throw error;
    }
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
    req.log.info(
      {
        operation: 'get_meeting_registrants_by_email',
        meeting_uid: meetingUid,
        email: email,
      },
      'Fetching meeting registrants by email'
    );

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

    req.log.info(
      {
        operation: 'get_meeting_registrants_by_email',
        meeting_uid: meetingUid,
        email: email,
        v1,
      },
      'Fetching meeting registrants by email params'
    );

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
    try {
      const sanitizedPayload = Logger.sanitize({ registrantData });
      req.log.debug(sanitizedPayload, 'Creating meeting registrant');

      const newRegistrant = await this.microserviceProxy.proxyRequest<MeetingRegistrant>(
        req,
        'LFX_V2_SERVICE',
        `/meetings/${registrantData.meeting_uid}/registrants`,
        'POST',
        undefined,
        registrantData
      );

      req.log.info(
        {
          operation: 'add_meeting_registrant',
          meeting_uid: registrantData.meeting_uid,
          registrant_uid: newRegistrant.uid,
          host: registrantData.host || false,
        },
        'Meeting registrant created successfully'
      );

      return newRegistrant;
    } catch (error) {
      req.log.error(
        {
          operation: 'add_meeting_registrant',
          meeting_uid: registrantData.meeting_uid,
          err: error,
        },
        'Failed to create meeting registrant'
      );
      throw error;
    }
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
    try {
      // Step 1: Fetch registrant with ETag
      const { etag } = await this.etagService.fetchWithETag<MeetingRegistrant>(
        req,
        'LFX_V2_SERVICE',
        `/meetings/${meetingUid}/registrants/${registrantUid}`,
        'update_meeting_registrant'
      );

      const sanitizedPayload = Logger.sanitize({ updateData });
      req.log.debug(sanitizedPayload, 'Updating meeting registrant payload');

      // Step 2: Update registrant with ETag
      const updatedRegistrant = await this.etagService.updateWithETag<MeetingRegistrant>(
        req,
        'LFX_V2_SERVICE',
        `/meetings/${meetingUid}/registrants/${registrantUid}`,
        etag,
        updateData,
        'update_meeting_registrant'
      );

      req.log.info(
        {
          operation: 'update_meeting_registrant',
          meeting_uid: meetingUid,
          registrant_uid: registrantUid,
        },
        'Meeting registrant updated successfully'
      );

      return updatedRegistrant;
    } catch (error) {
      req.log.error(
        {
          operation: 'update_meeting_registrant',
          meeting_uid: meetingUid,
          registrant_uid: registrantUid,
          err: error,
        },
        'Failed to update meeting registrant'
      );
      throw error;
    }
  }

  /**
   * Deletes a meeting registrant using ETag for concurrency control
   */
  public async deleteMeetingRegistrant(req: Request, meetingUid: string, registrantUid: string): Promise<void> {
    try {
      // Step 1: Fetch registrant with ETag
      const { etag } = await this.etagService.fetchWithETag<MeetingRegistrant>(
        req,
        'LFX_V2_SERVICE',
        `/meetings/${meetingUid}/registrants/${registrantUid}`,
        'delete_meeting_registrant'
      );

      // Step 2: Delete registrant with ETag
      await this.etagService.deleteWithETag(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}/registrants/${registrantUid}`, etag, 'delete_meeting_registrant');

      req.log.info(
        {
          operation: 'delete_meeting_registrant',
          meeting_uid: meetingUid,
          registrant_uid: registrantUid,
        },
        'Meeting registrant deleted successfully'
      );
    } catch (error) {
      req.log.error(
        {
          operation: 'delete_meeting_registrant',
          meeting_uid: meetingUid,
          registrant_uid: registrantUid,
          err: error,
        },
        'Failed to delete meeting registrant'
      );
      throw error;
    }
  }

  /**
   * Resend a meeting invitation to a specific registrant
   */
  public async resendMeetingInvitation(req: Request, meetingUid: string, registrantId: string): Promise<void> {
    try {
      // Call the LFX API endpoint for resending invitation
      await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}/registrants/${registrantId}/resend`, 'POST');

      req.log.info(
        {
          operation: 'resend_meeting_invitation',
          meeting_uid: meetingUid,
          registrant_id: registrantId,
        },
        'Meeting invitation resent successfully'
      );
    } catch (error) {
      req.log.error(
        {
          operation: 'resend_meeting_invitation',
          meeting_uid: meetingUid,
          registrant_id: registrantId,
          err: error,
        },
        'Failed to resend meeting invitation'
      );
      throw error;
    }
  }

  /**
   * Fetches meeting join URL by meeting UID
   */
  public async getMeetingJoinUrl(req: Request, meetingUid: string): Promise<MeetingJoinURL> {
    return await this.microserviceProxy.proxyRequest<MeetingJoinURL>(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}/join_url`, 'GET');
  }

  /**
   * Fetches past meeting participants by past meeting UID
   */
  public async getPastMeetingParticipants(req: Request, pastMeetingUid: string): Promise<PastMeetingParticipant[]> {
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

    const participants = resources.map((resource) => resource.data);

    req.log.info(
      {
        operation: 'get_past_meeting_participants',
        past_meeting_uid: pastMeetingUid,
        participant_count: participants.length,
      },
      'Past meeting participants retrieved successfully'
    );

    return participants;
  }

  /**
   * Fetches past meeting recording by past meeting UID
   * @param v1 - If true, use v1_past_meeting_recording type and id tag format for legacy meetings
   */
  // TODO(v1-migration): Remove V1 recording type parameter and handling once all meetings are migrated to V2
  public async getPastMeetingRecording(req: Request, pastMeetingUid: string, v1: boolean = false): Promise<PastMeetingRecording | null> {
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
        req.log.info(
          {
            operation: 'get_past_meeting_recording',
            past_meeting_uid: pastMeetingUid,
            v1,
            type: params.type,
          },
          'No recording found for past meeting'
        );
        return null;
      }

      const recording = resources[0].data;

      req.log.info(
        {
          operation: 'get_past_meeting_recording',
          past_meeting_uid: pastMeetingUid,
          v1,
          recording_uid: recording.uid,
          recording_count: recording.recording_count,
          session_count: recording.sessions?.length || 0,
        },
        'Past meeting recording retrieved successfully'
      );

      return recording;
    } catch (error) {
      req.log.error(
        {
          operation: 'get_past_meeting_recording',
          past_meeting_uid: pastMeetingUid,
          v1,
          err: error,
        },
        'Failed to retrieve past meeting recording'
      );
      return null;
    }
  }

  /**
   * Fetches past meeting summary by past meeting UID
   * @param v1 - If true, use v1_past_meeting_summary type for legacy meetings
   */
  // TODO(v1-migration): Remove V1 summary type parameter and handling once all meetings are migrated to V2
  public async getPastMeetingSummary(req: Request, pastMeetingUid: string, v1: boolean = false): Promise<PastMeetingSummary | null> {
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
        req.log.info(
          {
            operation: 'get_past_meeting_summary',
            past_meeting_uid: pastMeetingUid,
            v1,
            type: params.type,
          },
          'No summary found for past meeting'
        );
        return null;
      }

      const summary = resources[0].data;

      req.log.info(
        {
          operation: 'get_past_meeting_summary',
          past_meeting_uid: pastMeetingUid,
          v1,
          summary_uid: summary.uid,
          approved: summary.approved,
          requires_approval: summary.requires_approval,
        },
        'Past meeting summary retrieved successfully'
      );

      return summary;
    } catch (error) {
      req.log.error(
        {
          operation: 'get_past_meeting_summary',
          past_meeting_uid: pastMeetingUid,
          v1,
          err: error,
        },
        'Failed to retrieve past meeting summary'
      );
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
    try {
      // Step 1: Fetch summary with ETag
      const { etag } = await this.etagService.fetchWithETag<PastMeetingSummary>(
        req,
        'LFX_V2_SERVICE',
        `/past_meetings/${pastMeetingUid}/summaries/${summaryUid}`,
        'update_past_meeting_summary'
      );

      const sanitizedPayload = Logger.sanitize({ updateData });
      req.log.debug(sanitizedPayload, 'Updating past meeting summary payload');

      // Step 2: Update summary with ETag
      const updatedSummary = await this.etagService.updateWithETag<PastMeetingSummary>(
        req,
        'LFX_V2_SERVICE',
        `/past_meetings/${pastMeetingUid}/summaries/${summaryUid}`,
        etag,
        updateData,
        'update_past_meeting_summary'
      );

      req.log.info(
        {
          operation: 'update_past_meeting_summary',
          past_meeting_uid: pastMeetingUid,
          summary_uid: summaryUid,
          has_edited_content: !!updateData.edited_content,
          has_approved: updateData.approved !== undefined,
        },
        'Past meeting summary updated successfully'
      );

      return updatedSummary;
    } catch (error) {
      req.log.error(
        {
          operation: 'update_past_meeting_summary',
          past_meeting_uid: pastMeetingUid,
          summary_uid: summaryUid,
          err: error,
        },
        'Failed to update past meeting summary'
      );
      throw error;
    }
  }

  /**
   * Create or update a meeting RSVP
   */
  public async createMeetingRsvp(req: Request, meetingUid: string, rsvpData: CreateMeetingRsvpRequest): Promise<MeetingRsvp> {
    // Backend derives user from bearer token, so we don't need to pass username/email/registrant_id
    const requestData: CreateMeetingRsvpRequest = {
      response: rsvpData.response,
      scope: rsvpData.scope,
      occurrence_id: rsvpData.occurrence_id,
      email: rsvpData.email,
      username: rsvpData.username,
    };

    const rsvp = await this.microserviceProxy.proxyRequest<MeetingRsvp>(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}/rsvp`, 'POST', {}, requestData);

    req.log.info(
      {
        operation: 'create_meeting_rsvp',
        meeting_uid: meetingUid,
        rsvp_id: rsvp.id,
        response: rsvpData.response,
        scope: rsvpData.scope,
        occurrence_id: rsvpData.occurrence_id || undefined,
      },
      'Meeting RSVP created successfully'
    );

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
    try {
      // Get username from authenticated user
      const username = await getUsernameFromAuth(req);

      if (!username) {
        req.log.error(
          {
            operation: 'get_meeting_rsvp_by_username',
            meeting_uid: meetingUid,
            error: 'No username found in auth context',
          },
          'Failed to get meeting RSVP by username'
        );
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

      req.log.info(
        {
          operation: 'get_meeting_rsvp_by_username',
          meeting_uid: meetingUid,
          occurrence_id: occurrenceId,
          found: !!userRsvp,
          total_rsvps: allRsvps.length,
          rsvp_id: userRsvp?.id,
        },
        'User meeting RSVP retrieved via M2M token'
      );

      return userRsvp || null;
    } catch (error) {
      req.log.error(
        {
          operation: 'get_meeting_rsvp_by_username',
          meeting_uid: meetingUid,
          occurrence_id: occurrenceId,
          err: error,
        },
        'Failed to get meeting RSVP by username'
      );
      return null;
    }
  }

  /**
   * Get all RSVPs for a meeting
   */
  public async getMeetingRsvps(req: Request, meetingUid: string): Promise<MeetingRsvp[]> {
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

      req.log.info(
        {
          operation: 'get_meeting_rsvps',
          meeting_uid: meetingUid,
          count: resources.length,
        },
        'Meeting RSVPs retrieved successfully'
      );

      return resources.map((resource) => resource.data);
    } catch (error) {
      req.log.error(
        {
          operation: 'get_meeting_rsvps',
          meeting_uid: meetingUid,
          err: error,
        },
        'Failed to get meeting RSVPs'
      );
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
    req.log.debug(
      {
        operation: 'create_meeting_attachment',
        meeting_uid: meetingUid,
      },
      'Creating meeting attachment'
    );

    try {
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

      req.log.info(
        {
          operation: 'create_meeting_attachment',
          attachment_uid: attachment.uid,
          meeting_uid: meetingUid,
        },
        'Meeting attachment created successfully'
      );

      return attachment;
    } catch (error) {
      req.log.error(
        {
          operation: 'create_meeting_attachment',
          meeting_uid: meetingUid,
          err: error,
        },
        'Failed to create meeting attachment'
      );
      throw error;
    }
  }

  /**
   * Gets a meeting attachment (downloads file) via LFX V2 API
   * @param req - Express request object
   * @param meetingUid - Meeting UID that the attachment belongs to
   * @param attachmentUid - Attachment UID to get
   * @returns The attachment file data
   */
  public async getMeetingAttachment(req: Request, meetingUid: string, attachmentUid: string): Promise<Buffer> {
    req.log.debug(
      {
        operation: 'get_meeting_attachment',
        meeting_uid: meetingUid,
        attachment_uid: attachmentUid,
      },
      'Fetching meeting attachment'
    );

    try {
      // Use the microservice proxy to download the binary file
      const buffer = await this.microserviceProxy.proxyBinaryRequest(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}/attachments/${attachmentUid}`, 'GET');

      req.log.info(
        {
          operation: 'get_meeting_attachment',
          meeting_uid: meetingUid,
          attachment_uid: attachmentUid,
          file_size: buffer.length,
        },
        'Meeting attachment fetched successfully'
      );

      return buffer;
    } catch (error) {
      req.log.error(
        {
          operation: 'get_meeting_attachment',
          meeting_uid: meetingUid,
          attachment_uid: attachmentUid,
          err: error,
        },
        'Failed to fetch meeting attachment'
      );
      throw error;
    }
  }

  /**
   * Deletes a meeting attachment via LFX V2 API
   * @param req - Express request object
   * @param meetingUid - Meeting UID that the attachment belongs to
   * @param attachmentUid - Attachment UID to delete
   */
  public async deleteMeetingAttachment(req: Request, meetingUid: string, attachmentUid: string): Promise<void> {
    req.log.debug(
      {
        operation: 'delete_meeting_attachment',
        meeting_uid: meetingUid,
        attachment_uid: attachmentUid,
      },
      'Deleting meeting attachment'
    );

    try {
      // Call the LFX V2 API endpoint to delete the attachment
      await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}/attachments/${attachmentUid}`, 'DELETE');

      req.log.info(
        {
          operation: 'delete_meeting_attachment',
          meeting_uid: meetingUid,
          attachment_uid: attachmentUid,
        },
        'Meeting attachment deleted successfully'
      );
    } catch (error) {
      req.log.error(
        {
          operation: 'delete_meeting_attachment',
          meeting_uid: meetingUid,
          attachment_uid: attachmentUid,
          err: error,
        },
        'Failed to delete meeting attachment'
      );
      throw error;
    }
  }

  public async getMeetingAttachmentMetadata(req: Request, meetingUid: string, attachmentUid: string): Promise<any> {
    req.log.debug(
      {
        operation: 'get_meeting_attachment_metadata',
        meeting_uid: meetingUid,
        attachment_uid: attachmentUid,
      },
      'Fetching meeting attachment metadata'
    );

    try {
      const metadata = await this.microserviceProxy.proxyRequest<any>(
        req,
        'LFX_V2_SERVICE',
        `/meetings/${meetingUid}/attachments/${attachmentUid}/metadata`,
        'GET'
      );

      req.log.info(
        {
          operation: 'get_meeting_attachment_metadata',
          meeting_uid: meetingUid,
          attachment_uid: attachmentUid,
        },
        'Meeting attachment metadata fetched successfully'
      );

      return metadata;
    } catch (error) {
      req.log.error(
        {
          operation: 'get_meeting_attachment_metadata',
          meeting_uid: meetingUid,
          attachment_uid: attachmentUid,
          err: error,
        },
        'Failed to fetch meeting attachment metadata'
      );
      throw error;
    }
  }

  /**
   * Gets all meeting attachments via Query Service
   * @param req - Express request object
   * @param meetingUid - Meeting UID to get attachments for
   * @returns Array of meeting attachments
   */
  public async getMeetingAttachments(req: Request, meetingUid: string): Promise<any[]> {
    req.log.debug(
      {
        operation: 'get_meeting_attachments',
        meeting_uid: meetingUid,
      },
      'Fetching meeting attachments'
    );

    try {
      const params = {
        type: 'meeting_attachment',
        tags: `meeting_uid:${meetingUid}`,
      };

      req.log.debug(
        {
          meeting_uid: meetingUid,
          query_params: params,
        },
        'Fetching attachments with query params'
      );

      const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<any>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

      const attachments = resources.map((resource) => resource.data);

      req.log.info(
        {
          operation: 'get_meeting_attachments',
          meeting_uid: meetingUid,
          attachment_count: attachments.length,
        },
        'Meeting attachments retrieved successfully'
      );

      return attachments;
    } catch (error) {
      req.log.error(
        {
          operation: 'get_meeting_attachments',
          meeting_uid: meetingUid,
          err: error,
        },
        'Failed to get meeting attachments'
      );
      throw error;
    }
  }

  /**
   * Gets all past meeting attachments via Query Service
   * @param req - Express request object
   * @param pastMeetingUid - Past meeting UID to get attachments for
   * @returns Array of past meeting attachments
   */
  public async getPastMeetingAttachments(req: Request, pastMeetingUid: string): Promise<any[]> {
    req.log.debug(
      {
        operation: 'get_past_meeting_attachments',
        past_meeting_uid: pastMeetingUid,
      },
      'Fetching past meeting attachments'
    );

    try {
      const params = {
        type: 'past_meeting_attachment',
        tags: `past_meeting_uid:${pastMeetingUid}`,
      };

      req.log.debug(
        {
          past_meeting_uid: pastMeetingUid,
          query_params: params,
        },
        'Fetching past meeting attachments with query params'
      );

      const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<any>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

      const attachments = resources.map((resource) => resource.data);

      req.log.info(
        {
          operation: 'get_past_meeting_attachments',
          past_meeting_uid: pastMeetingUid,
          attachment_count: attachments.length,
        },
        'Past meeting attachments retrieved successfully'
      );

      return attachments;
    } catch (error) {
      req.log.error(
        {
          operation: 'get_past_meeting_attachments',
          past_meeting_uid: pastMeetingUid,
          err: error,
        },
        'Failed to get past meeting attachments'
      );
      throw error;
    }
  }

  /**
   * Creates a new meeting registrant using M2M token (for public endpoints)
   * @param req - Express request object
   * @param registrantData - Registrant data to create
   * @param m2mToken - M2M token for authentication
   * @returns The created meeting registrant
   */
  public async addMeetingRegistrantWithM2M(req: Request, registrantData: CreateMeetingRegistrantRequest, m2mToken: string): Promise<MeetingRegistrant> {
    try {
      const sanitizedPayload = Logger.sanitize({ registrantData });
      req.log.debug(sanitizedPayload, 'Creating meeting registrant with M2M token');

      const newRegistrant = await this.microserviceProxy.proxyRequest<MeetingRegistrant>(
        req,
        'LFX_V2_SERVICE',
        `/meetings/${registrantData.meeting_uid}/registrants`,
        'POST',
        undefined,
        registrantData,
        { Authorization: `Bearer ${m2mToken}`, ['X-Sync']: 'true' }
      );

      req.log.info(
        {
          operation: 'add_meeting_registrant_with_m2m',
          meeting_uid: registrantData.meeting_uid,
          registrant_uid: newRegistrant.uid,
          host: registrantData.host || false,
        },
        'Meeting registrant created successfully with M2M token'
      );

      return newRegistrant;
    } catch (error) {
      req.log.error(
        {
          operation: 'add_meeting_registrant_with_m2m',
          meeting_uid: registrantData.meeting_uid,
          err: error,
        },
        'Failed to create meeting registrant with M2M token'
      );
      throw error;
    }
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
          req.log.warn({ operation: 'get_meeting_committees', committee_uid: uid, err: error }, 'Committee enrichment failed; continuing without name');
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
