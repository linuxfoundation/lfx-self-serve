// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  BatchRegistrantOperationResponse,
  CreateMeetingRegistrantRequest,
  CreateMeetingRequest,
  UpdateMeetingRegistrantRequest,
  UpdateMeetingRequest,
} from '@lfx-pcc/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { Logger } from '../helpers/logger';
import { validateUidParameter } from '../helpers/validation.helper';
import { MeetingService } from '../services/meeting.service';

/**
 * Controller for handling meeting HTTP requests
 */
export class MeetingController {
  private meetingService: MeetingService = new MeetingService();

  /**
   * GET /meetings
   */
  public async getMeetings(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_meetings', {
      query_params: Logger.sanitize(req.query as Record<string, any>),
    });

    try {
      // Get the meetings
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

      // Log the success
      Logger.success(req, 'get_meetings', startTime, {
        meeting_count: meetings.length,
      });

      // Send the meetings data to the client
      res.json(meetings);
    } catch (error) {
      // Log the error
      Logger.error(req, 'get_meetings', startTime, error);
      next(error);
    }
  }

  /**
   * GET /meetings/:uid
   */
  public async getMeetingById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = Logger.start(req, 'get_meeting_by_id', {
      meeting_uid: uid,
    });

    try {
      // Check if the meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_meeting_by_id',
          service: 'meeting_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      // Get the meeting by ID
      const meeting = await this.meetingService.getMeetingById(req, uid);

      // Log the success
      Logger.success(req, 'get_meeting_by_id', startTime, {
        meeting_uid: uid,
        project_uid: meeting.project_uid,
        title: meeting.title,
      });

      // Send the meeting data to the client
      res.json(meeting);
    } catch (error) {
      // Log the error
      Logger.error(req, 'get_meeting_by_id', startTime, error, {
        meeting_uid: uid,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * POST /meetings
   */
  public async createMeeting(req: Request, res: Response, next: NextFunction): Promise<void> {
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
      // Create the meeting
      const meeting = await this.meetingService.createMeeting(req, meetingData);

      // Log the success
      Logger.success(req, 'create_meeting', startTime, {
        meeting_id: meeting.uid,
        project_uid: meeting.project_uid,
        title: meeting.title,
      });

      // Send the new meeting data to the client
      res.status(201).json(meeting);
    } catch (error) {
      // Log the error
      Logger.error(req, 'create_meeting', startTime, error, {
        project_uid: req.body?.project_uid,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * PUT /meetings/:uid
   */
  public async updateMeeting(req: Request, res: Response, next: NextFunction): Promise<void> {
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
      // Check if the meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'update_meeting',
          service: 'meeting_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      // Update the meeting
      const meeting = await this.meetingService.updateMeeting(req, uid, meetingData, editType as 'single' | 'future');

      // Log the success
      Logger.success(req, 'update_meeting', startTime, {
        meeting_uid: uid,
        project_uid: meeting.project_uid,
        title: meeting.title,
        edit_type: editType || 'single',
      });

      // Send the updated meeting data to the client
      res.json(meeting);
    } catch (error) {
      // Log the error
      Logger.error(req, 'update_meeting', startTime, error, {
        meeting_uid: uid,
        edit_type: editType,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * DELETE /meetings/:uid
   */
  public async deleteMeeting(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = Logger.start(req, 'delete_meeting', {
      meeting_uid: uid,
    });

    try {
      // Check if the meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'delete_meeting',
          service: 'meeting_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      // Delete the meeting
      await this.meetingService.deleteMeeting(req, uid);

      // Log the success
      Logger.success(req, 'delete_meeting', startTime, {
        meeting_uid: uid,
        status_code: 204,
      });

      // Send the response to the client
      res.status(204).send();
    } catch (error) {
      // Log the error
      Logger.error(req, 'delete_meeting', startTime, error, {
        meeting_uid: uid,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * GET /meetings/:uid/registrants
   */
  public async getMeetingRegistrants(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = Logger.start(req, 'get_meeting_registrants', {
      meeting_uid: uid,
    });

    try {
      // Check if the meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_meeting_registrants',
          service: 'meeting_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      // Get the meeting registrants
      const registrants = await this.meetingService.getMeetingRegistrants(req, uid);

      Logger.success(req, 'get_meeting_registrants', startTime, {
        meeting_uid: uid,
        registrant_count: registrants.length,
      });

      // Send the registrants data to the client
      res.json(registrants);
    } catch (error) {
      // Log the error
      Logger.error(req, 'get_meeting_registrants', startTime, error, {
        meeting_uid: uid,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * POST /meetings/:uid/registrants
   * @description Adds one or more registrants with partial success support
   */
  public async addMeetingRegistrants(req: Request, res: Response, next: NextFunction): Promise<void> {
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
      // Check if the meeting UID is provided
      if (!uid) {
        Logger.error(req, 'add_meeting_registrants', startTime, new Error('Missing meeting UID parameter'));

        const validationError = ServiceValidationError.forField('uid', 'Meeting UID is required', {
          operation: 'add_meeting_registrants',
          service: 'meeting_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Check if the registrants data is provided and is an array
      if (!Array.isArray(registrantData) || !registrantData.length) {
        Logger.error(req, 'add_meeting_registrants', startTime, new Error('No registrants provided'));

        // Create a validation error
        const validationError = ServiceValidationError.forField('registrants', 'No registrants provided', {
          operation: 'add_meeting_registrants',
          service: 'meeting_controller',
          path: req.path,
        });

        // Send the validation error to the next middleware
        next(validationError);
        return;
      }

      // Process registrants with fail-fast for 403 errors
      // This will stop the processing if a 403 error is encountered
      const { results, shouldReturn } = await this.processRegistrantOperations(
        req,
        next,
        startTime,
        'add_meeting_registrants',
        uid,
        registrantData,
        (registrant) => this.meetingService.addMeetingRegistrant(req, registrant),
        (registrant) => registrant.email
      );

      // If the processing should return, return
      if (shouldReturn) return;

      // Create batch response
      const batchResponse = this.createBatchResponse(results, registrantData, req, startTime, 'add_meeting_registrants', uid, (registrant) => registrant.email);

      // Log the success
      Logger.success(req, 'add_meeting_registrants', startTime, {
        meeting_uid: uid,
        total_count: registrantData.length,
        successful_count: batchResponse.summary.successful,
        failed_count: batchResponse.summary.failed,
      });

      // Set the status code based on the results
      let statusCode = 201; // Created - all successful
      if (batchResponse.summary.failed > 0) {
        if (batchResponse.summary.successful > 0) {
          statusCode = 207; // Multi-Status - partial success
        } else {
          statusCode = 400; // Bad Request - all failed
        }
      }

      // Send the batch response to the client
      res.status(statusCode).json(batchResponse);
    } catch (error) {
      // Log the error
      Logger.error(req, 'add_meeting_registrants', startTime, error, {
        meeting_uid: uid,
        registrant_count: registrantData.length,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * PUT /meetings/:uid/registrants
   * @description Updates one or more registrants with partial success support
   */
  public async updateMeetingRegistrants(req: Request, res: Response, next: NextFunction): Promise<void> {
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
      // Check if the meeting UID is provided
      if (!uid) {
        Logger.error(req, 'update_meeting_registrants', startTime, new Error('Missing meeting UID parameter'));

        const validationError = ServiceValidationError.forField('uid', 'Meeting UID is required', {
          operation: 'update_meeting_registrants',
          service: 'meeting_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Check if the update data is provided and is an array
      if (!Array.isArray(updateData) || !updateData.length) {
        Logger.error(req, 'update_meeting_registrants', startTime, new Error('No registrants provided'));

        const validationError = ServiceValidationError.forField('registrants', 'No registrants provided', {
          operation: 'update_meeting_registrants',
          service: 'meeting_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Check if the registrant UIDs are provided
      if (updateData.some((update) => !update.uid)) {
        Logger.error(req, 'update_meeting_registrants', startTime, new Error('Missing registrant UIDs for update'), {
          provided_uids: updateData.map((update) => update.uid).filter(Boolean),
        });

        const validationError = ServiceValidationError.forField('registrants.uid', 'One or more registrants are missing UID', {
          operation: 'update_meeting_registrants',
          service: 'meeting_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Process updates with fail-fast for 403 errors
      const { results, shouldReturn } = await this.processRegistrantOperations(
        req,
        next,
        startTime,
        'update_meeting_registrants',
        uid,
        updateData,
        (update) => this.meetingService.updateMeetingRegistrant(req, uid, update.uid, update.changes),
        (update) => update.uid
      );

      // If the processing should return, return
      if (shouldReturn) return;

      // Create the batch response
      const batchResponse = this.createBatchResponse(results, updateData, req, startTime, 'update_meeting_registrants', uid, (update) => update.uid);

      // Log the success
      Logger.success(req, 'update_meeting_registrants', startTime, {
        meeting_uid: uid,
        total_count: updateData.length,
        successful_count: batchResponse.summary.successful,
        failed_count: batchResponse.summary.failed,
      });

      // Set the status code based on the results
      let statusCode = 200; // OK - all successful
      if (batchResponse.summary.failed > 0) {
        if (batchResponse.summary.successful > 0) {
          statusCode = 207; // Multi-Status - partial success
        } else {
          statusCode = 400; // Bad Request - all failed
        }
      }

      // Send the batch response to the client
      res.status(statusCode).json(batchResponse);
    } catch (error) {
      // Log the error
      Logger.error(req, 'update_meeting_registrants', startTime, error, {
        meeting_uid: uid,
        registrant_count: updateData.length,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * DELETE /meetings/:uid/registrants
   * @description Deletes one or more registrants with partial success support
   */
  public async deleteMeetingRegistrants(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const registrantsUid: string[] = req.body || [];

    const startTime = Logger.start(req, 'delete_meeting_registrants', {
      meeting_uid: uid,
      registrant_count: registrantsUid.length,
      body_size: JSON.stringify(req.body).length,
    });

    try {
      // Check if the meeting UID is provided
      if (!uid) {
        Logger.error(req, 'delete_meeting_registrants', startTime, new Error('Missing meeting UID parameter'));

        const validationError = ServiceValidationError.forField('uid', 'Meeting UID is required', {
          operation: 'delete_meeting_registrants',
          service: 'meeting_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Check if the registrant UIDs are provided
      if (!registrantsUid.length) {
        Logger.error(req, 'delete_meeting_registrants', startTime, new Error('Empty registrant UIDs array'));
        const validationError = ServiceValidationError.forField('registrantUids', 'Empty registrant UIDs array', {
          operation: 'delete_meeting_registrants',
          service: 'meeting_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Check if the registrant UIDs are provided and is an array
      if (!Array.isArray(registrantsUid) || !registrantsUid.length || !req.body.every((item: string) => typeof item === 'string')) {
        Logger.error(req, 'delete_meeting_registrants', startTime, new Error('Empty registrant UIDs array'), {
          provided_count: registrantsUid.length,
        });

        const validationError = ServiceValidationError.forField('registrantUids', 'Array of registrant UIDs is required', {
          operation: 'delete_meeting_registrants',
          service: 'meeting_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Process deletions with fail-fast for 403 errors
      // This will stop the processing if a 403 error is encountered
      const { results, shouldReturn } = await this.processRegistrantOperations(
        req,
        next,
        startTime,
        'delete_meeting_registrants',
        uid,
        registrantsUid,
        (registrantUid) => this.meetingService.deleteMeetingRegistrant(req, uid, registrantUid).then(() => registrantUid),
        (registrantUid) => registrantUid
      );

      // If the processing should return, return
      if (shouldReturn) return;

      // Create the batch response
      const batchResponse = this.createBatchResponse(
        results,
        registrantsUid,
        req,
        startTime,
        'delete_meeting_registrants',
        uid,
        (registrantUid) => registrantUid
      );

      // Log the success
      Logger.success(req, 'delete_meeting_registrants', startTime, {
        meeting_uid: uid,
        total_count: registrantsUid.length,
        successful_count: batchResponse.summary.successful,
        failed_count: batchResponse.summary.failed,
      });

      // Set the status code based on the results
      let statusCode = 200; // OK - all successful
      if (batchResponse.summary.failed > 0) {
        if (batchResponse.summary.successful > 0) {
          statusCode = 207; // Multi-Status - partial success
        } else {
          statusCode = 400; // Bad Request - all failed
        }
      }

      // Send the batch response to the client
      res.status(statusCode).json(batchResponse);
    } catch (error) {
      // Log the error
      Logger.error(req, 'delete_meeting_registrants', startTime, error, {
        meeting_uid: uid,
        registrant_count: registrantsUid.length,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * Private helper to process registrant operations with fail-fast for 403 errors
   */
  private async processRegistrantOperations<T, R>(
    req: Request,
    next: NextFunction,
    startTime: number,
    operationName: string,
    meetingUid: string,
    inputData: T[],
    operation: (input: T) => Promise<R>,
    getIdentifier: (input: T, index?: number) => string
  ): Promise<{ results: PromiseSettledResult<R>[]; shouldReturn: boolean }> {
    try {
      // Process the first registrant
      const firstResult = await operation(inputData[0]);

      // If the first registrant succeeds, process the remaining in parallel
      let results: PromiseSettledResult<R>[];
      if (inputData.length > 1) {
        const remainingResults = await Promise.allSettled(inputData.slice(1).map((input) => operation(input)));
        results = [{ status: 'fulfilled', value: firstResult }, ...remainingResults];
      } else {
        results = [{ status: 'fulfilled', value: firstResult }];
      }

      // Return the results and shouldReturn flag
      return { results, shouldReturn: false };
    } catch (error: any) {
      // Check if it's a 403 error - if so, fail fast
      // This will stop the processing if a 403 error is encountered
      if (error?.status === 403 || error?.statusCode === 403) {
        Logger.error(req, operationName, startTime, error, {
          meeting_uid: meetingUid,
          identifier: getIdentifier(inputData[0], 0),
          fail_fast: true,
        });

        // Send the error to the next middleware
        next(error);
        return { results: [], shouldReturn: true };
      }

      // For other errors, continue processing the remaining items
      let results: PromiseSettledResult<R>[] = [{ status: 'rejected', reason: error }];

      if (inputData.length > 1) {
        const remainingResults = await Promise.allSettled(inputData.slice(1).map((input) => operation(input)));
        results = [...results, ...remainingResults];
      }

      // Return the results and shouldReturn flag
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
    // Initialize the successes and failures arrays
    const successes: T[] = [];
    const failures: Array<{
      input: I;
      error: { message: string; code?: string; details?: unknown };
    }> = [];

    // Process the results
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

    // Return the batch response
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
