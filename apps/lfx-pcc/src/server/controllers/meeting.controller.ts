// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreateMeetingRequest } from '@lfx-pcc/shared/interfaces';
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
   * GET /meetings/:id
   */
  public async getMeetingById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const startTime = Logger.start(req, 'get_meeting_by_id', {
      meeting_id: id,
    });

    try {
      if (!id) {
        Logger.error(req, 'get_meeting_by_id', startTime, new Error('Missing meeting ID parameter'));

        Responder.badRequest(res, 'Meeting ID is required', {
          code: 'MISSING_MEETING_ID',
        });
        return;
      }

      const meeting = await this.meetingService.getMeetingById(req, id);

      Logger.success(req, 'get_meeting_by_id', startTime, {
        meeting_id: id,
        project_uid: meeting.project_uid,
        title: meeting.title,
      });

      res.json(meeting);
    } catch (error) {
      Logger.error(req, 'get_meeting_by_id', startTime, error, {
        meeting_id: id,
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
      // Basic validation
      if (!meetingData.title || !meetingData.start_time || !meetingData.project_uid || !meetingData.duration || !meetingData.timezone) {
        Logger.error(req, 'create_meeting', startTime, new Error('Missing required fields for meeting creation'), {
          provided_fields: {
            has_title: !!meetingData.title,
            has_start_time: !!meetingData.start_time,
            has_project_uid: !!meetingData.project_uid,
            has_duration: !!meetingData.duration,
            has_timezone: !!meetingData.timezone,
          },
        });

        Responder.badRequest(res, 'Title, start_time, duration, timezone, and project_uid are required fields', {
          code: 'MISSING_REQUIRED_FIELDS',
        });
        return;
      }

      // Validate duration range
      if (meetingData.duration < 0 || meetingData.duration > 600) {
        Logger.error(req, 'create_meeting', startTime, new Error('Invalid duration for meeting creation'), {
          provided_duration: meetingData.duration,
        });

        Responder.badRequest(res, 'Duration must be between 0 and 600 minutes', {
          code: 'INVALID_DURATION',
        });
        return;
      }

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
   * DELETE /meetings/:id
   */
  public async deleteMeeting(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const startTime = Logger.start(req, 'delete_meeting', {
      meeting_id: id,
    });

    try {
      if (!id) {
        Logger.error(req, 'delete_meeting', startTime, new Error('Missing meeting ID parameter'));

        Responder.badRequest(res, 'Meeting ID is required', {
          code: 'MISSING_MEETING_ID',
        });
        return;
      }

      await this.meetingService.deleteMeeting(req, id);

      Logger.success(req, 'delete_meeting', startTime, {
        meeting_id: id,
        status_code: 204,
      });

      res.status(204).send();
    } catch (error) {
      Logger.error(req, 'delete_meeting', startTime, error, {
        meeting_id: id,
      });
      Responder.handle(res, error, 'delete_meeting');
    }
  }
}
