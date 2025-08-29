// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  BatchRegistrantOperationResponse,
  CreateMeetingRegistrantRequest,
  CreateMeetingRequest,
  UpdateMeetingRegistrantRequest,
  UpdateMeetingRequest,
} from '@lfx-pcc/shared/interfaces';
import { Request, Response } from 'express';

import { Logger } from '../helpers/logger';
import { Responder } from '../helpers/responder';
import { MeetingService } from '../services/meeting.service';

/**
 * Controller for handling meeting HTTP requests
 */
export class MeetingController {
  private meetingService: MeetingService = new MeetingService();

  /**
   * GET /meetings
   */
  public async getMeetings(req: Request, res: Response): Promise<void> {
    const startTime = Logger.start(req, 'get_meetings', {
      query_params: Logger.sanitize(req.query as Record<string, any>),
    });

    try {
      const meetings = await this.meetingService.getMeetings(req, req.query as Record<string, any>);

      // TODO: Remove this once we have a way to get the registrants count
      const counts = await Promise.all(
        meetings.map(async (m) => {
          const registrants = await this.meetingService.getMeetingRegistrants(req, m.uid);
          return registrants.length;
        })
      );
      meetings.forEach((m, i) => {
        m.individual_registrants_count = counts[i];
      });

      Logger.success(req, 'get_meetings', startTime, {
        meeting_count: meetings.length,
      });

      res.json(meetings);
    } catch (error) {
      Logger.error(req, 'get_meetings', startTime, error);
      Responder.handle(res, error, 'get_meetings');
    }
  }

  /**
   * GET /meetings/:uid
   */
  public async getMeetingById(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const startTime = Logger.start(req, 'get_meeting_by_id', {
      meeting_uid: uid,
    });

    try {
      if (!uid) {
        Logger.error(req, 'get_meeting_by_id', startTime, new Error('Missing meeting UID parameter'));

        Responder.badRequest(res, 'Meeting UID is required', {
          code: 'MISSING_MEETING_UID',
        });
        return;
      }

      const meeting = await this.meetingService.getMeetingById(req, uid);

      Logger.success(req, 'get_meeting_by_id', startTime, {
        meeting_uid: uid,
        project_uid: meeting.project_uid,
        title: meeting.title,
      });

      res.json(meeting);
    } catch (error) {
      Logger.error(req, 'get_meeting_by_id', startTime, error, {
        meeting_uid: uid,
      });
      Responder.handle(res, error, 'get_meeting_by_id');
    }
  }

  /**
   * POST /meetings
   */
  public async createMeeting(req: Request, res: Response): Promise<void> {
    const meetingData: CreateMeetingRequest = req.body;
    const startTime = Logger.start(req, 'create_meeting', {
      project_uid: meetingData?.project_uid,
      title: meetingData?.title,
      start_time: meetingData?.start_time,
      duration: meetingData?.duration,
      timezone: meetingData?.timezone,
      body_size: JSON.stringify(req.body).length,
    });

    try {
      const meeting = await this.meetingService.createMeeting(req, meetingData);

      Logger.success(req, 'create_meeting', startTime, {
        meeting_id: meeting.uid,
        project_uid: meeting.project_uid,
        title: meeting.title,
      });

      res.status(201).json(meeting);
    } catch (error) {
      Logger.error(req, 'create_meeting', startTime, error, {
        project_uid: req.body?.project_uid,
      });
      Responder.handle(res, error, 'create_meeting');
    }
  }

  /**
   * PUT /meetings/:uid
   */
  public async updateMeeting(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const meetingData: UpdateMeetingRequest = req.body;
    const { editType } = req.query;
    const startTime = Logger.start(req, 'update_meeting', {
      meeting_uid: uid,
      project_uid: meetingData?.project_uid,
      start_time: meetingData?.start_time,
      timezone: meetingData?.timezone,
      edit_type: editType,
      body_size: JSON.stringify(req.body).length,
    });

    try {
      if (!uid) {
        Logger.error(req, 'update_meeting', startTime, new Error('Missing meeting UID parameter'));

        Responder.badRequest(res, 'Meeting UID is required', {
          code: 'MISSING_MEETING_UID',
        });
        return;
      }

      const meeting = await this.meetingService.updateMeeting(req, uid, meetingData, editType as 'single' | 'future');

      Logger.success(req, 'update_meeting', startTime, {
        meeting_uid: uid,
        project_uid: meeting.project_uid,
        title: meeting.title,
        edit_type: editType || 'single',
      });

      res.json(meeting);
    } catch (error) {
      Logger.error(req, 'update_meeting', startTime, error, {
        meeting_uid: uid,
        edit_type: editType,
      });
      Responder.handle(res, error, 'update_meeting');
    }
  }

  /**
   * DELETE /meetings/:uid
   */
  public async deleteMeeting(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const startTime = Logger.start(req, 'delete_meeting', {
      meeting_uid: uid,
    });

    try {
      if (!uid) {
        Logger.error(req, 'delete_meeting', startTime, new Error('Missing meeting UID parameter'));

        Responder.badRequest(res, 'Meeting UID is required', {
          code: 'MISSING_MEETING_UID',
        });
        return;
      }

      await this.meetingService.deleteMeeting(req, uid);

      Logger.success(req, 'delete_meeting', startTime, {
        meeting_uid: uid,
        status_code: 204,
      });

      res.status(204).send();
    } catch (error) {
      Logger.error(req, 'delete_meeting', startTime, error, {
        meeting_uid: uid,
      });
      Responder.handle(res, error, 'delete_meeting');
    }
  }

  /**
   * GET /meetings/:uid/registrants
   */
  public async getMeetingRegistrants(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const startTime = Logger.start(req, 'get_meeting_registrants', {
      meeting_uid: uid,
    });

    try {
      if (!uid) {
        Logger.error(req, 'get_meeting_registrants', startTime, new Error('Missing meeting UID parameter'));

        Responder.badRequest(res, 'Meeting UID is required', {
          code: 'MISSING_MEETING_UID',
        });
        return;
      }

      const registrants = await this.meetingService.getMeetingRegistrants(req, uid);

      Logger.success(req, 'get_meeting_registrants', startTime, {
        meeting_uid: uid,
        registrant_count: registrants.length,
      });

      res.json(registrants);
    } catch (error) {
      Logger.error(req, 'get_meeting_registrants', startTime, error, {
        meeting_uid: uid,
      });
      Responder.handle(res, error, 'get_meeting_registrants');
    }
  }

  /**
   * POST /meetings/:uid/registrants
   * @description Adds one or more registrants with partial success support
   */
  public async addMeetingRegistrants(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const registrantData: CreateMeetingRegistrantRequest[] =
      req.body?.map((registrant: CreateMeetingRegistrantRequest) => ({
        ...registrant,
        meeting_uid: uid,
      })) || [];

    const startTime = Logger.start(req, 'add_meeting_registrants', {
      meeting_uid: uid,
      registrant_count: registrantData.length,
      body_size: JSON.stringify(req.body).length,
    });

    try {
      if (!uid) {
        Logger.error(req, 'add_meeting_registrants', startTime, new Error('Missing meeting UID parameter'));

        Responder.badRequest(res, 'Meeting UID is required', {
          code: 'MISSING_MEETING_UID',
        });
        return;
      }

      if (!Array.isArray(registrantData) || !registrantData.length) {
        Logger.error(req, 'add_meeting_registrants', startTime, new Error('No registrants provided'));
        Responder.badRequest(res, 'No registrants provided', {
          code: 'MISSING_REGISTRANT_DATA',
        });
        return;
      }

      // Process registrants with fail-fast for 403 errors
      const { results, shouldReturn } = await this.processRegistrantOperations(
        req,
        res,
        startTime,
        'add_meeting_registrants',
        uid,
        registrantData,
        (registrant) => this.meetingService.addMeetingRegistrant(req, registrant),
        (registrant) => registrant.email
      );

      if (shouldReturn) return;

      // Create batch response
      const batchResponse = this.createBatchResponse(results, registrantData, req, startTime, 'add_meeting_registrants', uid, (registrant) => registrant.email);

      Logger.success(req, 'add_meeting_registrants', startTime, {
        meeting_uid: uid,
        total_count: registrantData.length,
        successful_count: batchResponse.summary.successful,
        failed_count: batchResponse.summary.failed,
      });

      // Set status based on results
      let statusCode = 201; // Created - all successful
      if (batchResponse.summary.failed > 0) {
        if (batchResponse.summary.successful > 0) {
          statusCode = 207; // Multi-Status - partial success
        } else {
          statusCode = 400; // Bad Request - all failed
        }
      }

      res.status(statusCode).json(batchResponse);
    } catch (error) {
      Logger.error(req, 'add_meeting_registrants', startTime, error, {
        meeting_uid: uid,
        registrant_count: registrantData.length,
      });
      Responder.handle(res, error, 'add_meeting_registrants');
    }
  }

  /**
   * PUT /meetings/:uid/registrants
   * @description Updates one or more registrants with partial success support
   */
  public async updateMeetingRegistrants(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const updateData: { uid: string; changes: UpdateMeetingRegistrantRequest }[] =
      req.body?.map((update: { uid: string; changes: UpdateMeetingRegistrantRequest }) => ({
        ...update,
        changes: {
          ...update.changes,
          meeting_uid: uid,
        },
      })) || [];

    const startTime = Logger.start(req, 'update_meeting_registrants', {
      meeting_uid: uid,
      registrant_count: updateData.length,
      body_size: JSON.stringify(req.body).length,
    });

    try {
      if (!uid) {
        Logger.error(req, 'update_meeting_registrants', startTime, new Error('Missing meeting UID parameter'));

        Responder.badRequest(res, 'Meeting UID is required', {
          code: 'MISSING_MEETING_UID',
        });
        return;
      }

      if (!Array.isArray(updateData) || !updateData.length) {
        Logger.error(req, 'update_meeting_registrants', startTime, new Error('No registrants provided'));
        Responder.badRequest(res, 'No registrants provided', {
          code: 'MISSING_REGISTRANT_DATA',
        });
        return;
      }

      // Basic validation - only check for registrant UIDs
      if (updateData.some((update) => !update.uid)) {
        Logger.error(req, 'update_meeting_registrants', startTime, new Error('Missing registrant UIDs for update'), {
          provided_uids: updateData.map((update) => update.uid).filter(Boolean),
        });

        Responder.badRequest(res, 'One or more registrants are missing UID', {
          code: 'MISSING_REGISTRANT_UID',
        });
        return;
      }

      // Process updates with fail-fast for 403 errors
      const { results, shouldReturn } = await this.processRegistrantOperations(
        req,
        res,
        startTime,
        'update_meeting_registrants',
        uid,
        updateData,
        (update) => this.meetingService.updateMeetingRegistrant(req, uid, update.uid, update.changes),
        (update) => update.uid
      );

      if (shouldReturn) return;

      // Create batch response
      const batchResponse = this.createBatchResponse(results, updateData, req, startTime, 'update_meeting_registrants', uid, (update) => update.uid);

      Logger.success(req, 'update_meeting_registrants', startTime, {
        meeting_uid: uid,
        total_count: updateData.length,
        successful_count: batchResponse.summary.successful,
        failed_count: batchResponse.summary.failed,
      });

      // Set status based on results
      let statusCode = 200; // OK - all successful
      if (batchResponse.summary.failed > 0) {
        if (batchResponse.summary.successful > 0) {
          statusCode = 207; // Multi-Status - partial success
        } else {
          statusCode = 400; // Bad Request - all failed
        }
      }

      res.status(statusCode).json(batchResponse);
    } catch (error) {
      Logger.error(req, 'update_meeting_registrants', startTime, error, {
        meeting_uid: uid,
        registrant_count: updateData.length,
      });
      Responder.handle(res, error, 'update_meeting_registrants');
    }
  }

  /**
   * DELETE /meetings/:uid/registrants
   * @description Deletes one or more registrants with partial success support
   */
  public async deleteMeetingRegistrants(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const registrantsUid: string[] = req.body || [];

    const startTime = Logger.start(req, 'delete_meeting_registrants', {
      meeting_uid: uid,
      registrant_count: registrantsUid.length,
      body_size: JSON.stringify(req.body).length,
    });

    try {
      if (!uid) {
        Logger.error(req, 'delete_meeting_registrants', startTime, new Error('Missing meeting UID parameter'));

        Responder.badRequest(res, 'Meeting UID is required', {
          code: 'MISSING_MEETING_UID',
        });
        return;
      }

      if (!registrantsUid.length) {
        Logger.error(req, 'delete_meeting_registrants', startTime, new Error('Empty registrant UIDs array'));
        Responder.badRequest(res, 'Empty registrant UIDs array', {
          code: 'MISSING_REGISTRANT_UIDS',
        });
        return;
      }

      // Basic validation - only check for non-empty array
      if (!Array.isArray(registrantsUid) || !registrantsUid.length || !req.body.every((item: string) => typeof item === 'string')) {
        Logger.error(req, 'delete_meeting_registrants', startTime, new Error('Empty registrant UIDs array'), {
          provided_count: registrantsUid.length,
        });

        Responder.badRequest(res, 'Array of registrant UIDs is required', {
          code: 'MISSING_REGISTRANT_UIDS',
        });
        return;
      }

      // Process deletions with fail-fast for 403 errors
      const { results, shouldReturn } = await this.processRegistrantOperations(
        req,
        res,
        startTime,
        'delete_meeting_registrants',
        uid,
        registrantsUid,
        (registrantUid) => this.meetingService.deleteMeetingRegistrant(req, uid, registrantUid).then(() => registrantUid),
        (registrantUid) => registrantUid
      );

      if (shouldReturn) return;

      // Create batch response
      const batchResponse = this.createBatchResponse(
        results,
        registrantsUid,
        req,
        startTime,
        'delete_meeting_registrants',
        uid,
        (registrantUid) => registrantUid
      );

      Logger.success(req, 'delete_meeting_registrants', startTime, {
        meeting_uid: uid,
        total_count: registrantsUid.length,
        successful_count: batchResponse.summary.successful,
        failed_count: batchResponse.summary.failed,
      });

      // Set status based on results
      let statusCode = 200; // OK - all successful
      if (batchResponse.summary.failed > 0) {
        if (batchResponse.summary.successful > 0) {
          statusCode = 207; // Multi-Status - partial success
        } else {
          statusCode = 400; // Bad Request - all failed
        }
      }

      res.status(statusCode).json(batchResponse);
    } catch (error) {
      Logger.error(req, 'delete_meeting_registrants', startTime, error, {
        meeting_uid: uid,
        registrant_count: registrantsUid.length,
      });
      Responder.handle(res, error, 'delete_meeting_registrants');
    }
  }

  /**
   * Private helper to process registrant operations with fail-fast for 403 errors
   */
  private async processRegistrantOperations<T, R>(
    req: Request,
    res: Response,
    startTime: number,
    operationName: string,
    meetingUid: string,
    inputData: T[],
    operation: (input: T) => Promise<R>,
    getIdentifier: (input: T, index?: number) => string
  ): Promise<{ results: PromiseSettledResult<R>[]; shouldReturn: boolean }> {
    try {
      const firstResult = await operation(inputData[0]);

      // If first succeeds, process remaining in parallel
      let results: PromiseSettledResult<R>[];
      if (inputData.length > 1) {
        const remainingResults = await Promise.allSettled(inputData.slice(1).map((input) => operation(input)));
        results = [{ status: 'fulfilled', value: firstResult }, ...remainingResults];
      } else {
        results = [{ status: 'fulfilled', value: firstResult }];
      }

      return { results, shouldReturn: false };
    } catch (error: any) {
      // Check if it's a 403 error - if so, fail fast
      if (error?.status === 403 || error?.statusCode === 403) {
        Logger.error(req, operationName, startTime, error, {
          meeting_uid: meetingUid,
          identifier: getIdentifier(inputData[0], 0),
          fail_fast: true,
        });
        Responder.handle(res, error, operationName);
        return { results: [], shouldReturn: true };
      }

      // For other errors, continue processing remaining items
      let results: PromiseSettledResult<R>[] = [{ status: 'rejected', reason: error }];

      if (inputData.length > 1) {
        const remainingResults = await Promise.allSettled(inputData.slice(1).map((input) => operation(input)));
        results = [...results, ...remainingResults];
      }

      return { results, shouldReturn: false };
    }
  }

  /**
   * Private helper to create batch response from results
   */
  private createBatchResponse<T, I>(
    results: PromiseSettledResult<T>[],
    inputData: I[],
    req: Request,
    startTime: number,
    operationName: string,
    meetingUid: string,
    getIdentifier: (input: I, index?: number) => string
  ): BatchRegistrantOperationResponse<T> {
    const successes: T[] = [];
    const failures: Array<{
      input: I;
      error: { message: string; code?: string; details?: unknown };
    }> = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successes.push(result.value);
      } else {
        const error = result.reason;
        failures.push({
          input: inputData[index],
          error: {
            message: error?.message || 'Unknown error occurred',
            code: error?.code,
            details: error,
          },
        });

        // Log individual failure
        Logger.error(req, operationName, startTime, error, {
          meeting_uid: meetingUid,
          identifier: getIdentifier(inputData[index], index),
        });
      }
    });

    return {
      successes,
      failures,
      summary: {
        total: inputData.length,
        successful: successes.length,
        failed: failures.length,
      },
    };
  }
}
