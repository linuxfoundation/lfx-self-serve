// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CreateMeetingRegistrantRequest,
  CreateMeetingRequest,
  Meeting,
  MeetingRegistrant,
  QueryServiceResponse,
  UpdateMeetingRegistrantRequest,
  UpdateMeetingRequest,
} from '@lfx-pcc/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { Logger } from '../helpers/logger';
import { getUsernameFromAuth } from '../utils/auth-helper';
import { AccessCheckService } from './access-check.service';
import { CommitteeService } from './committee.service';
import { ETagService } from './etag.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Service for handling meeting business logic with microservice proxy
 */
export class MeetingService {
  private accessCheckService: AccessCheckService;
  private etagService: ETagService;
  private microserviceProxy: MicroserviceProxyService;
  private committeeService: CommitteeService;
  public constructor() {
    this.accessCheckService = new AccessCheckService();
    this.microserviceProxy = new MicroserviceProxyService();
    this.etagService = new ETagService();
    this.committeeService = new CommitteeService();
  }

  /**
   * Fetches all meetings based on query parameters
   */
  public async getMeetings(req: Request, query: Record<string, any> = {}): Promise<Meeting[]> {
    const params = {
      ...query,
      type: 'meeting',
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Meeting>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    let meetings = resources.map((resource) => resource.data);

    req.log.debug({ meetings }, 'Meetings');
    // Get committee data for each committee associated with the meeting
    if (meetings.some((m) => m.committees && m.committees.length > 0)) {
      meetings = await this.getMeetingCommittees(req, meetings);
    }

    // Add writer access field to all meetings
    return await this.accessCheckService.addAccessToResources(req, meetings, 'meeting', 'organizer');
  }

  /**
   * Fetches a single meeting by UID
   */
  public async getMeetingById(req: Request, meetingUid: string): Promise<Meeting> {
    const params = {
      type: 'meeting',
      tags: `meeting_uid:${meetingUid}`,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Meeting>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    if (!resources || resources.length === 0) {
      throw new ResourceNotFoundError('Meeting', meetingUid, {
        operation: 'get_meeting_by_id',
        service: 'meeting_service',
        path: `/meetings/${meetingUid}`,
      });
    }

    if (resources.length > 1) {
      req.log.warn(
        {
          meeting_uid: meetingUid,
          result_count: resources.length,
        },
        'Multiple meetings found for single UID lookup'
      );
    }

    let meeting = resources.map((resource) => resource.data);

    if (meeting[0].committees && meeting[0].committees.length > 0) {
      meeting = await this.getMeetingCommittees(req, meeting);
    }

    // Add writer access field to the meeting
    return await this.accessCheckService.addAccessToResource(req, meeting[0], 'meeting', 'organizer');
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
   */
  public async getMeetingRegistrants(req: Request, meetingUid: string): Promise<MeetingRegistrant[]> {
    try {
      const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRegistrant>>(
        req,
        'LFX_V2_SERVICE',
        `/query/resources`,
        'GET',
        {
          type: 'meeting_registrant',
          tags: meetingUid,
        }
      );

      req.log.info(
        {
          operation: 'get_meeting_registrants',
          meeting_uid: meetingUid,
          registrant_count: resources.length,
        },
        'Meeting registrants fetched successfully'
      );

      return resources.map((resource) => resource.data);
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
}
