// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
  QueryServiceResponse,
  QueryServiceCountResponse,
  UpdateMeetingRegistrantRequest,
  UpdateMeetingRequest,
  UpdatePastMeetingSummaryRequest,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { Logger } from '../helpers/logger';
import { getUsernameFromAuth } from '../utils/auth-helper';
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
  public async getMeetings(req: Request, query: Record<string, any> = {}, meetingType: string = 'meeting', access: boolean = true): Promise<Meeting[]> {
    const params = {
      ...query,
      type: meetingType,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Meeting>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    let meetings = resources.map((resource) => resource.data);

    // Get project name for each meeting
    meetings = await this.getMeetingProjectName(req, meetings);

    // Get committee data for each committee associated with the meeting
    if (meetings.some((m) => m.committees && m.committees.length > 0)) {
      meetings = await this.getMeetingCommittees(req, meetings);
    }

    if (access) {
      // Add writer access field to all meetings
      return await this.accessCheckService.addAccessToResources(req, meetings, 'meeting', 'organizer');
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
  public async getMeetingById(req: Request, meetingUid: string, meetingType: string = 'meetings', access: boolean = true): Promise<Meeting> {
    let meeting = await this.microserviceProxy.proxyRequest<Meeting>(req, 'LFX_V2_SERVICE', `/${meetingType}/${meetingUid}`, 'GET');

    if (!meeting || !meeting.uid) {
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
    req.log.info(sanitizedPayload, 'Creating meeting payload');

    const newMeeting = await this.microserviceProxy.proxyRequest<Meeting>(req, 'LFX_V2_SERVICE', '/meetings', 'POST', undefined, createPayload);

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
    req.log.info(sanitizedPayload, 'Updating meeting payload');

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
              error: error instanceof Error ? error.message : error,
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
          error: error instanceof Error ? error.message : error,
        },
        'Failed to fetch meeting registrants'
      );
      throw error;
    }
  }

  /**
   * Fetches all registrants for a meeting by email
   */
  public async getMeetingRegistrantsByEmail(req: Request, meetingUid: string, email: string): Promise<QueryServiceResponse<MeetingRegistrant[]>> {
    return await this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRegistrant[]>>(req, 'LFX_V2_SERVICE', `/query/resources`, 'GET', {
      type: 'meeting_registrant',
      parent: `meeting:${meetingUid}`,
      tags: `email:${email}`,
    });
  }

  /**
   * Creates a new meeting registrant
   */
  public async addMeetingRegistrant(req: Request, registrantData: CreateMeetingRegistrantRequest): Promise<MeetingRegistrant> {
    try {
      const sanitizedPayload = Logger.sanitize({ registrantData });
      req.log.info(sanitizedPayload, 'Creating meeting registrant');

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
          error: error instanceof Error ? error.message : error,
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
      req.log.info(sanitizedPayload, 'Updating meeting registrant payload');

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
          error: error instanceof Error ? error.message : error,
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
          error: error instanceof Error ? error.message : error,
        },
        'Failed to delete meeting registrant'
      );
      throw error;
    }
  }

  /**
   * Resends a meeting invitation to a specific registrant
   */
  public async resendMeetingInvitation(req: Request, meetingUid: string, registrantId: string): Promise<void> {
    try {
      // Call the LFX API endpoint for resending invitation
      await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}/registrants/${registrantId}/resend`, 'POST');

      // Log the successful operation
      Logger.success(req, 'resend_meeting_invitation', Date.now(), {
        meeting_uid: meetingUid,
        registrant_id: registrantId,
      });
    } catch (error) {
      Logger.error(req, 'resend_meeting_invitation', Date.now(), error, {
        meeting_uid: meetingUid,
        registrant_id: registrantId,
      });
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
   */
  public async getPastMeetingRecording(req: Request, pastMeetingUid: string): Promise<PastMeetingRecording | null> {
    try {
      const params = {
        type: 'past_meeting_recording',
        tags: `past_meeting_uid:${pastMeetingUid}`,
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
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to retrieve past meeting recording'
      );
      return null;
    }
  }

  /**
   * Fetches past meeting summary by past meeting UID
   */
  public async getPastMeetingSummary(req: Request, pastMeetingUid: string): Promise<PastMeetingSummary | null> {
    try {
      const params = {
        type: 'past_meeting_summary',
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
          error: error instanceof Error ? error.message : String(error),
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
      req.log.info(sanitizedPayload, 'Updating past meeting summary payload');

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
          error: error instanceof Error ? error.message : error,
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
    Logger.start(req, 'create_meeting_rsvp', {
      meeting_uid: meetingUid,
      response: rsvpData.response,
      scope: rsvpData.scope,
    });

    // Backend derives user from bearer token, so we don't need to pass username/email/registrant_id
    const requestData: CreateMeetingRsvpRequest = {
      response: rsvpData.response,
      scope: rsvpData.scope,
    };

    const rsvp = await this.microserviceProxy.proxyRequest<MeetingRsvp>(req, 'LFX_V2_SERVICE', `/meetings/${meetingUid}/rsvp`, 'POST', {}, requestData);

    Logger.success(req, 'create_meeting_rsvp', Date.now(), {
      rsvp_id: rsvp.id,
    });

    return rsvp;
  }

  /**
   * Get user's RSVP for a meeting
   */
  public async getUserMeetingRsvp(req: Request, meetingUid: string): Promise<MeetingRsvp | null> {
    Logger.start(req, 'get_user_meeting_rsvp', {
      meeting_uid: meetingUid,
    });

    try {
      const username = await getUsernameFromAuth(req);

      if (!username) {
        Logger.success(req, 'get_user_meeting_rsvp', Date.now(), {
          found: false,
          reason: 'no_username',
        });
        return null;
      }

      const params = {
        tags: `username:${username}`,
        type: 'meeting_rsvp',
        order_by: 'updated_at',
        order_direction: 'desc',
      };

      const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRsvp>>(
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        params
      );

      // Filter by meeting_uid
      const matchingRsvps = resources.filter((r) => r.data.meeting_uid === meetingUid);

      if (matchingRsvps.length === 0) {
        Logger.success(req, 'get_user_meeting_rsvp', Date.now(), {
          found: false,
        });
        return null;
      }

      // Return the most recent RSVP for this meeting (first one due to desc sort)
      const rsvp = matchingRsvps[0].data;

      Logger.success(req, 'get_user_meeting_rsvp', Date.now(), {
        found: true,
        rsvp_id: rsvp.id,
      });

      return rsvp;
    } catch (error) {
      Logger.error(req, 'get_user_meeting_rsvp', Date.now(), error);
      return null;
    }
  }

  /**
   * Get all RSVPs for a meeting
   */
  public async getMeetingRsvps(req: Request, meetingUid: string): Promise<MeetingRsvp[]> {
    Logger.start(req, 'get_meeting_rsvps', {
      meeting_uid: meetingUid,
    });

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

      Logger.success(req, 'get_meeting_rsvps', Date.now(), {
        count: resources.length,
      });

      return resources.map((resource) => resource.data);
    } catch (error) {
      Logger.error(req, 'get_meeting_rsvps', Date.now(), error);
      return [];
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
          req.log.warn(
            { operation: 'get_meeting_committees', committee_uid: uid, error: error instanceof Error ? error.message : String(error) },
            'Committee enrichment failed; continuing without name'
          );
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

    return meetings.map((m) => ({ ...m, project_name: projects.find((p) => p?.uid === m.project_uid)?.name || '' }));
  }
}
