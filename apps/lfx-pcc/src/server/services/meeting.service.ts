// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreateMeetingRequest, ETagError, Meeting, QueryServiceResponse } from '@lfx-pcc/shared/interfaces';
import { Request } from 'express';

import { getUsernameFromAuth } from '../utils/auth-helper';
import { Logger } from '../helpers/logger';
import { ApiClientService } from './api-client.service';
import { ETagService } from './etag.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Service for handling meeting business logic with microservice proxy
 */
export class MeetingService {
  private etagService: ETagService;
  private microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService(new ApiClientService());
    this.etagService = new ETagService(this.microserviceProxy);
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

    return resources.map((resource) => resource.data);
  }

  /**
   * Fetches a single meeting by ID
   */
  public async getMeetingById(req: Request, meetingId: string): Promise<Meeting> {
    const params = {
      type: 'meeting',
      tags: meetingId,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Meeting>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    if (!resources || resources.length === 0) {
      const error: ETagError = {
        code: 'NOT_FOUND',
        message: 'Meeting not found',
        statusCode: 404,
      };
      throw error;
    }

    if (resources.length > 1) {
      req.log.warn(
        {
          meeting_id: meetingId,
          result_count: resources.length,
        },
        'Multiple meetings found for single ID lookup'
      );
    }

    return resources[0].data;
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
   * Deletes a meeting using ETag for concurrency control
   */
  public async deleteMeeting(req: Request, meetingId: string): Promise<void> {
    // Step 1: Fetch meeting with ETag
    const { etag } = await this.etagService.fetchWithETag<Meeting>(req, 'LFX_V2_SERVICE', `/meetings/${meetingId}`, 'delete_meeting');

    // Step 2: Delete meeting with ETag
    await this.etagService.deleteWithETag(req, 'LFX_V2_SERVICE', `/meetings/${meetingId}`, etag, 'delete_meeting');

    req.log.info(
      {
        operation: 'delete_meeting',
        meeting_id: meetingId,
      },
      'Meeting deleted successfully'
    );
  }
}
