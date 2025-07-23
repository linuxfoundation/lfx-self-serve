// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response, Router } from 'express';

import { SupabaseService } from '../services/supabase.service';

const router = Router();

const supabaseService = new SupabaseService();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projects = await supabaseService.getProjects(req.query as Record<string, any>);

    return res.json(projects);
  } catch (error) {
    console.error('Failed to fetch projects:', error);
    return next(error);
  }
});

router.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectSlug = req.params['slug'];

    if (!projectSlug) {
      return res.status(400).json({
        error: 'Project Slug is required',
        code: 'MISSING_PROJECT_SLUG',
      });
    }

    const project = await supabaseService.getProjectBySlug(projectSlug);

    if (!project) {
      return res.status(404).json({
        error: 'Project not found',
        code: 'PROJECT_NOT_FOUND',
      });
    }

    return res.json(project);
  } catch (error) {
    console.error(`Failed to fetch project ${req.params['slug']}:`, error);
    return next(error);
  }
});

export default router;
