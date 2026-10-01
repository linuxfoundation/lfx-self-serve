// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PROJECT_APPLICATION_CACHE_CONTROL, PROJECT_APPLICATION_STAFF_KEYS, PROJECT_SLUG_REGEX, UUID_REGEX } from '@lfx-one/shared/constants';
import type { ProjectApplicationAnswers, ProjectApplicationWriteResult } from '@lfx-one/shared/interfaces';
import { validateProjectApplicationAnswers } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { parseIfMatch } from '../helpers/if-match.helper';
import { logger } from '../services/logger.service';
import { projectApplicationService } from '../services/project-application.service';
import { getEffectiveEmail, getEffectiveName, getUsernameFromAuth, stripAuthPrefix } from '../utils/auth-helper';

/** `GET /api/project-applications/mine` — the signed-in user's own proposals (My Formations → Submitted proposals). */
export const listMyProjectApplications = async (req: Request, res: Response, next: NextFunction) => {
  const startTime = logger.startOperation(req, 'list_my_project_applications');
  try {
    const username = await requireUsername(req, 'list_my_project_applications');
    const applications = await projectApplicationService.listMine(req, username);
    res.set('Cache-Control', PROJECT_APPLICATION_CACHE_CONTROL);
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
    res.set('Cache-Control', PROJECT_APPLICATION_CACHE_CONTROL);
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
    res.set('Cache-Control', PROJECT_APPLICATION_CACHE_CONTROL);
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
    // Nobody places or creates a project at submit time — the formation team does both at accept.
    omitStaffKeys(application);

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

/**
 * `PUT /api/project-applications/:uid` — replace the complete answer map. `parent_project_uid`,
 * `project_slug` and `project_uid` are the formation team's accept-time record. Upstream stores them as
 * ordinary answers any `writer` could rewrite, so this BFF drops them from a revise sent by anyone outside
 * the formation team rather than refusing the revise: an accept that recorded them and then failed leaves
 * the keys in the submitter's held answers, and refusing would lock them out of editing their own proposal.
 * The team sets them again at accept.
 */
export const reviseProjectApplication = async (req: Request, res: Response, next: NextFunction) => {
  const operation = 'revise_project_application';
  const startTime = logger.startOperation(req, operation);
  try {
    const uid = parseUid(req, operation);
    const ifMatch = parseIfMatch(req, operation);
    const application = parseAnswers(req, operation);
    if (PROJECT_APPLICATION_STAFF_KEYS.some((key) => application[key] !== undefined) && !(await projectApplicationService.isFormationTeamMemberStrict(req))) {
      omitStaffKeys(application);
    }
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
 * `POST /api/project-applications/:uid/accept` — body `{ parent_project_uid, project_slug, application }`.
 * Accepting creates the project in project-service (#1995), so both the parent it goes under and its slug
 * are required.
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
    const projectSlug = req.body?.project_slug;
    if (typeof projectSlug !== 'string' || !PROJECT_SLUG_REGEX.test(projectSlug)) {
      throw ServiceValidationError.forField(
        'project_slug',
        'A project slug is required: lowercase letters, numbers, "-" or "_", starting with a letter and ending with a letter or number',
        { operation, path: req.path }
      );
    }
    const application = parseAnswers(req, operation);
    const result = await projectApplicationService.accept(req, uid, ifMatch, application, parentProjectUid, projectSlug);
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

function omitStaffKeys(application: ProjectApplicationAnswers): void {
  for (const key of PROJECT_APPLICATION_STAFF_KEYS) {
    delete application[key];
  }
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
  res.set('Cache-Control', PROJECT_APPLICATION_CACHE_CONTROL);
  logger.success(req, operation, startTime, { uid: result.application.uid, state: result.application.state, revision: result.application.revision });
  return res.json(result);
}
