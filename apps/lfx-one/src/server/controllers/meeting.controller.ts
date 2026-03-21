// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  AttachmentCategory,
  BatchRegistrantOperationResponse,
  Committee,
  CommitteeMember,
  CreateMeetingAttachmentRequest,
  CreateMeetingRegistrantRequest,
  CreateMeetingRequest,
  CreateMeetingRsvpRequest,
  GenerateAgendaResponse,
  Meeting,
  MeetingRegistrant,
  PresignAttachmentRequest,
  UpdateMeetingAttachmentRequest,
  UpdateMeetingRegistrantRequest,
  UpdateMeetingRequest,
} from '@lfx-one/shared/interfaces';
import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { addInvitedStatusToMeeting, isUserInvitedToMeeting } from '../helpers/meeting.helper';
import { validateUidParameter } from '../helpers/validation.helper';
import { AiService } from '../services/ai.service';
import { CommitteeService } from '../services/committee.service';
import { logger } from '../services/logger.service';
import { MeetingService } from '../services/meeting.service';
import { NatsService } from '../services/nats.service';
import { getUsernameFromAuth, usernameMatches } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';

/**
 * Controller for handling meeting HTTP requests
 */
export class MeetingController {
  private meetingService: MeetingService = new MeetingService();
  private aiService: AiService = new AiService();
  private committeeService: CommitteeService = new CommitteeService();
  private natsService: NatsService = new NatsService();

  /**
   * GET /meetings
   */
  public async getMeetings(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_meetings', {
      query_params: logger.sanitize(req.query as Record<string, any>),
    });

    try {
      const skipRegistrants = req.query['skip_registrants'] === 'true';
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { skip_registrants: _skipReg, ...queryParams } = req.query as Record<string, any>;
      const { data: meetings, page_token } = await this.meetingService.getMeetings(req, queryParams, 'v1_meeting', true);

      if (skipRegistrants) {
        const normalizedMeetings = meetings.map((m: any) => ({
          ...m,
          invited: m.invited ?? false,
          individual_registrants_count: m.individual_registrants_count ?? 0,
          committee_members_count: m.committee_members_count ?? 0,
        }));
        logger.success(req, 'get_meetings', startTime, {
          meeting_count: normalizedMeetings.length,
          has_more_pages: !!page_token,
          skip_registrants: true,
        });
        res.json({ data: normalizedMeetings, page_token });
        return;
      }

      const userEmail = (req.oidc.user?.['email'] as string)?.toLowerCase() || '';
      const username = await getUsernameFromAuth(req);
      const registrantsByMeeting = await Promise.all(
        meetings.map(async (m) => {
          if (!m.organizer) {
            logger.debug(req, 'get_meetings', 'Skipping registrant fetch — no organizer', { meeting_id: m.id, title: m.title });
            return null;
          }
          return this.meetingService.getMeetingRegistrants(req, m.id).catch((error) => {
            logger.warning(req, 'get_meetings', 'Failed to fetch registrants for meeting', {
              meeting_id: m.id,
              title: m.title,
              err: error,
            });
            return null;
          });
        })
      );
      const meetingsNeedingInviteCheck: number[] = [];
      const result = meetings.map((m, i) => {
        const registrants = registrantsByMeeting[i];
        let individualCount = 0;
        let committeeCount = 0;
        let invited = false;
        if (registrants) {
          committeeCount = registrants.filter((r) => r.type === 'committee').length;
          individualCount = registrants.length - committeeCount;
          invited = registrants.some(
            (r) => (userEmail && r.email?.toLowerCase() === userEmail) || (username && r.username && usernameMatches(username, r.username))
          );
          logger.debug(req, 'get_meetings', 'Registrant counts computed', {
            meeting_id: m.id,
            title: m.title,
            total_registrants: registrants.length,
            individual_count: individualCount,
            committee_count: committeeCount,
            invited,
          });
        } else {
          // Registrants not available (non-organizer or fetch failed) — defer to invite check
          logger.debug(req, 'get_meetings', 'Registrants unavailable — deferring to invite check', {
            meeting_id: m.id,
            title: m.title,
            organizer: m.organizer,
          });
          meetingsNeedingInviteCheck.push(i);
        }
        return { ...m, individual_registrants_count: individualCount, committee_members_count: committeeCount, invited };
      });
      if (meetingsNeedingInviteCheck.length > 0 && (userEmail || username)) {
        const m2mToken = await generateM2MToken(req);
        await Promise.all(
          meetingsNeedingInviteCheck.map(async (idx) => {
            result[idx].invited = await isUserInvitedToMeeting(req, result[idx].id, userEmail, m2mToken).catch(() => false);
          })
        );
      }

      logger.success(req, 'get_meetings', startTime, {
        meeting_count: result.length,
        has_more_pages: !!page_token,
      });

      res.json({ data: result, page_token });
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
      const count = await this.meetingService.getMeetingsCount(req, req.query as Record<string, any>, 'v1_meeting');

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
      meeting_id: uid,
    });

    try {
      // Check if the meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_meeting_by_id',
          service: 'meeting_controller',
        })
      ) {
        return;
      }

      const meeting = await this.meetingService.getMeetingById(req, uid, 'v1_meeting');

      // Log the success
      logger.success(req, 'get_meeting_by_id', startTime, {
        meeting_id: uid,
        project_uid: meeting.project_uid,
        title: meeting.title,
      });

      const userEmail = (req.oidc.user?.['email'] as string) || '';

      // Run registrant counts and invited status check in parallel
      const [registrants, meetingWithInvitedStatus] = await Promise.all([
        // TODO: Remove this once we have a way to get the registrants count
        this.meetingService.getMeetingRegistrants(req, meeting.id).catch((error) => {
          logger.error(req, 'get_meeting_by_id', startTime, error, { meeting_id: uid });
          return null;
        }),
        addInvitedStatusToMeeting(req, meeting, userEmail),
      ]);

      if (registrants) {
        const committeeMembers = registrants.filter((r) => r.type === 'committee').length;
        meetingWithInvitedStatus.individual_registrants_count = registrants.length - committeeMembers;
        meetingWithInvitedStatus.committee_members_count = committeeMembers;
      } else {
        meetingWithInvitedStatus.individual_registrants_count = 0;
        meetingWithInvitedStatus.committee_members_count = 0;
      }

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
        meeting_id: meeting.id,
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
      meeting_id: uid,
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
        })
      ) {
        return;
      }

      // Update the meeting
      const response = await this.meetingService.updateMeeting(req, uid, meetingData, editType as 'single' | 'future');

      // Log the success
      logger.success(req, 'update_meeting', startTime, {
        meeting_id: uid,
        edit_type: editType || 'single',
        status_code: response.status,
      });

      // Forward the upstream status code to the client
      res.status(response.status).send();
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
      meeting_id: uid,
    });

    try {
      // Check if the meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'delete_meeting',
          service: 'meeting_controller',
        })
      ) {
        return;
      }

      // Delete the meeting
      await this.meetingService.deleteMeeting(req, uid);

      // Log the success
      logger.success(req, 'delete_meeting', startTime, {
        meeting_id: uid,
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
      meeting_id: uid,
      occurrence_id: occurrenceId,
    });

    try {
      // Check if the meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'cancel_occurrence',
          service: 'meeting_controller',
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
        meeting_id: uid,
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
      meeting_id: uid,
      include_rsvp: includeRsvp,
    });

    try {
      // Check if the meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_meeting_registrants',
          service: 'meeting_controller',
        })
      ) {
        return;
      }

      // Get the meeting registrants
      const registrants = await this.meetingService.getMeetingRegistrants(req, uid, includeRsvp);

      logger.success(req, 'get_meeting_registrants', startTime, {
        meeting_id: uid,
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
   */
  public async getMyMeetingRegistrants(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const { include_rsvp } = req.query;
    const includeRsvp = include_rsvp === 'true';

    const startTime = logger.startOperation(req, 'get_my_meeting_registrants', {
      meeting_id: uid,
      include_rsvp: includeRsvp,
    });

    try {
      // Check if the meeting UID is provided
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_my_meeting_registrants',
          service: 'meeting_controller',
        })
      ) {
        return;
      }

      // Step 1: Get the meeting with access check to determine organizer status
      logger.debug(req, 'get_my_meeting_registrants', 'Fetching meeting details with access check', { meeting_id: uid });
      const meeting = await this.meetingService.getMeetingById(req, uid, 'v1_meeting', true);
      if (!meeting) {
        logger.success(req, 'get_my_meeting_registrants', startTime, {
          meeting_id: uid,
          meeting_not_found: true,
          registrant_count: 0,
        });
        res.json([]);
        return;
      }

      // TODO: Reimplement show_meeting_attendees check
      // // All ITX meetings are treated as having show_meeting_attendees enabled
      // const showMeetingAttendees = meeting.show_meeting_attendees ?? false;

      // logger.debug(req, 'get_my_meeting_registrants', 'Meeting found, checking show_meeting_attendees', {
      //   meeting_id: uid,
      //   show_meeting_attendees: showMeetingAttendees,
      // });

      // // Step 2-4: Check if show_meeting_attendees is enabled
      // if (!showMeetingAttendees) {
      //   logger.success(req, 'get_my_meeting_registrants', startTime, {
      //     meeting_id: uid,
      //     show_meeting_attendees: false,
      //     registrant_count: 0,
      //   });
      //   res.json([]);
      //   return;
      // }

      // Step 5: Check if current user is a registrant (access control)
      const userEmail = req.oidc?.user?.['email'] as string | undefined;

      logger.debug(req, 'get_my_meeting_registrants', 'Checking user authentication', {
        meeting_id: uid,
        has_email: !!userEmail,
        user_email: userEmail,
      });

      if (!userEmail) {
        logger.success(req, 'get_my_meeting_registrants', startTime, {
          meeting_id: uid,
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

      // Use tags_all to filter by both meeting_id and email
      logger.debug(req, 'get_my_meeting_registrants', 'Checking if user is a registrant', {
        meeting_id: uid,
        user_email: userEmail,
      });
      const userRegistrantCheck = await this.meetingService.getMeetingRegistrantsByEmail(req, uid, userEmail);

      logger.debug(req, 'get_my_meeting_registrants', 'User registrant check complete', {
        meeting_id: uid,
        user_email: userEmail,
        registrant_count: userRegistrantCheck.length,
      });

      // Step 6: If user is not a registrant, check if they are an organizer
      if (userRegistrantCheck.length === 0) {
        if (!meeting.organizer) {
          logger.success(req, 'get_my_meeting_registrants', startTime, {
            meeting_id: uid,
            user_email: userEmail,
            is_registrant: false,
            is_organizer: false,
            registrant_count: 0,
          });
          res.json([]);
          return;
        }

        logger.debug(req, 'get_my_meeting_registrants', 'User is not a registrant but is an organizer, granting access', {
          meeting_id: uid,
          user_email: userEmail,
        });
      }

      // Step 7: User is a registrant or organizer, fetch all registrants using M2M token
      logger.debug(req, 'get_my_meeting_registrants', 'Fetching registrants with M2M token', {
        meeting_id: uid,
        user_email: userEmail,
        include_rsvp: includeRsvp,
      });

      logger.debug(req, 'get_my_meeting_registrants', 'M2M token generated, fetching all registrants', {
        meeting_id: uid,
        has_m2m_token: !!m2mToken,
      });

      const registrants = await this.meetingService.getMeetingRegistrants(req, uid, includeRsvp);

      logger.debug(req, 'get_my_meeting_registrants', 'Fetched all registrants, enriching committee data', {
        meeting_id: uid,
        registrant_count: registrants.length,
      });

      // Enrich committee registrant data with committee details and member info
      const enrichedRegistrants = await this.enrichCommitteeRegistrants(req, meeting, registrants);

      // Restore original token (delete if it was undefined to avoid leaving M2M token)
      if (originalToken !== undefined) {
        req.bearerToken = originalToken;
      } else {
        delete req.bearerToken;
      }

      logger.success(req, 'get_my_meeting_registrants', startTime, {
        meeting_id: uid,
        user_email: userEmail,
        is_registrant: userRegistrantCheck.length > 0,
        is_organizer: meeting.organizer,
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
        meeting_id: uid,
      })) || [];

    const startTime = logger.startOperation(req, 'add_meeting_registrants', {
      meeting_id: uid,
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
        meeting_id: uid,
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
          meeting_id: uid,
        },
      })) || [];

    const startTime = logger.startOperation(req, 'update_meeting_registrants', {
      meeting_id: uid,
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
        meeting_id: uid,
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
      meeting_id: uid,
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
        meeting_id: uid,
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
      meeting_id: uid,
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
        meeting_id: uid,
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
      meeting_id: uid,
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
   * Gets current user's RSVP via the query service
   */
  public async getMeetingRsvpByUsername(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const { occurrenceId } = req.query;

    const startTime = logger.startOperation(req, 'get_meeting_rsvp_by_username', {
      meeting_id: uid,
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
      meeting_id: uid,
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
   * GET /meetings/:uid/attachments
   */
  public async getMeetingAttachments(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;

    const startTime = logger.startOperation(req, 'get_meeting_attachments', {
      meeting_id: uid,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_meeting_attachments',
          service: 'meeting_controller',
        })
      ) {
        return;
      }

      const attachments = await this.meetingService.getMeetingAttachments(req, uid);

      logger.success(req, 'get_meeting_attachments', startTime, {
        meeting_id: uid,
        attachment_count: attachments.length,
      });

      res.status(200).json(attachments);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /meetings/:uid/attachments
   */
  public async createMeetingAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const attachmentData: CreateMeetingAttachmentRequest = req.body;

    const startTime = logger.startOperation(req, 'create_meeting_attachment', {
      meeting_id: uid,
      type: attachmentData.type,
      name: attachmentData.name,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'create_meeting_attachment',
          service: 'meeting_controller',
        })
      ) {
        return;
      }

      if (!attachmentData.type || !attachmentData.name) {
        return next(
          ServiceValidationError.fromFieldErrors(
            {
              type: !attachmentData.type ? 'Type is required' : [],
              name: !attachmentData.name ? 'Name is required' : [],
            },
            'Attachment data validation failed',
            { operation: 'create_meeting_attachment', service: 'meeting_controller', path: req.path }
          )
        );
      }

      const attachment = await this.meetingService.createMeetingAttachment(req, uid, attachmentData);

      logger.success(req, 'create_meeting_attachment', startTime, {
        attachment_uid: attachment.uid,
        meeting_id: uid,
        type: attachment.type,
      });

      res.status(201).json(attachment);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /meetings/:uid/attachments/:attachmentId
   */
  public async updateMeetingAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, attachmentId } = req.params;
    const updateData: UpdateMeetingAttachmentRequest = req.body;

    const startTime = logger.startOperation(req, 'update_meeting_attachment', {
      meeting_id: uid,
      attachment_id: attachmentId,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'update_meeting_attachment',
          service: 'meeting_controller',
        })
      ) {
        return;
      }

      if (!attachmentId) {
        return next(
          ServiceValidationError.forField('attachmentId', 'Attachment ID is required', {
            operation: 'update_meeting_attachment',
            service: 'meeting_controller',
            path: req.path,
          })
        );
      }

      if (!updateData.type || !updateData.category || !updateData.name) {
        return next(
          ServiceValidationError.fromFieldErrors(
            {
              type: !updateData.type ? 'Type is required' : [],
              category: !updateData.category ? 'Category is required' : [],
              name: !updateData.name ? 'Name is required' : [],
            },
            'Attachment update validation failed',
            { operation: 'update_meeting_attachment', service: 'meeting_controller', path: req.path }
          )
        );
      }

      await this.meetingService.updateMeetingAttachment(req, uid, attachmentId, updateData);

      logger.success(req, 'update_meeting_attachment', startTime, {
        meeting_id: uid,
        attachment_id: attachmentId,
      });

      res.status(204).send();
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
      meeting_id: uid,
      attachment_id: attachmentId,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'delete_meeting_attachment',
          service: 'meeting_controller',
        })
      ) {
        return;
      }

      if (!attachmentId) {
        return next(
          ServiceValidationError.forField('attachmentId', 'Attachment ID is required', {
            operation: 'delete_meeting_attachment',
            service: 'meeting_controller',
            path: req.path,
          })
        );
      }

      await this.meetingService.deleteMeetingAttachment(req, uid, attachmentId);

      logger.success(req, 'delete_meeting_attachment', startTime, {
        meeting_id: uid,
        attachment_id: attachmentId,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /meetings/:uid/attachments/:attachmentId
   * Returns attachment metadata
   */
  public async getMeetingAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, attachmentId } = req.params;

    const startTime = logger.startOperation(req, 'get_meeting_attachment', {
      meeting_id: uid,
      attachment_id: attachmentId,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_meeting_attachment',
          service: 'meeting_controller',
        })
      ) {
        return;
      }

      if (!attachmentId) {
        return next(
          ServiceValidationError.forField('attachmentId', 'Attachment ID is required', {
            operation: 'get_meeting_attachment',
            service: 'meeting_controller',
            path: req.path,
          })
        );
      }

      const attachment = await this.meetingService.getMeetingAttachmentInfo(req, uid, attachmentId);

      logger.success(req, 'get_meeting_attachment', startTime, {
        meeting_id: uid,
        attachment_id: attachmentId,
      });

      res.status(200).json(attachment);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /meetings/:uid/attachments/:attachmentId/download
   * Returns a presigned download URL for the attachment
   */
  public async getMeetingAttachmentDownloadUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, attachmentId } = req.params;

    const startTime = logger.startOperation(req, 'get_meeting_attachment_download_url', {
      meeting_id: uid,
      attachment_id: attachmentId,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_meeting_attachment_download_url',
          service: 'meeting_controller',
        })
      ) {
        return;
      }

      if (!attachmentId) {
        return next(
          ServiceValidationError.forField('attachmentId', 'Attachment ID is required', {
            operation: 'get_meeting_attachment_download_url',
            service: 'meeting_controller',
            path: req.path,
          })
        );
      }

      const result = await this.meetingService.getMeetingAttachmentDownloadUrl(req, uid, attachmentId);

      logger.success(req, 'get_meeting_attachment_download_url', startTime, {
        meeting_id: uid,
        attachment_id: attachmentId,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /meetings/:uid/attachments/presign
   * Generates a presigned S3 URL for file upload
   */
  public async presignMeetingAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const presignData: PresignAttachmentRequest = req.body;

    const startTime = logger.startOperation(req, 'presign_meeting_attachment', {
      meeting_id: uid,
      file_name: presignData.name,
      file_size: presignData.file_size,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'presign_meeting_attachment',
          service: 'meeting_controller',
        })
      ) {
        return;
      }

      if (!presignData.name || !presignData.file_size || !presignData.file_type) {
        return next(
          ServiceValidationError.fromFieldErrors(
            {
              name: !presignData.name ? 'File name is required' : [],
              file_size: !presignData.file_size ? 'File size is required' : [],
              file_type: !presignData.file_type ? 'File type is required' : [],
            },
            'Presign request validation failed',
            { operation: 'presign_meeting_attachment', service: 'meeting_controller', path: req.path }
          )
        );
      }

      if (typeof presignData.file_size !== 'number' || isNaN(presignData.file_size) || presignData.file_size <= 0) {
        return next(
          ServiceValidationError.forField('file_size', 'File size must be a positive number', {
            operation: 'presign_meeting_attachment',
            service: 'meeting_controller',
            path: req.path,
          })
        );
      }

      const result = await this.meetingService.presignMeetingAttachment(req, uid, presignData);

      logger.success(req, 'presign_meeting_attachment', startTime, {
        meeting_id: uid,
        attachment_uid: result.uid,
        file_name: presignData.name,
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /meetings/:uid/attachments/upload
   * Receives a raw binary file body, presigns via meeting service, then uploads
   * directly from the server to S3. Avoids browser-side CORS requirements.
   * Metadata passed as query params: name, file_size, file_type, category?, description?
   */
  public async uploadMeetingAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const { name, file_size, file_type, category, description } = req.query as Record<string, string>;

    const startTime = logger.startOperation(req, 'upload_meeting_attachment', {
      meeting_id: uid,
      file_name: name,
      file_size,
      file_type,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'upload_meeting_attachment',
          service: 'meeting_controller',
        })
      ) {
        return;
      }

      if (!name || !file_size || !file_type) {
        return next(
          ServiceValidationError.fromFieldErrors(
            {
              name: !name ? 'File name is required' : [],
              file_size: !file_size ? 'File size is required' : [],
              file_type: !file_type ? 'File type is required' : [],
            },
            'Upload request validation failed',
            { operation: 'upload_meeting_attachment', service: 'meeting_controller', path: req.path }
          )
        );
      }

      const fileBuffer = req.body as Buffer;
      const fileSizeNum = parseInt(file_size, 10);

      if (isNaN(fileSizeNum) || fileSizeNum <= 0) {
        return next(
          ServiceValidationError.forField('file_size', 'File size must be a positive number', {
            operation: 'upload_meeting_attachment',
            service: 'meeting_controller',
            path: req.path,
          })
        );
      }

      if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
        return next(
          ServiceValidationError.forField('body', 'Request body must contain file data', {
            operation: 'upload_meeting_attachment',
            service: 'meeting_controller',
            path: req.path,
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

      const result = await this.meetingService.uploadMeetingAttachment(req, uid, fileBuffer, presignData);

      logger.success(req, 'upload_meeting_attachment', startTime, {
        meeting_id: uid,
        attachment_uid: result.uid,
        file_name: name,
        file_size: fileSizeNum,
      });

      res.status(201).json(result);
    } catch (error) {
      logger.error(req, 'upload_meeting_attachment', startTime, error, { meeting_id: uid, file_name: name });
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
      meeting_id: meetingUid,
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
        meeting_id: meetingUid,
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
          meeting_id: meetingUid,
          batch_size: inputData.length,
          error_type: '403_forbidden',
        });
        // Send the error to the next middleware
        next(error);
        return { results: [], shouldReturn: true };
      }

      // For other errors, log and continue processing the remaining items
      logger.error(req, `${operationName}_batch_processing`, helperStartTime, error, {
        meeting_id: meetingUid,
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
      meeting_id: meetingUid,
      total_results: results.length,
    });

    // Initialize the successes and failures arrays
    const successes: T[] = [];
    const failures: {
      input: I;
      error: { message: string; code?: string; details?: unknown };
    }[] = [];

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
          meeting_id: meetingUid,
          identifier: getIdentifier(inputData[index], index),
        });
      }
    });

    logger.success(req, `${operationName}_batch_response`, helperStartTime, {
      meeting_id: meetingUid,
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
   * Enriches committee registrants with committee details and member information.
   * Uses the meeting's committees array as the source of truth for which committees
   * are involved, then fetches committee details and members to populate registrant fields.
   */
  private async enrichCommitteeRegistrants(req: Request, meeting: Meeting, registrants: MeetingRegistrant[]): Promise<MeetingRegistrant[]> {
    // Use the meeting's committees as the source of truth
    const meetingCommittees = meeting.committees || [];

    if (meetingCommittees.length === 0) {
      return registrants;
    }

    const v2CommitteeUids = meetingCommittees.map((c) => c.uid);

    logger.debug(req, 'enrich_committee_registrants', 'Enriching committee data from meeting committees', {
      total_registrants: registrants.length,
      meeting_committee_count: v2CommitteeUids.length,
      v2_committee_uids: v2CommitteeUids,
    });

    // Resolve v2 committee UIDs to v1 SFIDs via NATS lookup
    // Registrant committee_uid is a v1 ID; meeting committees use v2 IDs
    const v1ToV2Map = await this.resolveV2ToV1CommitteeMappings(req, v2CommitteeUids);

    logger.debug(req, 'enrich_committee_registrants', 'Resolved v2→v1 committee mappings', {
      mappings_resolved: v1ToV2Map.size,
    });

    if (v1ToV2Map.size === 0) {
      return registrants;
    }

    // Fetch committee details and members in parallel for all meeting committees
    const [committees, membersByCommittee] = await Promise.all([
      Promise.all(
        v2CommitteeUids.map(async (uid) => {
          try {
            const committee = await this.committeeService.getCommitteeById(req, uid);
            return { uid, committee };
          } catch (error) {
            logger.warning(req, 'enrich_committee_registrants', 'Failed to fetch committee', {
              committee_uid: uid,
              err: error,
            });
            return { uid, committee: null };
          }
        })
      ),
      Promise.all(
        v2CommitteeUids.map(async (uid) => {
          try {
            const members = await this.committeeService.getCommitteeMembers(req, uid);
            return { uid, members };
          } catch (error) {
            logger.warning(req, 'enrich_committee_registrants', 'Failed to fetch committee members', {
              committee_uid: uid,
              err: error,
            });
            return { uid, members: [] };
          }
        })
      ),
    ]);

    // Build lookup maps keyed by v2 committee UID
    const committeeMap = new Map<string, Committee | null>();
    committees.forEach(({ uid, committee }) => committeeMap.set(uid, committee));
    const memberMap = new Map<string, CommitteeMember[]>();
    membersByCommittee.forEach(({ uid, members }) => memberMap.set(uid, members));

    // Enrich registrants that have a committee_uid (v1 ID) set
    return registrants.map((registrant) => {
      if (!registrant.committee_uid) {
        return registrant;
      }

      // Map registrant's v1 committee_uid to the corresponding v2 UID
      const v2Uid = v1ToV2Map.get(registrant.committee_uid);
      if (!v2Uid) {
        return registrant;
      }

      const committee = committeeMap.get(v2Uid);
      const members = memberMap.get(v2Uid) || [];

      // Find the member by email
      const member = members.find((m) => m.email.toLowerCase() === registrant.email.toLowerCase());

      return {
        ...registrant,
        // Committee details
        committee_name: committee?.name || null,
        committee_category: committee?.category || null,
        // Member details
        committee_role: member?.role?.name || null,
        committee_voting_status: member?.voting?.status || null,
        committee_appointed_by: member?.appointed_by || null,
      };
    });
  }

  /**
   * Resolves v2 committee UIDs to v1 committee SFIDs via NATS lookup.
   * Returns a map of v1_sfid → v2_uid for matching registrants to committees.
   */
  private async resolveV2ToV1CommitteeMappings(req: Request, v2CommitteeUids: string[]): Promise<Map<string, string>> {
    const v1ToV2Map = new Map<string, string>();
    const codec = this.natsService.getCodec();

    const results = await Promise.all(
      v2CommitteeUids.map(async (v2Uid) => {
        try {
          const lookupKey = `committee.uid.${v2Uid}`;
          const response = await this.natsService.request(NatsSubjects.LOOKUP_V1_MAPPING, codec.encode(lookupKey), {
            timeout: NATS_CONFIG.REQUEST_TIMEOUT,
          });

          const responseText = codec.decode(response.data);

          // Response format: "{project_sfid}:{committee_sfid}" or empty/error
          if (!responseText || responseText.startsWith('error:')) {
            logger.warning(req, 'resolve_v2_to_v1_committee', 'NATS lookup returned no mapping', {
              v2_uid: v2Uid,
              response: responseText || '(empty)',
            });
            return null;
          }

          // Extract the committee_sfid (second part after the colon)
          const parts = responseText.split(':');
          if (parts.length < 2 || !parts[1]) {
            logger.warning(req, 'resolve_v2_to_v1_committee', 'Unexpected NATS response format', {
              v2_uid: v2Uid,
              response: responseText,
            });
            return null;
          }

          const v1Sfid = parts[1];
          return { v1Sfid, v2Uid };
        } catch (error) {
          logger.warning(req, 'resolve_v2_to_v1_committee', 'Failed to resolve v2→v1 committee mapping', {
            v2_uid: v2Uid,
            err: error,
          });
          return null;
        }
      })
    );

    for (const result of results) {
      if (result) {
        v1ToV2Map.set(result.v1Sfid, result.v2Uid);
      }
    }

    return v1ToV2Map;
  }
}
