// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isUuid } from '@lfx-one/shared';
import {
  BatchRegistrantOperationResponse,
  Committee,
  CommitteeMember,
  CreateMeetingRegistrantRequest,
  CreateMeetingRequest,
  CreateMeetingRsvpRequest,
  GenerateAgendaResponse,
  MeetingRegistrant,
  UpdateMeetingRegistrantRequest,
  UpdateMeetingRequest,
} from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { addInvitedStatusToMeeting, addInvitedStatusToMeetings } from '../helpers/meeting.helper';
import { validateUidParameter } from '../helpers/validation.helper';
import { AiService } from '../services/ai.service';
import { CommitteeService } from '../services/committee.service';
import { logger } from '../services/logger.service';
import { MeetingService } from '../services/meeting.service';
import { generateM2MToken } from '../utils/m2m-token.util';

/**
 * Controller for handling meeting HTTP requests
 */
export class MeetingController {
  private meetingService: MeetingService = new MeetingService();
  private aiService: AiService = new AiService();
  private committeeService: CommitteeService = new CommitteeService();

  /**
   * GET /meetings
   */
  public async getMeetings(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_meetings', {
      query_params: logger.sanitize(req.query as Record<string, any>),
    });

    try {
      // TODO(v1-migration): Remove V1 meeting fetch once all meetings are migrated to V2
      // Get both 'meeting' and 'v1_meeting' types in parallel
      const [regularMeetings, v1Meetings] = await Promise.all([
        this.meetingService.getMeetings(req, req.query as Record<string, any>, 'meeting', true),
        this.meetingService.getMeetings(req, req.query as Record<string, any>, 'v1_meeting', true),
      ]);

      // Combine the meetings
      const meetings = [...regularMeetings, ...v1Meetings];

      // TODO: Remove this once we have a way to get the registrants count
      const counts = await Promise.all(
        meetings.map(async (m) => {
          if (!m.organizer) {
            return {
              individual_registrants_count: 0,
              committee_members_count: 0,
            };
          }

          const registrants = await this.meetingService.getMeetingRegistrants(req, m.uid);
          const committeeMembers = registrants.filter((r) => r.type === 'committee').length ?? 0;

          return {
            individual_registrants_count: registrants.length - committeeMembers,
            committee_members_count: committeeMembers,
          };
        })
      );

      // Check if the user is invited to the meeting
      const userEmail = (req.oidc.user?.['email'] as string) || '';
      const invitedMeetings = await addInvitedStatusToMeetings(req, meetings, userEmail);

      invitedMeetings.forEach((m, i) => {
        m.individual_registrants_count = counts[i].individual_registrants_count;
        m.committee_members_count = counts[i].committee_members_count;
      });

      // Log the success
      logger.success(req, 'get_meetings', startTime, {
        meeting_count: meetings.length,
        regular_meeting_count: regularMeetings.length,
        v1_meeting_count: v1Meetings.length,
      });

      // Send the meetings data to the client
      res.json(invitedMeetings);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /meetings/count
   */
  public async getMeetingsCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_meetings_count', {
      query_params: logger.sanitize(req.query as Record<string, any>),
    });

    try {
      // Get the meetings count
      const count = await this.meetingService.getMeetingsCount(req, req.query as Record<string, any>);

      // Log the success
      logger.success(req, 'get_meetings_count', startTime, {
        count,
      });

      // Send the count to the client
      res.json({ count });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /meetings/:uid
   */
  public async getMeetingById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_meeting_by_id', {
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
      logger.success(req, 'get_meeting_by_id', startTime, {
        meeting_uid: uid,
        project_uid: meeting.project_uid,
        title: meeting.title,
      });

      // TODO: Remove this once we have a way to get the registrants count
      try {
        const registrants = await this.meetingService.getMeetingRegistrants(req, meeting.uid);
        const committeeMembers = registrants.filter((r) => r.type === 'committee').length ?? 0;

        meeting.individual_registrants_count = registrants.length - committeeMembers;
        meeting.committee_members_count = committeeMembers;
      } catch (error) {
        // Log the error for registrants fetch failure
        logger.error(req, 'get_meeting_by_id', startTime, error, {
          meeting_uid: uid,
        });
      }

      // Check if the user is invited to the meeting
      const userEmail = (req.oidc.user?.['email'] as string) || '';
      const meetingWithInvitedStatus = await addInvitedStatusToMeeting(req, meeting, userEmail);

      // Send the meeting data to the client
      res.json(meetingWithInvitedStatus);
    } catch (error) {
      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * POST /meetings
   */
  public async createMeeting(req: Request, res: Response, next: NextFunction): Promise<void> {
    const meetingData: CreateMeetingRequest = req.body;
    const startTime = logger.startOperation(req, 'create_meeting', {
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
      logger.success(req, 'create_meeting', startTime, {
        meeting_id: meeting.uid,
        project_uid: meeting.project_uid,
        title: meeting.title,
      });

      // Send the new meeting data to the client
      res.status(201).json(meeting);
    } catch (error) {
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
    const startTime = logger.startOperation(req, 'update_meeting', {
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
      logger.success(req, 'update_meeting', startTime, {
        meeting_uid: uid,
        project_uid: meeting.project_uid,
        title: meeting.title,
        edit_type: editType || 'single',
      });

      // Send the updated meeting data to the client
      res.json(meeting);
    } catch (error) {
      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * DELETE /meetings/:uid
   */
  public async deleteMeeting(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'delete_meeting', {
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
      logger.success(req, 'delete_meeting', startTime, {
        meeting_uid: uid,
        status_code: 204,
      });

      // Send the response to the client
      res.status(204).send();
    } catch (error) {
      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * DELETE /meetings/:uid/occurrences/:occurrenceId
   */
  public async cancelOccurrence(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, occurrenceId } = req.params;
    const startTime = logger.startOperation(req, 'cancel_occurrence', {
      meeting_uid: uid,
      occurrence_id: occurrenceId,
    });

    try {
      // Check if the meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'cancel_occurrence',
          service: 'meeting_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      // Check if the occurrence ID is provided
      if (!occurrenceId) {
        const validationError = ServiceValidationError.forField('occurrenceId', 'Occurrence ID is required', {
          operation: 'cancel_occurrence',
          service: 'meeting_controller',
        });

        return next(validationError);
      }

      // Cancel the occurrence
      await this.meetingService.cancelOccurrence(req, uid, occurrenceId);

      // Log the success
      logger.success(req, 'cancel_occurrence', startTime, {
        meeting_uid: uid,
        occurrence_id: occurrenceId,
        status_code: 204,
      });

      // Send the response to the client
      res.status(204).send();
    } catch (error) {
      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * GET /meetings/:uid/registrants
   */
  public async getMeetingRegistrants(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const { include_rsvp } = req.query;
    const includeRsvp = include_rsvp === 'true';

    const startTime = logger.startOperation(req, 'get_meeting_registrants', {
      meeting_uid: uid,
      include_rsvp: includeRsvp,
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
      const registrants = await this.meetingService.getMeetingRegistrants(req, uid, includeRsvp);

      logger.success(req, 'get_meeting_registrants', startTime, {
        meeting_uid: uid,
        registrant_count: registrants.length,
        include_rsvp: includeRsvp,
      });

      // Send the registrants data to the client
      res.json(registrants);
    } catch (error) {
      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * GET /meetings/:uid/my-meeting-registrants
   * Retrieves registrants for a meeting with access control based on show_meeting_attendees setting
   * Only returns registrants if the authenticated user is a registrant of the meeting
   * Not supported for v1 legacy meetings
   */
  public async getMyMeetingRegistrants(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const { include_rsvp } = req.query;
    const includeRsvp = include_rsvp === 'true';

    // Check if this is a v1 meeting - not supported
    const v1 = !isUuid(uid);

    const startTime = logger.startOperation(req, 'get_my_meeting_registrants', {
      meeting_uid: uid,
      include_rsvp: includeRsvp,
      v1,
    });

    try {
      // Check if the meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_my_meeting_registrants',
          service: 'meeting_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      // Step 1: Get the meeting to check show_meeting_attendees setting
      // V1 meetings are treated as if show_meeting_attendees is true
      logger.debug(req, 'get_my_meeting_registrants', 'Fetching meeting details', { meeting_uid: uid, v1 });
      const meetingType = v1 ? 'v1_meeting' : 'meeting';
      const meeting = await this.meetingService.getMeetingById(req, uid, meetingType, false);
      if (!meeting) {
        logger.success(req, 'get_my_meeting_registrants', startTime, {
          meeting_uid: uid,
          meeting_not_found: true,
          registrant_count: 0,
        });
        res.json([]);
        return;
      }

      // V1 meetings are treated as having show_meeting_attendees enabled
      const showMeetingAttendees = v1 ? true : meeting.show_meeting_attendees;

      logger.debug(req, 'get_my_meeting_registrants', 'Meeting found, checking show_meeting_attendees', {
        ...meeting,
        meeting_uid: uid,
        show_meeting_attendees: showMeetingAttendees,
        v1,
      });

      // Step 2-4: Check if show_meeting_attendees is enabled (V1 meetings always pass this check)
      if (!showMeetingAttendees) {
        logger.success(req, 'get_my_meeting_registrants', startTime, {
          meeting_uid: uid,
          show_meeting_attendees: false,
          registrant_count: 0,
        });
        res.json([]);
        return;
      }

      // Step 5: Check if current user is a registrant (access control)
      const userEmail = req.oidc?.user?.['email'] as string | undefined;

      logger.debug(req, 'get_my_meeting_registrants', 'Checking user authentication', {
        meeting_uid: uid,
        has_email: !!userEmail,
        user_email: userEmail,
      });

      if (!userEmail) {
        logger.success(req, 'get_my_meeting_registrants', startTime, {
          meeting_uid: uid,
          no_email: true,
          registrant_count: 0,
        });
        res.json([]);
        return;
      }

      // Save original token and setup M2M token for privileged access
      const originalToken = req.bearerToken;
      const m2mToken = await generateM2MToken(req);
      req.bearerToken = m2mToken;

      // Use tags_all to filter by both meeting_uid and email
      logger.debug(req, 'get_my_meeting_registrants', 'Checking if user is a registrant', {
        meeting_uid: uid,
        user_email: userEmail,
      });
      const userRegistrantCheck = await this.meetingService.getMeetingRegistrantsByEmail(req, uid, userEmail);

      logger.debug(req, 'get_my_meeting_registrants', 'User registrant check complete', {
        meeting_uid: uid,
        user_email: userEmail,
        registrant_count: userRegistrantCheck.resources?.length || 0,
      });

      // Step 6: If user is not a registrant, return empty array
      if (!userRegistrantCheck.resources || userRegistrantCheck.resources.length === 0) {
        logger.success(req, 'get_my_meeting_registrants', startTime, {
          meeting_uid: uid,
          user_email: userEmail,
          is_registrant: false,
          registrant_count: 0,
        });
        res.json([]);
        return;
      }

      // Step 7: User is a registrant, fetch all registrants using M2M token
      logger.debug(req, 'get_my_meeting_registrants', 'User is a registrant, setting up M2M token', {
        meeting_uid: uid,
        user_email: userEmail,
        include_rsvp: includeRsvp,
      });

      logger.debug(req, 'get_my_meeting_registrants', 'M2M token generated, fetching all registrants', {
        meeting_uid: uid,
        has_m2m_token: !!m2mToken,
      });

      const registrants = await this.meetingService.getMeetingRegistrants(req, uid, includeRsvp);

      logger.debug(req, 'get_my_meeting_registrants', 'Fetched all registrants, enriching committee data', {
        meeting_uid: uid,
        registrant_count: registrants.length,
      });

      // Enrich committee registrant data with committee details and member info
      const enrichedRegistrants = await this.enrichCommitteeRegistrants(req, registrants);

      // Restore original token (delete if it was undefined to avoid leaving M2M token)
      if (originalToken !== undefined) {
        req.bearerToken = originalToken;
      } else {
        delete req.bearerToken;
      }

      logger.success(req, 'get_my_meeting_registrants', startTime, {
        meeting_uid: uid,
        user_email: userEmail,
        is_registrant: true,
        registrant_count: enrichedRegistrants.length,
        include_rsvp: includeRsvp,
      });

      // Send the registrants data to the client
      res.json(enrichedRegistrants);
    } catch (error) {
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

    const startTime = logger.startOperation(req, 'add_meeting_registrants', {
      meeting_uid: uid,
      registrant_count: registrantData.length,
      body_size: JSON.stringify(req.body).length,
    });

    try {
      // Check if the meeting UID is provided
      if (!uid) {
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
      const { results, shouldReturn } = await this.processRegistrantOperations(req, next, 'add_meeting_registrants', uid, registrantData, (registrant) =>
        this.meetingService.addMeetingRegistrant(req, registrant)
      );

      // If the processing should return, return
      if (shouldReturn) return;

      // Create batch response
      const batchResponse = this.createBatchResponse(results, registrantData, req, startTime, 'add_meeting_registrants', uid, (registrant) => registrant.email);

      // Log the success
      logger.success(req, 'add_meeting_registrants', startTime, {
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

    const startTime = logger.startOperation(req, 'update_meeting_registrants', {
      meeting_uid: uid,
      registrant_count: updateData.length,
      body_size: JSON.stringify(req.body).length,
    });

    try {
      // Check if the meeting UID is provided
      if (!uid) {
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
        const validationError = ServiceValidationError.forField('registrants.uid', 'One or more registrants are missing UID', {
          operation: 'update_meeting_registrants',
          service: 'meeting_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Process updates with fail-fast for 403 errors
      const { results, shouldReturn } = await this.processRegistrantOperations(req, next, 'update_meeting_registrants', uid, updateData, (update) =>
        this.meetingService.updateMeetingRegistrant(req, uid, update.uid, update.changes)
      );

      // If the processing should return, return
      if (shouldReturn) return;

      // Create the batch response
      const batchResponse = this.createBatchResponse(results, updateData, req, startTime, 'update_meeting_registrants', uid, (update) => update.uid);

      // Log the success
      logger.success(req, 'update_meeting_registrants', startTime, {
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

    const startTime = logger.startOperation(req, 'delete_meeting_registrants', {
      meeting_uid: uid,
      registrant_count: registrantsUid.length,
      body_size: JSON.stringify(req.body).length,
    });

    try {
      // Check if the meeting UID is provided
      if (!uid) {
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
      const { results, shouldReturn } = await this.processRegistrantOperations(req, next, 'delete_meeting_registrants', uid, registrantsUid, (registrantUid) =>
        this.meetingService.deleteMeetingRegistrant(req, uid, registrantUid).then(() => registrantUid)
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
      logger.success(req, 'delete_meeting_registrants', startTime, {
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
      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * POST /meetings/:uid/registrants/:registrantId/resend
   */
  public async resendMeetingInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, registrantId } = req.params;
    const startTime = logger.startOperation(req, 'resend_meeting_invitation', {
      meeting_uid: uid,
      registrant_id: registrantId,
    });

    try {
      // Validate meeting ID parameter
      if (!uid) {
        const validationError = ServiceValidationError.forField('uid', 'Meeting ID is required', {
          operation: 'resend_meeting_invitation',
          service: 'meeting_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Validate registrant ID parameter
      if (!registrantId) {
        const validationError = ServiceValidationError.forField('registrantId', 'Registrant ID is required', {
          operation: 'resend_meeting_invitation',
          service: 'meeting_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Call the meeting service to resend the invitation
      await this.meetingService.resendMeetingInvitation(req, uid, registrantId);

      // Log the success
      logger.success(req, 'resend_meeting_invitation', startTime, {
        meeting_uid: uid,
        registrant_id: registrantId,
      });

      // Send success response
      res.status(200).json({
        message: 'Invitation resent successfully',
      });
    } catch (error) {
      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * POST /meetings/:uid/rsvp
   */
  public async createMeetingRsvp(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const rsvpData: CreateMeetingRsvpRequest = req.body;

    const startTime = logger.startOperation(req, 'create_meeting_rsvp', {
      meeting_uid: uid,
      registrant_id: rsvpData.registrant_id,
      response: rsvpData.response,
      scope: rsvpData.scope,
    });

    try {
      // Validate meeting UID
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'create_meeting_rsvp',
        })
      ) {
        return;
      }

      // Validate RSVP data
      if (!rsvpData.response || !rsvpData.scope) {
        throw ServiceValidationError.fromFieldErrors(
          {
            response: !rsvpData.response ? 'Response is required' : [],
            scope: !rsvpData.scope ? 'Scope is required' : [],
          },
          'RSVP data validation failed',
          {
            operation: 'create_meeting_rsvp',
            service: 'meeting_controller',
          }
        );
      }

      // Create the RSVP
      const rsvp = await this.meetingService.createMeetingRsvp(req, uid, rsvpData);

      // Log success
      logger.success(req, 'create_meeting_rsvp', startTime, {
        rsvp_id: rsvp.id,
      });

      // Send response
      res.json(rsvp);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /meetings/:uid/rsvp/me
   * Gets current user's RSVP by calling meeting service directly with M2M token
   */
  public async getMeetingRsvpByUsername(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const { occurrenceId } = req.query;

    const startTime = logger.startOperation(req, 'get_meeting_rsvp_by_username', {
      meeting_uid: uid,
      occurrence_id: occurrenceId,
    });

    try {
      // Validate meeting UID
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_meeting_rsvp_by_username',
        })
      ) {
        return;
      }

      // Get the user's RSVP using direct meeting service call
      const rsvp = await this.meetingService.getMeetingRsvpByUsername(req, uid, occurrenceId as string | undefined);

      // Log success
      logger.success(req, 'get_meeting_rsvp_by_username', startTime, {
        found: !!rsvp,
        rsvp_id: rsvp?.id,
        occurrence_id: occurrenceId,
      });

      // Send response
      res.json(rsvp);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /meetings/:uid/rsvp
   */
  public async getMeetingRsvps(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;

    const startTime = logger.startOperation(req, 'get_meeting_rsvps', {
      meeting_uid: uid,
    });

    try {
      // Validate meeting UID
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_meeting_rsvps',
        })
      ) {
        return;
      }

      // Get all RSVPs for the meeting
      const rsvps = await this.meetingService.getMeetingRsvps(req, uid);

      // Log success
      logger.success(req, 'get_meeting_rsvps', startTime, {
        count: rsvps.length,
      });

      // Send response
      res.json(rsvps);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /meetings/:uid/attachments
   */
  public async createMeetingAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const attachmentData = req.body;

    const startTime = logger.startOperation(req, 'create_meeting_attachment', {
      meeting_uid: uid,
      type: attachmentData.type,
      name: attachmentData.name,
    });

    try {
      // Validate meeting UID
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'create_meeting_attachment',
          service: 'meeting_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      // Validate attachment data
      if (!attachmentData.type || !attachmentData.name) {
        const validationError = ServiceValidationError.fromFieldErrors(
          {
            type: !attachmentData.type ? 'Type is required' : [],
            name: !attachmentData.name ? 'Name is required' : [],
          },
          'Attachment data validation failed',
          {
            operation: 'create_meeting_attachment',
            service: 'meeting_controller',
            path: req.path,
          }
        );

        return next(validationError);
      }

      // Create FormData for multipart/form-data request
      const formDataClass = (await import('form-data')).default;
      const formData = new formDataClass();
      formData.append('type', attachmentData.type);
      formData.append('name', attachmentData.name);

      // If file data is provided, include it (base64 encoded file from client)
      if (attachmentData.file) {
        const buffer = Buffer.from(attachmentData.file, 'base64');
        formData.append('file', buffer, {
          filename: attachmentData.name,
          contentType: attachmentData.file_content_type || 'application/octet-stream',
        });
      }

      // If link is provided instead of file, include it
      if (attachmentData.link) {
        formData.append('link', attachmentData.link);
      }

      // Create attachment via LFX V2 API
      const attachment = await this.meetingService.createMeetingAttachment(req, uid, formData);

      logger.success(req, 'create_meeting_attachment', startTime, {
        attachment_uid: attachment.uid,
        meeting_uid: uid,
      });

      res.status(201).json(attachment);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /meetings/:uid/attachments/:attachmentId
   * Query params:
   * - download: 'true' to force download (attachment), omit or 'false' to view inline
   */
  public async getMeetingAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, attachmentId } = req.params;
    const { download } = req.query;

    const startTime = logger.startOperation(req, 'get_meeting_attachment', {
      meeting_uid: uid,
      attachment_id: attachmentId,
      download_mode: download === 'true' ? 'download' : 'inline',
    });

    try {
      // Validate meeting UID
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_meeting_attachment',
          service: 'meeting_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      // Validate attachment ID
      if (!attachmentId) {
        const validationError = ServiceValidationError.forField('attachmentId', 'Attachment ID is required', {
          operation: 'get_meeting_attachment',
          service: 'meeting_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Get attachment file data via LFX V2 API (downloads file)
      // The LFX V2 API returns the file with proper Content-Type and Content-Disposition headers
      const attachmentData = await this.meetingService.getMeetingAttachment(req, uid, attachmentId);

      // Get metadata to set proper filename (fetch in parallel with file data, but don't fail if metadata fails)
      let filename = 'download';
      let contentType = 'application/octet-stream';

      try {
        const metadata = await this.meetingService.getMeetingAttachmentMetadata(req, uid, attachmentId);
        filename = metadata.name || filename;
        contentType = metadata.mime_type || metadata.content_type || contentType;
      } catch (metadataError) {
        logger.warning(req, 'get_meeting_attachment_metadata', 'Failed to fetch metadata, using defaults', {
          meeting_uid: uid,
          attachment_id: attachmentId,
          error: metadataError instanceof Error ? metadataError.message : metadataError,
        });
      }

      logger.success(req, 'get_meeting_attachment', startTime, {
        meeting_uid: uid,
        attachment_id: attachmentId,
        status_code: 200,
      });

      // Set proper headers for file delivery
      res.setHeader('Content-Type', contentType);

      // Use RFC 5987 encoding for Content-Disposition filename
      // This properly handles spaces, special characters, and Unicode
      const encodedFilename = encodeURIComponent(filename);
      const disposition = download === 'true' ? 'attachment' : 'inline';
      res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodedFilename}`);

      res.setHeader('Content-Length', attachmentData.length.toString());

      // Send the buffer directly
      res.status(200).send(attachmentData);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /meetings/:uid/attachments/:attachmentId
   */
  public async deleteMeetingAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, attachmentId } = req.params;

    const startTime = logger.startOperation(req, 'delete_meeting_attachment', {
      meeting_uid: uid,
      attachment_id: attachmentId,
    });

    try {
      // Validate meeting UID
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'delete_meeting_attachment',
          service: 'meeting_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      // Validate attachment ID
      if (!attachmentId) {
        const validationError = ServiceValidationError.forField('attachmentId', 'Attachment ID is required', {
          operation: 'delete_meeting_attachment',
          service: 'meeting_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Delete attachment via LFX V2 API
      await this.meetingService.deleteMeetingAttachment(req, uid, attachmentId);

      logger.success(req, 'delete_meeting_attachment', startTime, {
        meeting_uid: uid,
        attachment_id: attachmentId,
        status_code: 204,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  public async getMeetingAttachmentMetadata(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, attachmentId } = req.params;

    const startTime = logger.startOperation(req, 'get_meeting_attachment_metadata', {
      meeting_uid: uid,
      attachment_id: attachmentId,
    });

    try {
      // Validate meeting UID
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_meeting_attachment_metadata',
          service: 'meeting_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      // Validate attachment ID
      if (!attachmentId) {
        const validationError = ServiceValidationError.forField('attachmentId', 'Attachment ID is required', {
          operation: 'get_meeting_attachment_metadata',
          service: 'meeting_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Get attachment metadata via LFX V2 API
      const metadata = await this.meetingService.getMeetingAttachmentMetadata(req, uid, attachmentId);

      logger.success(req, 'get_meeting_attachment_metadata', startTime, {
        meeting_uid: uid,
        attachment_id: attachmentId,
        status_code: 200,
      });

      res.status(200).json(metadata);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /meetings/:uid/attachments
   */
  public async getMeetingAttachments(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;

    const startTime = logger.startOperation(req, 'get_meeting_attachments', {
      meeting_uid: uid,
    });

    try {
      // Validate meeting UID
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_meeting_attachments',
          service: 'meeting_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      // Get attachments via Query Service
      const attachments = await this.meetingService.getMeetingAttachments(req, uid);

      logger.success(req, 'get_meeting_attachments', startTime, {
        meeting_uid: uid,
        attachment_count: attachments.length,
        status_code: 200,
      });

      res.status(200).json(attachments);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /meetings/past/:uid/attachments
   */
  public async getPastMeetingAttachments(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;

    const startTime = logger.startOperation(req, 'get_past_meeting_attachments', {
      past_meeting_uid: uid,
    });

    try {
      // Validate past meeting UID
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_past_meeting_attachments',
          service: 'meeting_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      // Get attachments via Query Service
      const attachments = await this.meetingService.getPastMeetingAttachments(req, uid);

      logger.success(req, 'get_past_meeting_attachments', startTime, {
        past_meeting_uid: uid,
        attachment_count: attachments.length,
        status_code: 200,
      });

      res.status(200).json(attachments);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /meetings/generate-agenda
   * Generate meeting agenda using AI
   */
  public async generateAgenda(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'generate_agenda', {
      meeting_type: req.body['meetingType'],
      has_context: !!req.body['context'],
    });

    try {
      const { meetingType, title, projectName, context } = req.body;

      // Validate required fields
      if (!meetingType || !title || !projectName) {
        const validationError = ServiceValidationError.fromFieldErrors(
          {
            meetingType: !meetingType ? 'Meeting type is required' : [],
            title: !title ? 'Title is required' : [],
            projectName: !projectName ? 'Project name is required' : [],
          },
          'Agenda generation validation failed',
          {
            operation: 'generate_agenda',
            service: 'meeting_controller',
            path: req.path,
          }
        );

        return next(validationError);
      }

      const response: GenerateAgendaResponse = await this.aiService.generateMeetingAgenda(req, {
        meetingType,
        title,
        projectName,
        context,
      });

      logger.success(req, 'generate_agenda', startTime, {
        estimated_duration: response.estimatedDuration,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Private helper to process registrant operations with fail-fast for 403 errors
   */
  private async processRegistrantOperations<T, R>(
    req: Request,
    next: NextFunction,
    operationName: string,
    meetingUid: string,
    inputData: T[],
    operation: (input: T) => Promise<R>
  ): Promise<{ results: PromiseSettledResult<R>[]; shouldReturn: boolean }> {
    const helperStartTime = logger.startOperation(req, `${operationName}_batch_processing`, {
      meeting_uid: meetingUid,
      batch_size: inputData.length,
    });

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

      logger.success(req, `${operationName}_batch_processing`, helperStartTime, {
        meeting_uid: meetingUid,
        batch_size: inputData.length,
        successful: results.filter((r) => r.status === 'fulfilled').length,
      });

      // Return the results and shouldReturn flag
      return { results, shouldReturn: false };
    } catch (error: any) {
      // Check if it's a 403 error - if so, fail fast
      // This will stop the processing if a 403 error is encountered
      if (error?.status === 403 || error?.statusCode === 403) {
        logger.error(req, `${operationName}_batch_processing`, helperStartTime, error, {
          meeting_uid: meetingUid,
          batch_size: inputData.length,
          error_type: '403_forbidden',
        });
        // Send the error to the next middleware
        next(error);
        return { results: [], shouldReturn: true };
      }

      // For other errors, log and continue processing the remaining items
      logger.error(req, `${operationName}_batch_processing`, helperStartTime, error, {
        meeting_uid: meetingUid,
        batch_size: inputData.length,
        error_type: 'partial_failure',
        continuing: true,
      });

      let results: PromiseSettledResult<R>[] = [{ status: 'rejected', reason: error }];

      if (inputData.length > 1) {
        const remainingResults = await Promise.allSettled(inputData.slice(1).map((input) => operation(input)));
        results = [...results, ...remainingResults];
      }

      // Return the results and shouldReturn flag
      return { results, shouldReturn: false };
    }
  }

  private createBatchResponse<T, I>(
    results: PromiseSettledResult<T>[],
    inputData: I[],
    req: Request,
    startTime: number,
    operationName: string,
    meetingUid: string,
    getIdentifier: (input: I, index?: number) => string
  ): BatchRegistrantOperationResponse<T> {
    const helperStartTime = logger.startOperation(req, `${operationName}_batch_response`, {
      meeting_uid: meetingUid,
      total_results: results.length,
    });

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
        logger.error(req, operationName, startTime, error, {
          meeting_uid: meetingUid,
          identifier: getIdentifier(inputData[index], index),
        });
      }
    });

    logger.success(req, `${operationName}_batch_response`, helperStartTime, {
      meeting_uid: meetingUid,
      total: inputData.length,
      successful: successes.length,
      failed: failures.length,
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

  /**
   * Enriches committee registrants with committee details and member information
   * For each committee registrant, fetches committee name/category and member voting/role/appointed_by
   */
  private async enrichCommitteeRegistrants(req: Request, registrants: MeetingRegistrant[]): Promise<MeetingRegistrant[]> {
    // Filter for committee type registrants
    const committeeRegistrants = registrants.filter((r) => r.type === 'committee' && r.committee_uid);

    if (committeeRegistrants.length === 0) {
      return registrants;
    }

    // Get unique committee UIDs
    const uniqueCommitteeUids = [
      ...new Set(committeeRegistrants.map((r) => r.committee_uid).filter((uid): uid is string => uid !== null && uid !== undefined)),
    ];

    logger.debug(req, 'enrich_committee_registrants', 'Enriching committee data', {
      total_registrants: registrants.length,
      committee_registrants: committeeRegistrants.length,
      unique_committees: uniqueCommitteeUids.length,
    });

    // Fetch committee details and members in parallel
    const [committees, membersByCommittee] = await Promise.all([
      // Fetch all committees
      Promise.all(
        uniqueCommitteeUids.map(async (uid) => {
          try {
            const committee = await this.committeeService.getCommitteeById(req, uid);
            return { uid, committee };
          } catch (error) {
            logger.warning(req, 'enrich_committee_registrants', 'Failed to fetch committee', {
              committee_uid: uid,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
            return { uid, committee: null };
          }
        })
      ),
      // Fetch all committee members
      Promise.all(
        uniqueCommitteeUids.map(async (uid) => {
          try {
            const members = await this.committeeService.getCommitteeMembers(req, uid);
            return { uid, members };
          } catch (error) {
            logger.warning(req, 'enrich_committee_registrants', 'Failed to fetch committee members', {
              committee_uid: uid,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
            return { uid, members: [] };
          }
        })
      ),
    ]);

    // Build lookup maps
    const committeeMap = new Map<string, Committee | null>();
    committees.forEach(({ uid, committee }) => committeeMap.set(uid, committee));

    const memberMap = new Map<string, CommitteeMember[]>();
    membersByCommittee.forEach(({ uid, members }) => memberMap.set(uid, members));

    // Enrich registrants
    return registrants.map((registrant) => {
      if (registrant.type !== 'committee' || !registrant.committee_uid) {
        return registrant;
      }

      const committee = committeeMap.get(registrant.committee_uid);
      const members = memberMap.get(registrant.committee_uid) || [];

      // Find the member by email
      const member = members.find((m) => m.email.toLowerCase() === registrant.email.toLowerCase());

      return {
        ...registrant,
        // Committee details
        committee_name: committee?.name || registrant.committee_name || null,
        committee_category: committee?.category || null,
        // Member details
        committee_role: member?.role?.name || registrant.committee_role || null,
        committee_voting_status: member?.voting?.status || null,
        committee_appointed_by: member?.appointed_by || null,
      };
    });
  }
}
