// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { UUID_REGEX } from '@lfx-one/shared/constants';
import type { ProjectApplicationAnswers, ProjectApplicationWriteResult } from '@lfx-one/shared/interfaces';
import { validateProjectApplicationAnswers } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { parseIfMatch } from '../helpers/if-match.helper';
import { logger } from '../services/logger.service';
import { projectApplicationService } from '../services/project-application.service';
import { getEffectiveEmail, getEffectiveName, getUsernameFromAuth, stripAuthPrefix } from '../utils/auth-helper';

/** Private answers: never cache, never share. */
const PRIVATE_NO_STORE = 'private, no-store';

/** `GET /api/project-applications/mine` — the signed-in user's own proposals (My Formations → Submitted proposals). */
export const listMyProjectApplications = async (req: Request, res: Response, next: NextFunction) => {
  const startTime = logger.startOperation(req, 'list_my_project_applications');
  try {
    const username = await requireUsername(req, 'list_my_project_applications');
    const applications = await projectApplicationService.listMine(req, username);
    res.set('Cache-Control', PRIVATE_NO_STORE);
    logger.success(req, 'list_my_project_applications', startTime, { count: applications.length });
    return res.json(applications);
  } catch (error) {
    return next(error);
  }
};

/** `GET /api/project-applications/queue` — the formation team's review queue. query-service filters by access. */
export const listProjectApplicationQueue = async (req: Request, res: Response, next: NextFunction) => {
  const startTime = logger.startOperation(req, 'list_project_application_queue');
  try {
    await requireUsername(req, 'list_project_application_queue');
    const applications = await projectApplicationService.listQueue(req);
    res.set('Cache-Control', PRIVATE_NO_STORE);
    logger.success(req, 'list_project_application_queue', startTime, { count: applications.length });
    return res.json(applications);
  } catch (error) {
    return next(error);
  }
};

/** `GET /api/project-applications/access` — whether the caller is on the formation team. */
export const getProjectApplicationAccess = async (req: Request, res: Response, next: NextFunction) => {
  const startTime = logger.startOperation(req, 'get_project_application_access');
  try {
    await requireUsername(req, 'get_project_application_access');
    const isFormationTeam = await projectApplicationService.isFormationTeamMember(req);
    res.set('Cache-Control', PRIVATE_NO_STORE);
    logger.success(req, 'get_project_application_access', startTime, { is_formation_team: isFormationTeam });
    return res.json({ is_formation_team: isFormationTeam });
  } catch (error) {
    return next(error);
  }
};

/**
 * `POST /api/project-applications` — submit a proposal. The submitter identity comes from the session
 * only; anything identity-shaped in the browser body is ignored because only `application` is read.
 */
export const createProjectApplication = async (req: Request, res: Response, next: NextFunction) => {
  const operation = 'create_project_application';
  const startTime = logger.startOperation(req, operation);
  try {
    const username = await requireUsername(req, operation);
    const name = getEffectiveName(req)?.trim();
    const email = getEffectiveEmail(req)?.trim();
    if (!email) {
      throw ServiceValidationError.forField('submitter_email', 'Your account has no email address; add one to your profile before proposing a project', {
        operation,
        path: req.path,
      });
    }
    const application = parseAnswers(req, operation);

    const result = await projectApplicationService.create(req, {
      submitter_username: username,
      submitter_name: name || username,
      submitter_email: email,
      application,
    });
    logger.success(req, operation, startTime, { uid: result.application.uid, state: result.application.state });
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
};

/** `PUT /api/project-applications/:uid` — replace the complete answer map. */
export const reviseProjectApplication = async (req: Request, res: Response, next: NextFunction) => {
  const operation = 'revise_project_application';
  const startTime = logger.startOperation(req, operation);
  try {
    const uid = parseUid(req, operation);
    const ifMatch = parseIfMatch(req, operation);
    const application = parseAnswers(req, operation);
    const result = await projectApplicationService.revise(req, uid, ifMatch, application);
    return sendWriteResult(req, res, operation, startTime, result);
  } catch (error) {
    return next(error);
  }
};

/** `POST /api/project-applications/:uid/withdraw` */
export const withdrawProjectApplication = async (req: Request, res: Response, next: NextFunction) => {
  const operation = 'withdraw_project_application';
  const startTime = logger.startOperation(req, operation);
  try {
    const uid = parseUid(req, operation);
    const ifMatch = parseIfMatch(req, operation);
    const result = await projectApplicationService.withdraw(req, uid, ifMatch);
    return sendWriteResult(req, res, operation, startTime, result);
  } catch (error) {
    return next(error);
  }
};

/**
 * `POST /api/project-applications/:uid/accept` — body `{ parent_project_uid, application }`. The parent is
 * required: the backend creates the project from the accepted application and needs its placement.
 */
export const acceptProjectApplication = async (req: Request, res: Response, next: NextFunction) => {
  const operation = 'accept_project_application';
  const startTime = logger.startOperation(req, operation);
  try {
    const uid = parseUid(req, operation);
    const ifMatch = parseIfMatch(req, operation);
    const parentProjectUid = req.body?.parent_project_uid;
    if (typeof parentProjectUid !== 'string' || !UUID_REGEX.test(parentProjectUid)) {
      throw ServiceValidationError.forField('parent_project_uid', 'A parent project is required to accept an application', { operation, path: req.path });
    }
    const application = parseAnswers(req, operation);
    const result = await projectApplicationService.accept(req, uid, ifMatch, application, parentProjectUid);
    return sendWriteResult(req, res, operation, startTime, result);
  } catch (error) {
    return next(error);
  }
};

/** `POST /api/project-applications/:uid/deny` — no reason is sent; the backend contract has none. */
export const denyProjectApplication = async (req: Request, res: Response, next: NextFunction) => {
  const operation = 'deny_project_application';
  const startTime = logger.startOperation(req, operation);
  try {
    const uid = parseUid(req, operation);
    const ifMatch = parseIfMatch(req, operation);
    const result = await projectApplicationService.deny(req, uid, ifMatch);
    return sendWriteResult(req, res, operation, startTime, result);
  } catch (error) {
    return next(error);
  }
};

/** `DELETE /api/project-applications/:uid` — removes the application and its indexed document. */
export const deleteProjectApplication = async (req: Request, res: Response, next: NextFunction) => {
  const operation = 'delete_project_application';
  const startTime = logger.startOperation(req, operation);
  try {
    const uid = parseUid(req, operation);
    const ifMatch = parseIfMatch(req, operation);
    await projectApplicationService.remove(req, uid, ifMatch);
    logger.success(req, operation, startTime, { uid });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
};

async function requireUsername(req: Request, operation: string): Promise<string> {
  const username = await getUsernameFromAuth(req);
  if (!username) {
    throw new AuthenticationError('User authentication required', { operation });
  }
  return stripAuthPrefix(username);
}

function parseUid(req: Request, operation: string): string {
  const uid = req.params['uid'];
  if (typeof uid !== 'string' || !UUID_REGEX.test(uid)) {
    throw ServiceValidationError.forField('uid', 'A valid application UID is required', { operation, path: req.path });
  }
  return uid;
}

/** Reads and validates `body.application` against the backend's canonical-field rules. */
function parseAnswers(req: Request, operation: string): ProjectApplicationAnswers {
  const application = req.body?.application;
  const issues = validateProjectApplicationAnswers(application);
  if (issues.length > 0) {
    throw ServiceValidationError.forField(issues[0].field, issues[0].message, { operation, path: req.path });
  }
  return application as ProjectApplicationAnswers;
}

function sendWriteResult(req: Request, res: Response, operation: string, startTime: number, result: ProjectApplicationWriteResult) {
  if (result.etag) {
    res.set('ETag', result.etag);
  }
  res.set('Cache-Control', PRIVATE_NO_STORE);
  logger.success(req, operation, startTime, { uid: result.application.uid, state: result.application.state, revision: result.application.revision });
  return res.json(result);
}
