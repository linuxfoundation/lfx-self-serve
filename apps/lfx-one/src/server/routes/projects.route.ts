// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response, Router } from 'express';

import { ProjectController } from '../controllers/project.controller';
import { ServiceValidationError } from '../errors';
import { Logger } from '../helpers/logger';
import { SupabaseService } from '../services/supabase.service';

const router = Router();

const supabaseService = new SupabaseService();
const projectController = new ProjectController();

// Project CRUD routes - using new controller pattern
router.get('/', (req, res, next) => projectController.getProjects(req, res, next));

router.get('/search', (req, res, next) => projectController.searchProjects(req, res, next));

router.get('/pending-action-surveys', (req, res, next) => projectController.getPendingActionSurveys(req, res, next));

router.get('/:slug', (req, res, next) => projectController.getProjectBySlug(req, res, next));

router.get('/:uid/permissions', (req, res, next) => projectController.getProjectPermissions(req, res, next));

router.post('/:uid/permissions', (req, res, next) => projectController.addUserToProjectPermissions(req, res, next));

router.put('/:uid/permissions/:username', (req, res, next) => projectController.updateUserPermissionRole(req, res, next));

router.delete('/:uid/permissions/:username', (req, res, next) => projectController.removeUserFromProjectPermissions(req, res, next));

router.get('/:uid/recent-activity', async (req: Request, res: Response, next: NextFunction) => {
  const projectUid = req.params['uid'];
  const startTime = Logger.start(req, 'fetch_project_recent_activity', {
    has_project_uid: !!projectUid,
    query_params: Logger.sanitize(req.query as Record<string, any>),
  });

  try {
    if (!projectUid) {
      Logger.error(req, 'fetch_project_recent_activity', startTime, new Error('Missing project uid parameter'));

      const validationError = ServiceValidationError.forField('uid', 'Project uid is required', {
        operation: 'fetch_project_recent_activity',
        service: 'projects_route',
        path: req.path,
      });

      return next(validationError);
    }

    const recentActivity = await supabaseService.getRecentActivityByProject(projectUid, req.query as Record<string, any>);

    Logger.success(req, 'fetch_project_recent_activity', startTime, {
      project_uid: projectUid,
      activity_count: recentActivity.length,
    });

    res.json(recentActivity);
  } catch (error) {
    Logger.error(req, 'fetch_project_recent_activity', startTime, error, {
      project_uid: projectUid,
    });
    next(error);
  }
});

export default router;
