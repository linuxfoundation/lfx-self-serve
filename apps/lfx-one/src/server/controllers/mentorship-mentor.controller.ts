// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MentorshipMentorInviteDecision } from '@lfx-one/shared/interfaces';
import { isMentorshipMentorInviteToken, isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { parseMentorshipMentorRegisterRequest } from '../helpers/mentorship-mentor-register.helper';
import { parseMentorshipMentorOpenProgramsQuery } from '../helpers/mentorship-mentor-request.helper';
import { parseTrimmedString } from '../helpers/mentorship-params.helper';
import { logger } from '../services/logger.service';
import { MentorshipMentorService } from '../services/mentorship-mentor.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

export class MentorshipMentorController {
  private readonly mentorService = new MentorshipMentorService();

  // GET /api/mentorship/mentor/has-profile
  // Auth: logged-in user required (401 otherwise). Upstream scopes the read to the caller's token.
  public async hasMentorProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'has_mentorship_mentor_profile');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'has_mentorship_mentor_profile' });
      }

      const result = await this.mentorService.hasMentorProfile(req);
      logger.success(req, 'has_mentorship_mentor_profile', startTime, { hasProfile: result.hasProfile });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/mentorship/mentor/profile  (register form body) -> 204
  // Auth: logged-in user required (401 otherwise). The body is validated with the rules the form
  // uses (400 with per-field errors). An existing profile is refused with a 409 rather than
  // replaced; upstream's 403 passes through.
  public async registerMentorProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'register_mentorship_mentor_profile');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'register_mentorship_mentor_profile' });
      }

      const request = parseMentorshipMentorRegisterRequest(req.body);
      await this.mentorService.registerMentorProfile(req, request);
      logger.success(req, 'register_mentorship_mentor_profile', startTime, { skills_count: request.skills.length });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/mentor/open-programs?search=&offset=
  // Auth: logged-in user required (401 otherwise). One page of published programs, as id and name,
  // with the total that match. A bad offset or an over-long search is a 400.
  public async getOpenPrograms(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_mentor_open_programs');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_mentor_open_programs' });
      }

      const query = parseMentorshipMentorOpenProgramsQuery(req.query);
      const programs = await this.mentorService.getOpenPrograms(req, query);
      logger.success(req, 'get_mentorship_mentor_open_programs', startTime, { result_count: programs.data.length, total: programs.total });
      res.json(programs);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/mentor/requests
  // Auth: logged-in user required (401 otherwise). Upstream scopes the read to the caller's token.
  public async getMentorRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_mentor_requests');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_mentor_requests' });
      }

      const requests = await this.mentorService.getMentorRequests(req);
      logger.success(req, 'get_mentorship_mentor_requests', startTime, { result_count: requests.data.length });
      res.json(requests);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/mentorship/mentor/requests  { programId } -> 204
  // Auth: logged-in user required (401 otherwise). Upstream's 404 (program gone or hidden) and 409 (a
  // request, invitation, membership or declined request for that program already) pass through.
  public async requestToMentor(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'request_mentorship_mentor_program');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'request_mentorship_mentor_program' });
      }

      // Upstream takes only a program UUID and answers anything else with a 400, so refuse it here first.
      const programId = parseTrimmedString(req.body?.programId);
      if (!programId || !isUuid(programId)) {
        throw ServiceValidationError.forField('programId', 'programId must be a program UUID', { operation: 'request_mentorship_mentor_program' });
      }

      await this.mentorService.requestToMentor(req, programId);
      logger.success(req, 'request_mentorship_mentor_program', startTime, { programId });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // POST /api/mentorship/mentor/requests/:requestId/withdraw -> 204
  // Auth: logged-in user required (401 otherwise). Upstream's 404 passes through when the request is not
  // the caller's, and its 409 once the request is no longer pending.
  public async withdrawMentorRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'withdraw_mentorship_mentor_request');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'withdraw_mentorship_mentor_request' });
      }

      // A request is a `program_members` row, which upstream addresses only by UUID.
      const requestId = parseTrimmedString(req.params['requestId']);
      if (!requestId || !isUuid(requestId)) {
        throw ServiceValidationError.forField('requestId', 'requestId must be a request UUID', { operation: 'withdraw_mentorship_mentor_request' });
      }

      await this.mentorService.withdrawMentorRequest(req, requestId);
      logger.success(req, 'withdraw_mentorship_mentor_request', startTime, { requestId });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // POST /api/mentorship/mentor/invites/accept  { token } -> 204
  public async acceptMentorInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
    await this.respondToMentorInvite(req, res, next, 'accept');
  }

  // POST /api/mentorship/mentor/invites/decline  { token } -> 204
  public async declineMentorInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
    await this.respondToMentorInvite(req, res, next, 'decline');
  }

  // GET /api/mentorship/mentor/programs
  public async getMentorPrograms(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_mentor_programs');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_mentor_programs' });
      }

      const programs = await this.mentorService.getMentorPrograms(req);
      logger.success(req, 'get_mentorship_mentor_programs', startTime, { result_count: programs.data.length });
      res.json(programs);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/mentor/programs/:programId — id (default) or slug
  public async getMentorProgram(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_mentor_program');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_mentor_program' });
      }

      const programId = typeof req.params['programId'] === 'string' ? req.params['programId'].trim() : '';
      if (!programId) {
        throw ServiceValidationError.forField('programId', 'Program id or slug is required.', { operation: 'get_mentorship_mentor_program' });
      }

      const program = await this.mentorService.getMentorProgram(req, programId);
      logger.success(req, 'get_mentorship_mentor_program', startTime, { programId });
      res.json(program);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/mentor/profile
  public async getMentorProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_mentor_profile');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_mentor_profile' });
      }

      const profile = await this.mentorService.getMentorProfile(req);
      logger.success(req, 'get_mentorship_mentor_profile', startTime, { history_count: profile.history.length });
      res.json(profile);
    } catch (error) {
      next(error);
    }
  }

  // Auth: logged-in user required (401 otherwise). The token travels in the body so it stays out of
  // this server's access logs; a malformed one is a 400. Upstream's 400 (expired, or already
  // answered) and 403 (another user's invitation) pass through.
  private async respondToMentorInvite(req: Request, res: Response, next: NextFunction, decision: MentorshipMentorInviteDecision): Promise<void> {
    const operation = `${decision}_mentorship_mentor_invite`;
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const token = parseTrimmedString(req.body?.token);
      if (!token || !isMentorshipMentorInviteToken(token)) {
        throw ServiceValidationError.forField('token', 'token must be a mentor invite token', { operation });
      }

      await this.mentorService.respondToMentorInvite(req, token, decision);
      logger.success(req, operation, startTime);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
