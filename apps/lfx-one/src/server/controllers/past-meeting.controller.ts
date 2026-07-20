// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  AttachmentCategory,
  AttachmentDownloadUrlResponse,
  CreateMeetingAttachmentRequest,
  PastMeeting,
  PastMeetingAttachment,
  PastMeetingRecording,
  PastMeetingSummary,
  PastMeetingTranscript,
  PastMeetingTranscriptContent,
  PresignAttachmentRequest,
  PresignAttachmentResponse,
  UpdatePastMeetingSummaryRequest,
} from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { validateUidParameter } from '../helpers/validation.helper';
import { AccessCheckService } from '../services/access-check.service';
import { logger } from '../services/logger.service';
import { MeetingService } from '../services/meeting.service';

/**
 * Controller for handling past meeting HTTP requests
 */
export class PastMeetingController {
  private meetingService: MeetingService = new MeetingService();
  private accessCheckService: AccessCheckService = new AccessCheckService();

  /**
   * GET /past-meetings
   *
   * Returns project/foundation-scoped past meetings without per-meeting participant
   * enrichment. Participant counts (`participant_count`, `attended_count`,
   * `individual_registrants_count`, `committee_members_count`) are lazy-loaded per card
   * on the client via `meeting-rsvp-details` when the card enters the viewport.
   */
  public async getPastMeetings(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_past_meetings', {
      query_params: logger.sanitize(req.query as Record<string, any>),
    });

    try {
      const { data: meetings, page_token } = (await this.meetingService.getMeetings(req, req.query as Record<string, any>, 'v1_past_meeting')) as {
        data: PastMeeting[];
        page_token?: string;
      };

      logger.success(req, 'get_past_meetings', startTime, {
        meeting_count: meetings.length,
        has_more_pages: !!page_token,
      });

      res.json({ data: meetings, page_token });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /past-meetings/count
   */
  public async getPastMeetingsCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_past_meetings_count', {
      query_params: logger.sanitize(req.query as Record<string, any>),
    });

    try {
      const count = await this.meetingService.getMeetingsCount(req, req.query as Record<string, any>, 'v1_past_meeting');

      logger.success(req, 'get_past_meetings_count', startTime, { count });
      res.json({ count });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /past-meetings/:uid
   */
  public async getPastMeetingById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;

    const startTime = logger.startOperation(req, 'get_past_meeting_by_id', {
      past_meeting_id: uid,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_past_meeting_by_id',
          service: 'past_meeting_controller',
        })
      ) {
        return;
      }

      const meeting = await this.meetingService.getPastMeetingById(req, uid);

      if (req.oidc?.isAuthenticated()) {
        try {
          const meetingWithAccess = await this.accessCheckService.addAccessToResource(
            req,
            { ...meeting, id: meeting.meeting_and_occurrence_id ?? uid },
            'v1_past_meeting',
            'organizer'
          );
          meeting.organizer = meetingWithAccess.organizer ?? false;
        } catch {
          meeting.organizer = false;
        }
      }

      const counts = await this.addParticipantsCount(req, uid);
      meeting.individual_registrants_count = counts.individual_registrants_count;
      meeting.committee_members_count = counts.committee_members_count;
      meeting.participant_count = counts.participant_count;
      meeting.attended_count = counts.attended_count;

      logger.success(req, 'get_past_meeting_by_id', startTime, {
        past_meeting_id: uid,
        title: meeting.title,
      });

      res.json(meeting);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /past-meetings/:uid/participants
   */
  public async getPastMeetingParticipants(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_past_meeting_participants', {
      past_meeting_id: uid,
    });

    try {
      // Check if the past meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_past_meeting_participants',
          service: 'past_meeting_controller',
        })
      ) {
        return;
      }

      // Get the past meeting participants
      const participants = await this.meetingService.getPastMeetingParticipants(req, uid);

      // Log the success
      logger.success(req, 'get_past_meeting_participants', startTime, {
        past_meeting_id: uid,
        participant_count: participants.length,
      });

      // Send the participants data to the client
      res.json(participants);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /past-meetings/:uid/recording
   */
  public async getPastMeetingRecording(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_past_meeting_recording', {
      past_meeting_id: uid,
    });

    try {
      // Check if the past meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_past_meeting_recording',
          service: 'past_meeting_controller',
        })
      ) {
        return;
      }

      // Get the past meeting recording
      const recording: PastMeetingRecording | null = await this.meetingService.getPastMeetingRecording(req, uid);

      // If no recording found, return 404
      if (!recording) {
        res.status(404).json({
          error: 'Not Found',
          message: `No recording found for past meeting ${uid}`,
        });
        return;
      }

      // Log the success
      logger.success(req, 'get_past_meeting_recording', startTime, {
        past_meeting_id: uid,
        recording_uid: recording.uid,
        recording_count: recording.recording_count,
        session_count: recording.sessions?.length || 0,
      });

      // Send the recording data to the client
      res.json(recording);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /past-meetings/:uid/transcript
   */
  public async getPastMeetingTranscript(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_past_meeting_transcript', {
      past_meeting_id: uid,
    });

    try {
      // Check if the past meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_past_meeting_transcript',
          service: 'past_meeting_controller',
        })
      ) {
        return;
      }

      // Get the past meeting transcript
      const transcript: PastMeetingTranscript | null = await this.meetingService.getPastMeetingTranscript(req, uid);

      // If no transcript found, return 404
      if (!transcript) {
        res.status(404).json({
          error: 'Not Found',
          message: `No transcript found for past meeting ${uid}`,
        });
        return;
      }

      // Log the success
      logger.success(req, 'get_past_meeting_transcript', startTime, {
        past_meeting_id: uid,
        session_count: transcript.sessions?.length || 0,
      });

      // Send the transcript data to the client
      res.json(transcript);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /past-meetings/:uid/transcript/content
   */
  public async getPastMeetingTranscriptContent(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_past_meeting_transcript_content', {
      past_meeting_id: uid,
    });

    try {
      // Check if the past meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_past_meeting_transcript_content',
          service: 'past_meeting_controller',
        })
      ) {
        return;
      }

      // Get the past meeting transcript content
      const transcript: PastMeetingTranscriptContent | null = await this.meetingService.getPastMeetingTranscriptContent(req, uid);

      // If no transcript content found, return 404
      if (!transcript) {
        res.status(404).json({
          error: 'Not Found',
          message: `No transcript content found for past meeting ${uid}`,
        });
        return;
      }

      // Log the success
      logger.success(req, 'get_past_meeting_transcript_content', startTime, {
        past_meeting_id: uid,
        content_length: transcript.content?.length || 0,
      });

      // Send the transcript content to the client
      res.json(transcript);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /past-meetings/:uid/summary
   */
  public async getPastMeetingSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_past_meeting_summary', {
      past_meeting_id: uid,
    });

    try {
      // Check if the past meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_past_meeting_summary',
          service: 'past_meeting_controller',
        })
      ) {
        return;
      }

      // Get the past meeting summary
      const summary: PastMeetingSummary | null = await this.meetingService.getPastMeetingSummary(req, uid);

      // If no summary found, return 404
      if (!summary) {
        res.status(404).json({
          error: 'Not Found',
          message: `No summary found for past meeting ${uid}`,
        });
        return;
      }

      // Log the success
      logger.success(req, 'get_past_meeting_summary', startTime, {
        past_meeting_id: uid,
        summary_uid: summary.uid,
        approved: summary.approved,
        requires_approval: summary.requires_approval,
      });

      // Send the summary data to the client
      res.json(summary);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /past-meetings/:uid/attachments
   */
  public async getPastMeetingAttachments(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_past_meeting_attachments', {
      past_meeting_id: uid,
    });

    try {
      // Check if the past meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_past_meeting_attachments',
          service: 'past_meeting_controller',
        })
      ) {
        return;
      }

      // Get the past meeting attachments
      const attachments = await this.meetingService.getPastMeetingAttachments(req, uid);

      // Log the success
      logger.success(req, 'get_past_meeting_attachments', startTime, {
        past_meeting_id: uid,
        attachment_count: attachments.length,
      });

      // Send the attachments data to the client
      res.json(attachments);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /past-meetings/:uid/summary/:summaryUid
   */
  public async updatePastMeetingSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, summaryUid } = req.params;
    const startTime = logger.startOperation(req, 'update_past_meeting_summary', {
      past_meeting_id: uid,
      summary_uid: summaryUid,
    });

    try {
      // Check if the past meeting UID and summary UID are provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'update_past_meeting_summary',
          service: 'past_meeting_controller',
        }) ||
        !validateUidParameter(summaryUid, req, next, {
          operation: 'update_past_meeting_summary',
          service: 'past_meeting_controller',
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
      logger.success(req, 'update_past_meeting_summary', startTime, {
        past_meeting_id: uid,
        summary_uid: summaryUid,
      });

      // Send the updated summary data to the client
      res.json(updatedSummary);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /past-meetings/:uid/attachments/:attachmentId
   */
  public async getPastMeetingAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, attachmentId } = req.params;
    const startTime = logger.startOperation(req, 'get_past_meeting_attachment', {
      past_meeting_id: uid,
      attachment_id: attachmentId,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_past_meeting_attachment',
          service: 'past_meeting_controller',
        }) ||
        !validateUidParameter(attachmentId, req, next, {
          operation: 'get_past_meeting_attachment',
          service: 'past_meeting_controller',
        })
      ) {
        return;
      }

      const attachment: PastMeetingAttachment = await this.meetingService.getPastMeetingAttachmentInfo(req, uid, attachmentId);

      logger.success(req, 'get_past_meeting_attachment', startTime, {
        past_meeting_id: uid,
        attachment_id: attachmentId,
      });

      res.json(attachment);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /past-meetings/:uid/attachments/:attachmentId/download
   */
  public async getPastMeetingAttachmentDownloadUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, attachmentId } = req.params;
    const startTime = logger.startOperation(req, 'get_past_meeting_attachment_download_url', {
      past_meeting_id: uid,
      attachment_id: attachmentId,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_past_meeting_attachment_download_url',
          service: 'past_meeting_controller',
        }) ||
        !validateUidParameter(attachmentId, req, next, {
          operation: 'get_past_meeting_attachment_download_url',
          service: 'past_meeting_controller',
        })
      ) {
        return;
      }

      const result: AttachmentDownloadUrlResponse = await this.meetingService.getPastMeetingAttachmentDownloadUrl(req, uid, attachmentId);

      logger.success(req, 'get_past_meeting_attachment_download_url', startTime, {
        past_meeting_id: uid,
        attachment_id: attachmentId,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /past-meetings/:uid/attachments
   * Authorization (organizer-only) is enforced by lfx-v2-meeting-service on the ITX endpoint.
   */
  public async createPastMeetingAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const attachmentData: CreateMeetingAttachmentRequest = req.body;
    const startTime = logger.startOperation(req, 'create_past_meeting_attachment', {
      past_meeting_id: uid,
      type: attachmentData.type,
      name: attachmentData.name,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'create_past_meeting_attachment',
          service: 'past_meeting_controller',
        })
      ) {
        return;
      }

      if (!attachmentData.type || !attachmentData.name) {
        const errors: Record<string, string> = {};
        if (!attachmentData.type) errors['type'] = 'type is required';
        if (!attachmentData.name) errors['name'] = 'name is required';
        return next(ServiceValidationError.fromFieldErrors(errors));
      }

      const attachment = await this.meetingService.createPastMeetingAttachment(req, uid, attachmentData);

      logger.success(req, 'create_past_meeting_attachment', startTime, {
        attachment_uid: attachment.uid,
        past_meeting_id: uid,
        type: attachment.type,
      });

      res.status(201).json(attachment);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /past-meetings/:uid/attachments/presign
   * Authorization (organizer-only) is enforced by lfx-v2-meeting-service on the ITX endpoint.
   */
  public async presignPastMeetingAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const presignData: PresignAttachmentRequest = req.body;
    const startTime = logger.startOperation(req, 'presign_past_meeting_attachment', {
      past_meeting_id: uid,
      file_name: presignData.name,
      file_size: presignData.file_size,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'presign_past_meeting_attachment',
          service: 'past_meeting_controller',
        })
      ) {
        return;
      }

      if (!presignData.name || !presignData.file_size || !presignData.file_type) {
        const errors: Record<string, string> = {};
        if (!presignData.name) errors['name'] = 'name is required';
        if (!presignData.file_size) errors['file_size'] = 'file_size is required';
        if (!presignData.file_type) errors['file_type'] = 'file_type is required';
        return next(ServiceValidationError.fromFieldErrors(errors));
      }

      if (typeof presignData.file_size !== 'number' || isNaN(presignData.file_size) || presignData.file_size <= 0) {
        return next(
          ServiceValidationError.forField('file_size', 'File size must be a positive number', {
            operation: 'presign_past_meeting_attachment',
            service: 'past_meeting_controller',
          })
        );
      }

      const result: PresignAttachmentResponse = await this.meetingService.presignPastMeetingAttachment(req, uid, presignData);

      logger.success(req, 'presign_past_meeting_attachment', startTime, {
        past_meeting_id: uid,
        attachment_uid: result.uid,
        file_name: presignData.name,
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /past-meetings/:uid/attachments/upload
   * Authorization (organizer-only) is enforced by lfx-v2-meeting-service on the ITX endpoint.
   */
  public async uploadPastMeetingAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const { name, file_size, file_type, category, description } = req.query as Record<string, string>;
    const startTime = logger.startOperation(req, 'upload_past_meeting_attachment', {
      past_meeting_id: uid,
      file_name: name,
      file_size,
      file_type,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'upload_past_meeting_attachment',
          service: 'past_meeting_controller',
        })
      ) {
        return;
      }

      if (!name || !file_size || !file_type) {
        const errors: Record<string, string> = {};
        if (!name) errors['name'] = 'name is required';
        if (!file_size) errors['file_size'] = 'file_size is required';
        if (!file_type) errors['file_type'] = 'file_type is required';
        return next(ServiceValidationError.fromFieldErrors(errors));
      }

      const fileBuffer = req.body as Buffer;
      const fileSizeNum = parseInt(file_size, 10);

      if (isNaN(fileSizeNum) || fileSizeNum <= 0) {
        return next(
          ServiceValidationError.forField('file_size', 'File size must be a positive number', {
            operation: 'upload_past_meeting_attachment',
            service: 'past_meeting_controller',
          })
        );
      }

      if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
        return next(
          ServiceValidationError.forField('body', 'Request body must contain file data', {
            operation: 'upload_past_meeting_attachment',
            service: 'past_meeting_controller',
          })
        );
      }

      const presignData: PresignAttachmentRequest = {
        name,
        file_size: fileSizeNum,
        file_type,
        ...(category && { category: category as AttachmentCategory }),
        ...(description && { description }),
      };

      const result = await this.meetingService.uploadPastMeetingAttachment(req, uid, fileBuffer, presignData);

      logger.success(req, 'upload_past_meeting_attachment', startTime, {
        past_meeting_id: uid,
        attachment_uid: result.uid,
        file_name: name,
        file_size: fileSizeNum,
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /past-meetings/:uid/attachments/:attachmentId
   * Authorization (organizer-only) is enforced by lfx-v2-meeting-service on the ITX endpoint.
   */
  public async deletePastMeetingAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, attachmentId } = req.params;
    const startTime = logger.startOperation(req, 'delete_past_meeting_attachment', {
      past_meeting_id: uid,
      attachment_id: attachmentId,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'delete_past_meeting_attachment',
          service: 'past_meeting_controller',
        })
      ) {
        return;
      }

      if (!attachmentId) {
        return next(
          ServiceValidationError.forField('attachmentId', 'Attachment ID is required', {
            operation: 'delete_past_meeting_attachment',
            service: 'past_meeting_controller',
          })
        );
      }

      await this.meetingService.deletePastMeetingAttachment(req, uid, attachmentId);

      logger.success(req, 'delete_past_meeting_attachment', startTime, {
        past_meeting_id: uid,
        attachment_id: attachmentId,
      });

      res.status(204).send();
    } catch (error) {
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
    const startTime = logger.startOperation(req, 'add_participant_counts', {
      past_meeting_id: pastMeetingUid,
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

      logger.success(req, 'add_participant_counts', startTime, {
        past_meeting_id: pastMeetingUid,
        invited_count: invitedCount,
        attended_count: attendedCount,
        total_count: totalParticipantCount,
      });

      return result;
    } catch (error) {
      // Log error but don't fail - default to 0 counts
      logger.error(req, 'add_participant_counts', startTime, error, {
        past_meeting_id: pastMeetingUid,
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
