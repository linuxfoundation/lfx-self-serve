// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response, Router } from 'express';

import { ProjectController } from '../controllers/project.controller';
import { SupabaseService } from '../services/supabase.service';

const router = Router();

const supabaseService = new SupabaseService();
const projectController = new ProjectController();

// Project CRUD routes - using new controller pattern
router.get('/', (req, res) => projectController.getProjects(req, res));

router.get('/search', (req, res) => projectController.searchProjects(req, res));

router.get('/:slug', (req, res) => projectController.getProjectBySlug(req, res));

router.get('/:uid/recent-activity', async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const projectUid = req.params['uid'];

  req.log.info(
    {
      operation: 'fetch_project_recent_activity',
      has_project_uid: !!projectUid,
      query_params: req.query,
    },
    'Starting project recent activity fetch request'
  );

  try {
    if (!projectUid) {
      req.log.warn(
        {
          operation: 'fetch_project_recent_activity',
          error: 'Missing project uid parameter',
          status_code: 400,
        },
        'Bad request: Project uid validation failed'
      );

      return res.status(400).json({
        error: 'Project uid is required',
        code: 'MISSING_PROJECT_UID',
      });
    }

    const recentActivity = await supabaseService.getRecentActivityByProject(projectUid, req.query as Record<string, any>);
    const duration = Date.now() - startTime;

    req.log.info(
      {
        operation: 'fetch_project_recent_activity',
        project_uid: projectUid,
        activity_count: recentActivity.length,
        duration,
        status_code: 200,
      },
      'Successfully fetched project recent activity'
    );

    return res.json(recentActivity);
  } catch (error) {
    const duration = Date.now() - startTime;
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        operation: 'fetch_project_recent_activity',
        duration,
      },
      'Failed to fetch recent activity for project'
    );
    return next(error);
  }
});

export default router;
