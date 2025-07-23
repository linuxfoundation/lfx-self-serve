// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response, Router } from 'express';

import { SupabaseService } from '../services/supabase.service';

const router = Router();
const supabaseService = new SupabaseService();

/**
 * GET /api/projects/:projectId/permissions
 * Get all user permissions for a specific project
 */
router.get('/:projectId/permissions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;

    if (!projectId) {
      return res.status(400).json({
        error: 'Project ID is required',
        code: 'MISSING_PROJECT_ID',
      });
    }

    req.log.info({ projectId }, 'Fetching project permissions');

    const permissions = await supabaseService.getProjectPermissions(projectId);

    return res.json(permissions);
  } catch (error) {
    req.log.error({ error, projectId: req.params['projectId'] }, 'Error fetching project permissions');
    return next(error);
  }
});

export default router;
