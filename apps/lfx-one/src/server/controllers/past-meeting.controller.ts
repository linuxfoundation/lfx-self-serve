// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { PastMeeting, PastMeetingRecording, PastMeetingSummary, UpdatePastMeetingSummaryRequest } from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils';
import { Logger } from '../helpers/logger';
import { validateUidParameter } from '../helpers/validation.helper';
import { MeetingService } from '../services/meeting.service';

/**
 * Controller for handling past meeting HTTP requests
 */
export class PastMeetingController {
  private meetingService: MeetingService = new MeetingService();

  /**
   * GET /past-meetings
   */
  public async getPastMeetings(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_past_meetings', {
      query_params: Logger.sanitize(req.query as Record<string, any>),
    });

    try {
      // TODO(v1-migration): Remove V1 past meeting fetch once all meetings are migrated to V2
      // Get both 'past_meeting' and 'v1_past_meeting' types in parallel
      const [regularPastMeetings, v1PastMeetings] = await Promise.all([
        this.meetingService.getMeetings(req, req.query as Record<string, any>, 'past_meeting'),
        this.meetingService.getMeetings(req, req.query as Record<string, any>, 'v1_past_meeting'),
      ]);

      // Combine the meetings
      const meetings = [...regularPastMeetings, ...v1PastMeetings] as PastMeeting[];

      // TODO: Remove this once we have a way to get the registrants count
      // Process each meeting individually to add registrant and participant counts
      await Promise.all(
        meetings.map(async (meeting) => {
          const counts = await this.addParticipantsCount(req, meeting.uid);
          meeting.individual_registrants_count = counts.individual_registrants_count;
          meeting.committee_members_count = counts.committee_members_count;
          meeting.participant_count = counts.participant_count;
          meeting.attended_count = counts.attended_count;
        })
      );

      // Log the success
      Logger.success(req, 'get_past_meetings', startTime, {
        meeting_count: meetings.length,
        regular_past_meeting_count: regularPastMeetings.length,
        v1_past_meeting_count: v1PastMeetings.length,
      });

      // Send the meetings data to the client
      res.json(meetings);
    } catch (error) {
      // Log the error
      Logger.error(req, 'get_past_meetings', startTime, error);
      next(error);
    }
  }

  /**
   * GET /past-meetings/:uid/participants
   */
  public async getPastMeetingParticipants(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = Logger.start(req, 'get_past_meeting_participants', {
      past_meeting_uid: uid,
    });

    try {
      // Check if the past meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_past_meeting_participants',
          service: 'past_meeting_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      // Get the past meeting participants
      const participants = await this.meetingService.getPastMeetingParticipants(req, uid);

      // Log the success
      Logger.success(req, 'get_past_meeting_participants', startTime, {
        past_meeting_uid: uid,
        participant_count: participants.length,
      });

      // Send the participants data to the client
      res.json(participants);
    } catch (error) {
      // Log the error
      Logger.error(req, 'get_past_meeting_participants', startTime, error, {
        past_meeting_uid: uid,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * GET /past-meetings/:uid/recording
   */
  public async getPastMeetingRecording(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = Logger.start(req, 'get_past_meeting_recording', {
      past_meeting_uid: uid,
    });

    try {
      // Check if the past meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_past_meeting_recording',
          service: 'past_meeting_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      // Determine if this is a v1 meeting based on UID format
      const isV1 = !isUuid(uid);

      // Get the past meeting recording
      const recording: PastMeetingRecording | null = await this.meetingService.getPastMeetingRecording(req, uid, isV1);

      // If no recording found, return 404
      if (!recording) {
        res.status(404).json({
          error: 'Not Found',
          message: `No recording found for past meeting ${uid}`,
        });
        return;
      }

      // Log the success
      Logger.success(req, 'get_past_meeting_recording', startTime, {
        past_meeting_uid: uid,
        recording_uid: recording.uid,
        recording_count: recording.recording_count,
        session_count: recording.sessions?.length || 0,
      });

      // Send the recording data to the client
      res.json(recording);
    } catch (error) {
      // Log the error
      Logger.error(req, 'get_past_meeting_recording', startTime, error, {
        past_meeting_uid: uid,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * GET /past-meetings/:uid/summary
   */
  public async getPastMeetingSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = Logger.start(req, 'get_past_meeting_summary', {
      past_meeting_uid: uid,
    });

    try {
      // Check if the past meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_past_meeting_summary',
          service: 'past_meeting_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      // Determine if this is a v1 meeting based on UID format
      const isV1 = !isUuid(uid);

      // Get the past meeting summary
      const summary: PastMeetingSummary | null = await this.meetingService.getPastMeetingSummary(req, uid, isV1);

      // If no summary found, return 404
      if (!summary) {
        res.status(404).json({
          error: 'Not Found',
          message: `No summary found for past meeting ${uid}`,
        });
        return;
      }

      // Log the success
      Logger.success(req, 'get_past_meeting_summary', startTime, {
        past_meeting_uid: uid,
        summary_uid: summary.uid,
        approved: summary.approved,
        requires_approval: summary.requires_approval,
      });

      // Send the summary data to the client
      res.json(summary);
    } catch (error) {
      // Log the error
      Logger.error(req, 'get_past_meeting_summary', startTime, error, {
        past_meeting_uid: uid,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * GET /past-meetings/:uid/attachments
   */
  public async getPastMeetingAttachments(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = Logger.start(req, 'get_past_meeting_attachments', {
      past_meeting_uid: uid,
    });

    try {
      // Check if the past meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_past_meeting_attachments',
          service: 'past_meeting_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      // Get the past meeting attachments
      const attachments = await this.meetingService.getPastMeetingAttachments(req, uid);

      // Log the success
      Logger.success(req, 'get_past_meeting_attachments', startTime, {
        past_meeting_uid: uid,
        attachment_count: attachments.length,
      });

      // Send the attachments data to the client
      res.json(attachments);
    } catch (error) {
      // Log the error
      Logger.error(req, 'get_past_meeting_attachments', startTime, error, {
        past_meeting_uid: uid,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * PUT /past-meetings/:uid/summary/:summaryUid
   */
  public async updatePastMeetingSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, summaryUid } = req.params;
    const startTime = Logger.start(req, 'update_past_meeting_summary', {
      past_meeting_uid: uid,
      summary_uid: summaryUid,
    });

    try {
      // Check if the past meeting UID and summary UID are provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'update_past_meeting_summary',
          service: 'past_meeting_controller',
          logStartTime: startTime,
        }) ||
        !validateUidParameter(summaryUid, req, next, {
          operation: 'update_past_meeting_summary',
          service: 'past_meeting_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      const body = req.body as UpdatePastMeetingSummaryRequest;

      // Validate request body - at least one field must be provided
      if (!body.edited_content && body.approved === undefined) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Either edited_content or approved must be provided',
        });
        return;
      }

      // Update the summary
      const updatedSummary = await this.meetingService.updatePastMeetingSummary(req, uid, summaryUid, body);

      // Log the success
      Logger.success(req, 'update_past_meeting_summary', startTime, {
        past_meeting_uid: uid,
        summary_uid: summaryUid,
      });

      // Send the updated summary data to the client
      res.json(updatedSummary);
    } catch (error) {
      // Log the error
      Logger.error(req, 'update_past_meeting_summary', startTime, error, {
        past_meeting_uid: uid,
        summary_uid: summaryUid,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * Helper method to add participant and registrant counts to a past meeting
   * @param req - Express request object
   * @param pastMeetingUid - UID of the past meeting
   * @returns Promise with registrant and participant counts or defaults to 0 on error
   */
  private async addParticipantsCount(
    req: Request,
    pastMeetingUid: string
  ): Promise<{ individual_registrants_count: number; committee_members_count: number; participant_count: number; attended_count: number }> {
    const startTime = Logger.start(req, 'add_participant_counts', {
      past_meeting_uid: pastMeetingUid,
    });

    try {
      // Get all participants (contains both invited and attended information)
      const participants = await this.meetingService.getPastMeetingParticipants(req, pastMeetingUid).catch(() => []);

      // Calculate counts based on participant data
      const invitedCount = participants.filter((p) => p.is_invited).length;
      const attendedCount = participants.filter((p) => p.is_attended).length;
      const totalParticipantCount = participants.length;

      const result = {
        individual_registrants_count: invitedCount, // Count of people who were formally invited
        committee_members_count: 0, // Not available in participant data, set to 0
        participant_count: totalParticipantCount, // Total count of all participants
        attended_count: attendedCount, // Count of people who actually attended
      };

      Logger.success(req, 'add_participant_counts', startTime, {
        past_meeting_uid: pastMeetingUid,
        invited_count: invitedCount,
        attended_count: attendedCount,
        total_count: totalParticipantCount,
      });

      return result;
    } catch (error) {
      // Log error but don't fail - default to 0 counts
      Logger.error(req, 'add_participant_counts', startTime, error, {
        past_meeting_uid: pastMeetingUid,
      });

      return {
        individual_registrants_count: 0,
        committee_members_count: 0,
        participant_count: 0,
        attended_count: 0,
      };
    }
  }
}
