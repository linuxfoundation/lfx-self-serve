// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { QueryServiceMeetingType } from '@lfx-one/shared/enums';
import {
  ApiResponse,
  CreateMeetingRegistrantRequest,
  CreateMeetingRequest,
  CreateMeetingRsvpRequest,
  Meeting,
  MeetingJoinURL,
  MeetingRegistrant,
  MeetingRsvp,
  PaginatedResponse,
  PastMeetingParticipant,
  PastMeetingRecording,
  PastMeetingSummary,
  QueryServiceCountResponse,
  QueryServiceResponse,
  UpdateMeetingRegistrantRequest,
  UpdateMeetingRequest,
  UpdatePastMeetingSummaryRequest,
} from '@lfx-one/shared/interfaces';
import { transformV1SummaryToV2 } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { getUsernameFromAuth } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';
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

    const newMeeting = await this.microserviceProxy.proxyRequest<Meeting>(req, 'LFX_V2_SERVICE', '/itx/meetings', 'POST', undefined, createPayload, {
      ['X-Sync']: 'true',
    });

    // After creating, fetch the meeting with retry to handle permission propagation delay.
    // The GET may return 403 initially due to a race condition — permissions are eventually consistent.
    const meetingId = newMeeting.id;
    const maxRetries = 5;
    const retryDelayMs = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const meeting = await this.microserviceProxy.proxyRequest<Meeting>(req, 'LFX_V2_SERVICE', `/itx/meetings/${meetingId}`, 'GET');
        meeting.id = meetingId;
        logger.debug(req, 'create_meeting', 'Fetched created meeting successfully', { meeting_id: meetingId, attempt });
        return meeting;
      } catch (error: any) {
        const is403 = error?.statusCode === 403 || error?.status === 403;

        if (is403 && attempt < maxRetries) {
          logger.debug(req, 'create_meeting', 'GET returned 403, retrying after delay', {
            meeting_id: meetingId,
            attempt,
            next_retry_ms: retryDelayMs,
          });
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }

        // Non-403 error or final attempt exhausted — fall back to the POST response
        logger.warning(req, 'create_meeting', 'Failed to fetch created meeting, returning POST response', {
          meeting_id: meetingId,
          attempt,
          is_403: is403,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return newMeeting;
      }
    }

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
    const params: Record<string, any> = {
      type: 'v1_meeting_registrant',
      tags: `meeting_id:${meetingUid}`,
      page_size: 100,
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

        // Create a map of username to RSVP for quick lookup
        const rsvpMap = new Map(rsvps.map((rsvp) => [rsvp.username, rsvp]));

        // Attach RSVP data to each registrant
        registrants = registrants.map((registrant) => ({
          ...registrant,
          rsvp: registrant.username ? rsvpMap.get(registrant.username) || null : null,
        }));
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
    const params: Record<string, any> = {
      type: 'v1_meeting_registrant',
      parent: '',
      tags_all: [`email:${email}`, `meeting_id:${meetingUid}`],
      page_size: 100,
    };

    logger.debug(req, 'get_meeting_registrants_by_email', 'Fetching meeting registrants by email params', { meeting_id: meetingUid, email, params });

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
      page_size: 100,
    };

    return fetchAllQueryResources<PastMeetingParticipant>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeetingParticipant>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        ...params,
        ...(pageToken && { page_token: pageToken }),
      })
    );
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
        tags: pastMeetingUid,
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
        tags: `past_meeting_id:${pastMeetingUid}`,
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
   * Create or update a meeting RSVP
   */
  public async createMeetingRsvp(req: Request, meetingUid: string, rsvpData: CreateMeetingRsvpRequest): Promise<MeetingRsvp> {
    logger.debug(req, 'create_meeting_rsvp', 'Creating meeting RSVP', {
      meeting_id: meetingUid,
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

    const rsvp = await this.microserviceProxy.proxyRequest<MeetingRsvp>(req, 'LFX_V2_SERVICE', `/itx/meetings/${meetingUid}/rsvp`, 'POST', {}, requestData);

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
      meeting_id: meetingUid,
      occurrence_id: occurrenceId,
    });

    try {
      // Get username from authenticated user
      const username = await getUsernameFromAuth(req);

      if (!username) {
        logger.warning(req, 'get_meeting_rsvp_by_username', 'No username found in auth context, returning null', {
          meeting_id: meetingUid,
        });
        return null;
      }

      // Generate M2M token and set it on the request
      const m2mToken = await generateM2MToken(req);

      // Call meeting service directly to get all RSVPs for this meeting
      const response = await this.microserviceProxy.proxyRequest<{ rsvps: MeetingRsvp[] }>(
        req,
        'LFX_V2_SERVICE',
        `/itx/meetings/${meetingUid}/rsvp`,
        'GET',
        undefined,
        undefined,
        {
          Authorization: `Bearer ${m2mToken}`,
        }
      );

      // Handle response - it might be wrapped in { data: [] } or be a direct array
      const allRsvps = response.rsvps ?? [];

      // Filter RSVPs for current user
      const userRsvps = allRsvps.filter((rsvp) => rsvp.username === username);

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
      logger.warning(req, 'get_meeting_rsvp_by_username', 'Failed to fetch user RSVP, returning null', {
        meeting_id: meetingUid,
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
    logger.debug(req, 'get_meeting_rsvps', 'Fetching meeting RSVPs', { meeting_id: meetingUid });

    try {
      const params = {
        tags: `meeting_id:${meetingUid}`,
        type: 'v1_meeting_rsvp',
        page_size: 100,
      };

      return await fetchAllQueryResources<MeetingRsvp>(req, (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRsvp>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          ...params,
          ...(pageToken && { page_token: pageToken }),
        })
      );
    } catch (error) {
      logger.warning(req, 'get_meeting_rsvps', 'Failed to fetch meeting RSVPs, returning empty array', {
        meeting_id: meetingUid,
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
    logger.debug(req, 'create_meeting_attachment', 'Creating meeting attachment', { meeting_id: meetingUid });

    // Call the LFX V2 API endpoint with multipart/form-data
    // The attachmentData should be a FormData object from the controller
    // The API client will automatically handle FormData and set the correct Content-Type with boundary
    const attachment = await this.microserviceProxy.proxyRequest<any>(
      req,
      'LFX_V2_SERVICE',
      `/itx/meetings/${meetingUid}/attachments`,
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
    logger.debug(req, 'get_meeting_attachment', 'Fetching meeting attachment', { meeting_id: meetingUid, attachment_uid: attachmentUid });

    // Use the microservice proxy to download the binary file
    const buffer = await this.microserviceProxy.proxyBinaryRequest(req, 'LFX_V2_SERVICE', `/itx/meetings/${meetingUid}/attachments/${attachmentUid}`, 'GET');

    return buffer;
  }

  /**
   * Deletes a meeting attachment via LFX V2 API
   * @param req - Express request object
   * @param meetingUid - Meeting UID that the attachment belongs to
   * @param attachmentUid - Attachment UID to delete
   */
  public async deleteMeetingAttachment(req: Request, meetingUid: string, attachmentUid: string): Promise<void> {
    logger.debug(req, 'delete_meeting_attachment', 'Deleting meeting attachment', { meeting_id: meetingUid, attachment_uid: attachmentUid });

    // Call the LFX V2 API endpoint to delete the attachment
    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/itx/meetings/${meetingUid}/attachments/${attachmentUid}`, 'DELETE');
  }

  public async getMeetingAttachmentMetadata(req: Request, meetingUid: string, attachmentUid: string): Promise<any> {
    logger.debug(req, 'get_meeting_attachment_metadata', 'Fetching meeting attachment metadata', { meeting_id: meetingUid, attachment_uid: attachmentUid });

    const metadata = await this.microserviceProxy.proxyRequest<any>(
      req,
      'LFX_V2_SERVICE',
      `/itx/meetings/${meetingUid}/attachments/${attachmentUid}/metadata`,
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
      tags: `meeting_id:${meetingUid}`,
    };

    logger.debug(req, 'get_meeting_attachments', 'Fetching meeting attachments', { meeting_id: meetingUid, query_params: params });

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
      tags: `past_meeting_id:${pastMeetingUid}`,
    };

    logger.debug(req, 'get_past_meeting_attachments', 'Fetching past meeting attachments', { past_meeting_id: pastMeetingUid, query_params: params });

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
