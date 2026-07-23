// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Meeting } from '@lfx-one/shared';
import { MeetingVisibility, QueryServiceMeetingType } from '@lfx-one/shared/enums';
import { CreateMeetingRegistrantRequest, MeetingRegistrant } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ResourceNotFoundError, ServiceValidationError } from '../errors';
import { AuthorizationError } from '../errors/authentication.error';
import {
  addInvitedStatusToMeeting,
  applyHostKeyVisibility,
  checkPastMeetingAccess,
  enrichMeetingsWithCreatedBy,
  stripHostKey,
} from '../helpers/meeting.helper';
import { validateUidParameter } from '../helpers/validation.helper';
import { AccessCheckService } from '../services/access-check.service';
import { logger } from '../services/logger.service';
import { MeetingService } from '../services/meeting.service';
import { getEffectiveEmail, getEffectiveUsername } from '../utils/auth-helper';
import { ProjectService } from '../services/project.service';
import { generateM2MToken } from '../utils/m2m-token.util';
import { validatePassword } from '../utils/security.util';

/**
 * Controller for handling public meeting HTTP requests (no authentication required)
 */
export class PublicMeetingController {
  private meetingService: MeetingService = new MeetingService();
  private projectService: ProjectService = new ProjectService();
  private accessCheckService: AccessCheckService = new AccessCheckService();
  /**
   * GET /public/api/meetings/:id
   * Retrieves a single meeting by ID without requiring authentication
   */
  public async getMeetingById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;

    const startTime = logger.startOperation(req, 'get_public_meeting_by_id', {
      meeting_id: id,
    });

    try {
      // Check if the meeting UID is provided
      if (!this.validateMeetingId(id, 'get_public_meeting_by_id', req, next)) {
        return;
      }

      // Save the user's original token before setting M2M token
      const originalToken = req.bearerToken;

      // Generate M2M token once for all operations
      const m2mToken = await this.setupM2MToken(req);

      // Get the meeting by ID using M2M token (all meetings are now v1_meeting type)
      let meeting = await this.fetchMeetingWithM2M(req, id, 'v1_meeting', m2mToken);
      if (!meeting) {
        // Throw a resource not found error (error handler will log)
        throw new ResourceNotFoundError('Meeting', id, {
          operation: 'get_public_meeting_by_id',
          service: 'public_meeting_controller',
          path: `/itx/meetings/${id}`,
        });
      }

      const isAuthenticated = req.oidc?.isAuthenticated();

      // Fetch project and invited status in parallel (both depend only on meeting data)
      const [project, meetingWithInvited] = await Promise.all([
        this.projectService.getProjectById(req, meeting.project_uid, false),
        isAuthenticated
          ? addInvitedStatusToMeeting(req, meeting, getEffectiveEmail(req) || '', m2mToken)
          : Promise.resolve(Object.assign(meeting, { invited: false })),
      ]);
      meeting = meetingWithInvited;

      if (!project) {
        throw new ResourceNotFoundError('Project', meeting.project_uid, {
          operation: 'get_public_meeting_by_id',
          service: 'public_meeting_controller',
          path: `/projects/${meeting.project_uid}`,
        });
      }

      // Resolve host-key visibility (organizer OR project writer OR committee writer). This sets
      // meeting.organizer (used for the registrant counts below) and meeting.can_view_host_key,
      // and strips host_key when the user isn't authorized — the single source of truth for the
      // gate across every response branch.
      //
      // Guard on originalToken, not just isAuthenticated: this is an optional-auth route, so a
      // token-refresh failure can leave isAuthenticated() true with NO user token captured
      // (originalToken === undefined) while req.bearerToken still holds the M2M token. Running the
      // access check in that state would evaluate the application identity — which may hold writer
      // relations — and leak the host key. Fail closed unless we hold the user's own token.
      if (isAuthenticated && originalToken !== undefined) {
        // Temporarily restore user's original token for the access check
        req.bearerToken = originalToken;

        try {
          await applyHostKeyVisibility(req, this.accessCheckService, meeting);
        } catch (error) {
          // If the access check fails, log but fail closed (no organizer, no host key)
          logger.warning(req, 'get_public_meeting_by_id', 'Failed to check host key access, continuing with no access', {
            err: error,
            meeting_id: id,
          });
          meeting.organizer = false;
          meeting.can_view_host_key = false;
          stripHostKey(meeting);
        }

        // Restore M2M token for subsequent operations (e.g., fetching public join URL)
        req.bearerToken = m2mToken;
      } else {
        meeting.organizer = false;
        meeting.can_view_host_key = false;
        stripHostKey(meeting);
      }

      // Fetch registrant counts for organizers, otherwise default to 0
      if (meeting.organizer) {
        try {
          const registrants = await this.meetingService.getMeetingRegistrants(req, id);
          const committeeMembers = registrants.filter((r) => r.type === 'committee').length;
          meeting.individual_registrants_count = registrants.length - committeeMembers;
          meeting.committee_members_count = committeeMembers;
        } catch (error) {
          logger.warning(req, 'get_public_meeting_by_id', 'Failed to fetch registrant counts for organizer', {
            meeting_id: id,
            err: error,
          });
          meeting.individual_registrants_count = 0;
          meeting.committee_members_count = 0;
        }
      } else {
        meeting.individual_registrants_count = 0;
        meeting.committee_members_count = 0;
      }

      // The organizer is authenticated-visible info (LFXV2-2802). For authenticated callers, enrich
      // created_by from the live v1_meeting index (the ITX detail payload omits it); for anonymous
      // callers, skip that query and strip created_by so we neither expose nor waste a call on it.
      if (isAuthenticated) {
        [meeting] = await enrichMeetingsWithCreatedBy(req, [meeting], (m) => m.id);
      } else {
        delete (meeting as Partial<Meeting>).created_by;
      }

      // Log the success
      logger.success(req, 'get_public_meeting_by_id', startTime, { meeting_id: id, project_uid: meeting.project_uid, title: meeting.title });

      if (meeting.visibility === MeetingVisibility.PUBLIC && !meeting.restricted) {
        res.json({
          meeting,
          project: { name: project.name, slug: project.slug, logo_url: project.logo_url, uid: project.uid, parent_uid: project.parent_uid },
        });
        return;
      }

      // Authenticated registered participants and organizers can access private/restricted
      // meeting details without a password in the URL — their registrant record is the gate.
      // host_key was already stripped above for anyone not authorized to view it.
      if (meeting.invited || meeting.organizer) {
        res.json({
          meeting,
          project: { name: project.name, slug: project.slug, logo_url: project.logo_url, uid: project.uid, parent_uid: project.parent_uid },
        });
        return;
      }

      // Fallback for authenticated users: the invited flag can miss someone if the query
      // service OR lookup had a false negative. Re-check directly by email with M2M.
      if (isAuthenticated) {
        const userEmail = getEffectiveEmail(req);
        if (userEmail) {
          try {
            const registrantsByEmail = await this.meetingService.getMeetingRegistrantsByEmail(req, id, userEmail, m2mToken);
            if (registrantsByEmail.length > 0) {
              logger.warning(req, 'get_public_meeting_by_id', 'invited flag was false negative; email fallback succeeded', {
                meeting_id: id,
                email: userEmail,
              });
              meeting.invited = true;
              res.json({
                meeting,
                project: { name: project.name, slug: project.slug, logo_url: project.logo_url, uid: project.uid, parent_uid: project.parent_uid },
              });
              return;
            }
          } catch (fallbackError) {
            logger.warning(req, 'get_public_meeting_by_id', 'Email registrant fallback check failed, continuing to password gate', {
              meeting_id: id,
              err: fallbackError,
            });
          }
        }
      }

      // Check if the user has passed in a password, if so, check if it's correct
      const { password } = req.query;
      if (!this.validateMeetingPassword(password as string, meeting.password as string, 'get_public_meeting_by_id', req, next)) {
        return;
      }

      // Send the meeting and project data to the client
      res.json({ meeting, project: { name: project.name, slug: project.slug, logo_url: project.logo_url, uid: project.uid, parent_uid: project.parent_uid } });
    } catch (error) {
      // Error handler will log
      next(error);
    }
  }

  /**
   * GET /public/api/meetings/past/:id
   * Retrieves a past meeting by ID with tiered access based on authentication and membership
   */
  public async getPublicPastMeetingById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;

    const startTime = logger.startOperation(req, 'get_public_past_meeting_by_id', {
      past_meeting_id: id,
    });

    try {
      if (!this.validateMeetingId(id, 'get_public_past_meeting_by_id', req, next)) {
        return;
      }

      // Save the user's original token before setting M2M token
      const originalToken = req.bearerToken;

      // Generate M2M token once for all operations
      const m2mToken = await this.setupM2MToken(req);

      // Fetch past meeting (throws ResourceNotFoundError if not found)
      const meeting = await this.meetingService.getPastMeetingById(req, id);

      const isAuthenticated = req.oidc?.isAuthenticated();

      // Fetch project
      const project = await this.projectService.getProjectById(req, meeting.project_uid, false);
      if (!project) {
        throw new ResourceNotFoundError('Project', meeting.project_uid, {
          operation: 'get_public_past_meeting_by_id',
          service: 'public_meeting_controller',
          path: `/projects/${meeting.project_uid}`,
        });
      }

      // Check organizer status for authenticated users using user token
      let isOrganizer = false;
      if (isAuthenticated && originalToken !== undefined) {
        req.bearerToken = originalToken;
        try {
          const meetingWithAccess = await this.accessCheckService.addAccessToResource(
            req,
            { ...meeting, id: meeting.meeting_and_occurrence_id ?? id },
            'v1_past_meeting',
            'organizer'
          );
          isOrganizer = meetingWithAccess.organizer ?? false;
        } catch {
          isOrganizer = false;
        }
        req.bearerToken = m2mToken;
      }

      logger.debug(req, 'get_public_past_meeting_by_id', 'Organizer check result', {
        past_meeting_id: id,
        is_organizer: isOrganizer,
        is_authenticated: !!isAuthenticated,
        has_original_token: originalToken !== undefined,
      });

      // Determine full access based on visibility and membership
      const fullAccess = await checkPastMeetingAccess(req, meeting, m2mToken, isOrganizer);

      logger.success(req, 'get_public_past_meeting_by_id', startTime, {
        past_meeting_id: id,
        full_access: fullAccess,
      });

      // Include organizer flag for authenticated users with full access
      if (fullAccess) {
        meeting.organizer = isOrganizer;
      }

      // Past meetings never surface the Zoom host key — strip it unconditionally.
      stripHostKey(meeting);

      // The organizer is authenticated-visible info (LFXV2-2802). For authenticated callers, enrich
      // created_by from the live v1_meeting index (webhook-created past meetings lack a human one);
      // for anonymous callers, skip that query and strip created_by (present as zoom.webhooks).
      let enrichedMeeting = meeting;
      if (isAuthenticated) {
        [enrichedMeeting] = await enrichMeetingsWithCreatedBy(req, [meeting], (m) => m.meeting_id);
      } else {
        delete (meeting as Partial<Meeting>).created_by;
      }

      // For non-full-access users, return only the fields needed for the basic UI.
      // created_by is included (authenticated callers only, per the strip above) so the basic
      // view can still show the organizer name.
      const meetingResponse = fullAccess
        ? enrichedMeeting
        : {
            id: enrichedMeeting.id,
            title: enrichedMeeting.title,
            visibility: enrichedMeeting.visibility,
            meeting_type: enrichedMeeting.meeting_type,
            restricted: enrichedMeeting.restricted,
            start_time: enrichedMeeting.start_time,
            scheduled_start_time: enrichedMeeting.scheduled_start_time,
            scheduled_end_time: enrichedMeeting.scheduled_end_time,
            duration: enrichedMeeting.duration,
            recurrence: enrichedMeeting.recurrence,
            recording_enabled: enrichedMeeting.recording_enabled,
            transcript_enabled: enrichedMeeting.transcript_enabled,
            youtube_upload_enabled: enrichedMeeting.youtube_upload_enabled,
            show_meeting_attendees: enrichedMeeting.show_meeting_attendees,
            ai_summary_enabled: enrichedMeeting.ai_summary_enabled,
            project_uid: enrichedMeeting.project_uid,
            meeting_id: enrichedMeeting.meeting_id,
            created_by: enrichedMeeting.created_by,
          };

      res.json({
        meeting: meetingResponse,
        project: { name: project.name, slug: project.slug, logo_url: project.logo_url, uid: project.uid, parent_uid: project.parent_uid },
        full_access: fullAccess,
      });
    } catch (error) {
      next(error);
    }
  }

  public async postMeetingJoinUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const { password } = req.query;
    const bodyEmail = typeof req.body.email === 'string' ? req.body.email.trim() : '';
    const email: string = bodyEmail || getEffectiveEmail(req) || '';
    const username = getEffectiveUsername(req);
    const startTime = logger.startOperation(req, 'post_meeting_link', {
      meeting_id: id,
    });

    try {
      // Check if the meeting UID is provided
      if (!this.validateMeetingId(id, 'post_meeting_link', req, next)) {
        return;
      }

      const meeting = await this.fetchMeetingWithM2M(req, id, 'v1_meeting');

      if (!meeting) {
        throw new ResourceNotFoundError('Meeting', id, {
          operation: 'post_meeting_link',
          service: 'public_meeting_controller',
          path: `/itx/meetings/${id}`,
        });
      }

      // Check if the user has passed in a password, if so, check if it's correct
      if (!this.validateMeetingPassword(password as string, meeting.password as string, 'post_meeting_link', req, next)) {
        return;
      }

      // Check if the meeting is within the allowed join time window
      if (!this.isWithinJoinWindow(meeting)) {
        const earlyJoinMinutes = meeting?.early_join_time_minutes ?? 10;

        const validationError = ServiceValidationError.forField('timing', `You can join the meeting up to ${earlyJoinMinutes} minutes before the start time`, {
          operation: 'post_meeting_link',
          service: 'public_meeting_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // For restricted meetings, validate the user is registered. Match by email OR username
      // so accounts whose auth email differs from their invited registrant email still resolve.
      // The matched registrant's stored email is then used for the upstream join_link call.
      let joinEmail = email;
      if (meeting.restricted) {
        const matchedRegistrant = await this.restrictedMeetingCheck(req, email, username, id);
        if (matchedRegistrant.email) {
          joinEmail = matchedRegistrant.email;
        }
      }

      const joinUrlData = await this.meetingService.getMeetingJoinUrl(req, id, joinEmail);

      // Log the success
      logger.success(req, 'post_meeting_link', startTime, {
        meeting_id: id,
        email: joinEmail,
        project_uid: meeting.project_uid,
        title: meeting.title,
      });

      res.json(joinUrlData);
    } catch (error) {
      // Error handler will log
      next(error);
    }
  }

  /**
   * POST /public/api/meetings/register
   * Registers a user to a public, non-restricted meeting
   */
  public async registerForPublicMeeting(req: Request, res: Response, next: NextFunction): Promise<void> {
    const registrantData: CreateMeetingRegistrantRequest = req.body;
    const meetingId = registrantData.meeting_id;

    const startTime = logger.startOperation(req, 'register_for_public_meeting', {
      meeting_id: meetingId,
    });

    try {
      // Validate the meeting ID is provided
      if (!meetingId) {
        const validationError = ServiceValidationError.forField('meeting_id', 'Meeting ID is required', {
          operation: 'register_for_public_meeting',
          service: 'public_meeting_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Validate required fields
      if (!registrantData.email || !registrantData.first_name || !registrantData.last_name) {
        const validationError = ServiceValidationError.fromFieldErrors(
          {
            email: !registrantData.email ? 'Email is required' : [],
            first_name: !registrantData.first_name ? 'First name is required' : [],
            last_name: !registrantData.last_name ? 'Last name is required' : [],
          },
          'Registration data validation failed',
          {
            operation: 'register_for_public_meeting',
            service: 'public_meeting_controller',
            path: req.path,
          }
        );

        return next(validationError);
      }

      // Generate M2M token
      const m2mToken = await this.setupM2MToken(req);

      // Fetch the meeting to validate it's public and non-restricted
      const meeting = await this.meetingService.getMeetingById(req, meetingId, 'v1_meeting', false);

      if (!meeting) {
        throw new ResourceNotFoundError('Meeting', meetingId, {
          operation: 'register_for_public_meeting',
          service: 'public_meeting_controller',
          path: `/itx/meetings/${meetingId}`,
        });
      }

      // Validate the meeting is public
      if (meeting.visibility !== MeetingVisibility.PUBLIC) {
        const authError = new AuthorizationError('Registration is not allowed for non-public meetings', {
          operation: 'register_for_public_meeting',
          service: 'public_meeting_controller',
          path: req.path,
        });

        return next(authError);
      }

      // Validate the meeting is not restricted
      if (meeting.restricted) {
        const authError = new AuthorizationError('Registration is not allowed for restricted meetings', {
          operation: 'register_for_public_meeting',
          service: 'public_meeting_controller',
          path: req.path,
        });

        return next(authError);
      }

      // Add the registrant using M2M token
      const newRegistrant = await this.meetingService.addMeetingRegistrantWithM2M(req, registrantData, m2mToken);

      logger.success(req, 'register_for_public_meeting', startTime, {
        meeting_id: meetingId,
        registrant_uid: newRegistrant.uid,
      });

      res.status(201).json(newRegistrant);
    } catch (error) {
      // Error handler will log
      next(error);
    }
  }

  /**
   * Sets up M2M token for API calls
   */
  private async setupM2MToken(req: Request): Promise<string> {
    const startTime = logger.startOperation(req, 'setup_m2m_token');

    const m2mToken = await generateM2MToken(req);
    req.bearerToken = m2mToken;

    logger.success(req, 'setup_m2m_token', startTime, {
      has_token: !!m2mToken,
    });

    return m2mToken;
  }

  /**
   * Validates meeting ID parameter
   */
  private validateMeetingId(id: string, operation: string, req: Request, next: NextFunction): boolean {
    return validateUidParameter(id, req, next, {
      operation,
      service: 'public_meeting_controller',
    });
  }

  /**
   * Validates meeting password
   */
  private validateMeetingPassword(password: string, meetingPassword: string, operation: string, req: Request, next: NextFunction): boolean {
    if (!password || !validatePassword(password, meetingPassword)) {
      const validationError = ServiceValidationError.forField('password', 'Invalid password', {
        operation,
        service: 'public_meeting_controller',
        path: req.path,
      });

      next(validationError);
      return false;
    }
    return true;
  }

  /**
   * Fetches meeting with M2M token setup
   * @param req - Express request object
   * @param id - Meeting ID
   * @param meetingType - Type of meeting query
   * @param m2mToken - Optional pre-generated M2M token (will be generated if not provided)
   */
  private async fetchMeetingWithM2M(req: Request, id: string, meetingType: QueryServiceMeetingType = 'v1_meeting', m2mToken?: string) {
    const startTime = logger.startOperation(req, 'fetch_meeting_with_m2m', {
      meeting_id: id,
    });

    // Use provided token or generate a new one
    if (m2mToken) {
      req.bearerToken = m2mToken;
    } else {
      await this.setupM2MToken(req);
    }
    const meeting = await this.meetingService.getMeetingById(req, id, meetingType, false);

    logger.success(req, 'fetch_meeting_with_m2m', startTime, {
      meeting_id: meeting.id,
    });

    return meeting;
  }

  /**
   * Checks if the current time is within the allowed join window for a meeting
   */
  private isWithinJoinWindow(meeting: Meeting): boolean {
    if (!meeting?.start_time) {
      return false;
    }

    const now = new Date();
    const startTime = new Date(meeting.start_time);
    const earlyJoinMinutes = meeting?.early_join_time_minutes ?? 10;
    const earliestJoinTime = new Date(startTime.getTime() - earlyJoinMinutes * 60000);

    return now >= earliestJoinTime;
  }

  private async restrictedMeetingCheck(req: Request, email: string, username: string | null, id: string): Promise<MeetingRegistrant> {
    const helperStartTime = logger.startOperation(req, 'restricted_meeting_check', {
      meeting_id: id,
      has_email: !!email,
      has_username: !!username,
    });

    if (!email && !username) {
      throw ServiceValidationError.forField('email', 'Email or authenticated user identity is required', {
        operation: 'post_meeting_link',
        service: 'public_meeting_controller',
        path: req.path,
      });
    }

    // Username is the primary check — it's the auth-provider-verified identity and survives
    // accounts with multiple emails. Email is the fallback for unauthenticated flows or when
    // no username is available.
    let registrants: MeetingRegistrant[] = [];
    let matchedBy: 'username' | 'email' | null = null;
    if (username) {
      registrants = await this.meetingService.getMeetingRegistrantsByUsername(req, id, username);
      if (registrants.length > 0) {
        matchedBy = 'username';
      }
    }
    if (registrants.length === 0 && email) {
      registrants = await this.meetingService.getMeetingRegistrantsByEmail(req, id, email);
      if (registrants.length > 0) {
        matchedBy = 'email';
      }
    }

    if (registrants.length === 0) {
      // Specific code so the frontend can show the "join with a different email" affordance
      // without coupling to the human-readable message text.
      throw new AuthorizationError('You are not registered for this restricted meeting', {
        operation: 'post_meeting_link',
        service: 'public_meeting_controller',
        path: `/itx/meetings/${id}`,
        code: 'NOT_REGISTERED_FOR_MEETING',
      });
    }

    logger.success(req, 'restricted_meeting_check', helperStartTime, {
      meeting_id: id,
      registrant_count: registrants.length,
      matched_by: matchedBy,
    });

    return registrants[0];
  }
}
