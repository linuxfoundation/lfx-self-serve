// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { getStringQueryParam } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { UserService } from '../services/user.service';
import { getEffectiveEmail } from '../utils/auth-helper';

/**
 * Controller for handling user-related HTTP requests
 */
export class UserController {
  private userService: UserService = new UserService();

  /**
   * GET /api/user/pending-actions - Get all pending actions for the authenticated user
   */
  public async getPendingActions(req: Request, res: Response, next: NextFunction): Promise<void> {
    // projectUid/projectSlug/persona are optional. When omitted, the aggregator runs
    // user-scoped across the user's FGA grants instead of project-scoped.
    // TODO: `persona` is accepted for telemetry only — the aggregator no longer consumes it.
    // Drop from the query contract once all frontend callers stop sending it.
    // `getStringQueryParam` drops non-string values (arrays from `?k=a&k=b`, objects from
    // `?k[x]=y`) that Express would otherwise leak through a bare `as string | undefined` cast.
    const persona = getStringQueryParam(req, 'persona');
    const projectUid = getStringQueryParam(req, 'projectUid');
    const projectSlug = getStringQueryParam(req, 'projectSlug');

    const startTime = logger.startOperation(req, 'get_pending_actions', {
      ...(persona !== undefined && { persona }),
      ...(projectUid !== undefined && { project_uid: projectUid }),
      ...(projectSlug !== undefined && { project_slug: projectSlug }),
    });

    try {
      // Extract user email from auth context (impersonation-aware)
      const userEmail = getEffectiveEmail(req);
      if (!userEmail) {
        const validationError = ServiceValidationError.forField('email', 'User email not found in authentication context', {
          operation: 'get_pending_actions',
          service: 'user_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // projectUid and projectSlug must be supplied together (project/foundation lens) or
      // omitted together (Me lens). Surveys scope on projectSlug while meetings/votes scope on
      // projectUid — a half-supplied call would silently produce inconsistent aggregation across
      // the three sources. Reject early so the contract stays explicit.
      if (!!projectUid !== !!projectSlug) {
        next(
          ServiceValidationError.forField(
            projectUid ? 'projectSlug' : 'projectUid',
            'projectUid and projectSlug must be supplied together or omitted together',
            {
              operation: 'get_pending_actions',
              service: 'user_controller',
              path: req.path,
            }
          )
        );
        return;
      }

      // Optional `?limit=` clamps the response size so mobile / summary cards can request a
      // smaller payload. Absent = unbounded; when present it must be a positive integer. Any
      // present-but-non-string value (array from `?limit=1&limit=2`, object from `?limit[foo]=1`)
      // fails the Number conversion to NaN and hits the same error branch, so malformed input
      // can't silently defeat the cap.
      const limitQuery = req.query['limit'];
      let limit: number | undefined;
      if (limitQuery !== undefined) {
        const parsed = typeof limitQuery === 'string' ? Number(limitQuery) : NaN;
        if (!Number.isInteger(parsed) || parsed <= 0) {
          next(
            ServiceValidationError.forField('limit', 'limit query parameter must be a positive integer', {
              operation: 'get_pending_actions',
              service: 'user_controller',
              path: req.path,
            })
          );
          return;
        }
        limit = Math.min(parsed, 100);
      }

      // persona is accepted for telemetry but no longer consumed by the aggregator
      // (pending actions are persona-agnostic).
      const pendingActions = await this.userService.getPendingActions(req, projectUid, userEmail, projectSlug, limit);

      logger.success(req, 'get_pending_actions', startTime, {
        ...(persona !== undefined && { persona }),
        ...(projectUid !== undefined && { project_uid: projectUid }),
        ...(projectSlug !== undefined && { project_slug: projectSlug }),
        action_count: pendingActions.length,
        ...(limit !== undefined && { limit }),
      });

      // Private, revalidate-every-time — server recomputes the response for the real
      // authenticated identity on every hit, so 304 (cache-reuse) only fires when the server
      // confirms the body is unchanged for this user. See getUserMeetings for full rationale.
      res.set('Cache-Control', 'private, no-cache');
      res.json(pendingActions);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/user/meetings - Get meetings for the authenticated user
   * Returns meetings the user has direct FGA access to (host, participant, organizer), optionally filtered by project
   * @query projectUid - Optional project UID to filter meetings
   * @query foundation_uid - Optional foundation UID to filter meetings (OR across child projects)
   */
  public async getUserMeetings(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = getStringQueryParam(req, 'projectUid');
    const foundationUid = getStringQueryParam(req, 'foundation_uid');

    const startTime = logger.startOperation(req, 'get_user_meetings', {
      project_uid: projectUid,
      foundation_uid: foundationUid,
    });

    try {
      // No email extraction needed — the service uses req.bearerToken (via filter_grants=direct
      // server-side FGA lookup). Auth middleware has already ensured the user is authenticated.
      const meetings = await this.userService.getUserMeetings(req, projectUid, foundationUid);

      logger.success(req, 'get_user_meetings', startTime, {
        project_uid: projectUid,
        foundation_uid: foundationUid,
        meeting_count: meetings.length,
      });

      // Private, revalidate-every-time. Browser stores the body + ETag, but must check with the
      // server (If-None-Match) before serving. The server recomputes the response for the real
      // authenticated identity on every hit, so cross-user cache reads are impossible: different
      // users produce different bodies → different ETags → 200 with fresh data. 304 responses
      // skip the body entirely, which is where the bandwidth/parse savings come from.
      res.set('Cache-Control', 'private, no-cache');
      res.json(meetings);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/user/past-meetings - Get past meetings for the authenticated user
   * Returns past meetings the user has direct FGA access to (host, invitee, attendee, organizer), optionally filtered by project
   * @query projectUid - Optional project UID to filter meetings
   * @query foundation_uid - Optional foundation UID to filter meetings (OR across child projects)
   */
  public async getUserPastMeetings(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = getStringQueryParam(req, 'projectUid');
    const foundationUid = getStringQueryParam(req, 'foundation_uid');

    const startTime = logger.startOperation(req, 'get_user_past_meetings', {
      project_uid: projectUid,
      foundation_uid: foundationUid,
    });

    try {
      // Extract user email from auth context (impersonation-aware, already lowercased)
      const userEmail = getEffectiveEmail(req);
      if (!userEmail) {
        const validationError = ServiceValidationError.forField('email', 'User email not found in authentication context', {
          operation: 'get_user_past_meetings',
          service: 'user_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Get user's past meetings from service
      const pastMeetings = await this.userService.getUserPastMeetings(req, userEmail, projectUid, foundationUid);

      logger.success(req, 'get_user_past_meetings', startTime, {
        project_uid: projectUid,
        foundation_uid: foundationUid,
        past_meeting_count: pastMeetings.length,
      });

      // Private, revalidate-every-time — see getUserMeetings for full rationale.
      res.set('Cache-Control', 'private, no-cache');
      res.json(pastMeetings);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/user/latest-past-meetings - Get up to 5 most-recent past meetings for the authenticated user
   * Returns an array of up to 5 past meetings the user has direct FGA access to with an
   * `effective end` (scheduled_end_time, or start + duration when end is absent) in the past.
   * Uses `sort=name_desc` and over-fetches via `page_size=LATEST_PAST_MEETINGS_FETCH_SIZE`
   * (10 today) instead of paginating the full history; the service drops ongoing meetings from
   * the top of the sort and slices down to LATEST_PAST_MEETINGS_RETURN_LIMIT (5). The response
   * may therefore be fewer than 5 rows if many concurrently-ongoing meetings sit at the head
   * of the sort for this user.
   * @query projectUid - Optional project UID to filter meetings
   * @query foundation_uid - Optional foundation UID to filter meetings (OR across child projects)
   */
  public async getUserLatestPastMeetings(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = getStringQueryParam(req, 'projectUid');
    const foundationUid = getStringQueryParam(req, 'foundation_uid');

    const startTime = logger.startOperation(req, 'get_user_latest_past_meetings', {
      project_uid: projectUid,
      foundation_uid: foundationUid,
    });

    try {
      // No email extraction needed — the service uses req.bearerToken (via filter_grants=direct
      // server-side FGA lookup). Auth middleware has already ensured the user is authenticated.
      const pastMeetings = await this.userService.getUserLatestPastMeetings(req, projectUid, foundationUid);

      logger.success(req, 'get_user_latest_past_meetings', startTime, {
        count: pastMeetings.length,
        project_uid: projectUid,
        foundation_uid: foundationUid,
      });

      // Private, revalidate-every-time — see getUserMeetings for full rationale.
      res.set('Cache-Control', 'private, no-cache');
      res.json(pastMeetings);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/user/salesforce-id - Returns the current user's Salesforce ID
   * Proxies GET ${API_GW_AUDIENCE}/user-service/v1/me?basic=true and returns only
   * an object containing the profile ID in the shape `{ id: profile.ID }`.
   * The ID field is used by downstream operations such as visa letter and travel
   * fund applications.
   */
  public async getSalesforceId(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_salesforce_id', {});

    try {
      const profile = await this.userService.getApiGatewayProfile(req);

      if (!profile.ID) {
        throw new ServiceValidationError(
          [{ field: 'id', message: 'Salesforce ID not found for this user', code: 'SALESFORCE_ID_NOT_FOUND' }],
          'Salesforce ID not found'
        );
      }

      logger.success(req, 'get_salesforce_id', startTime, {});

      res.json({ id: profile.ID });
    } catch (error) {
      next(error);
    }
  }
}
