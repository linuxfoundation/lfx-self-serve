// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request, Response } from 'express';

import { Logger } from '../helpers/logger';
import { Responder } from '../helpers/responder';
import { ProjectService } from '../services/project.service';

/**
 * Controller for handling project HTTP requests
 */
export class ProjectController {
  private projectService: ProjectService = new ProjectService();

  /**
   * GET /projects
   */
  public async getProjects(req: Request, res: Response): Promise<void> {
    const startTime = Logger.start(req, 'get_projects', {
      query_params: Logger.sanitize(req.query as Record<string, any>),
    });

    try {
      const projects = await this.projectService.getProjects(req, req.query as Record<string, any>);

      Logger.success(req, 'get_projects', startTime, {
        project_count: projects.length,
      });

      res.json(projects);
    } catch (error) {
      Logger.error(req, 'get_projects', startTime, error);
      Responder.handle(res, error, 'get_projects');
    }
  }

  /**
   * GET /projects/search
   */
  public async searchProjects(req: Request, res: Response): Promise<void> {
    const { q } = req.query;
    const startTime = Logger.start(req, 'search_projects', {
      has_query: !!q,
    });

    try {
      if (!q || typeof q !== 'string') {
        Logger.error(req, 'search_projects', startTime, new Error('Missing or invalid search query'), {
          query_type: typeof q,
        });

        Responder.badRequest(res, 'Search query is required', {
          code: 'MISSING_SEARCH_QUERY',
        });
        return;
      }

      const results = await this.projectService.searchProjects(req, q);

      Logger.success(req, 'search_projects', startTime, {
        result_count: results.length,
      });

      res.json(results);
    } catch (error) {
      Logger.error(req, 'search_projects', startTime, error);
      Responder.handle(res, error, 'search_projects');
    }
  }

  /**
   * GET /projects/:slug
   */
  public async getProjectBySlug(req: Request, res: Response): Promise<void> {
    const { slug } = req.params;
    const startTime = Logger.start(req, 'get_project_by_slug', {
      slug,
    });

    try {
      if (!slug) {
        Logger.error(req, 'get_project_by_slug', startTime, new Error('Missing project slug parameter'));

        Responder.badRequest(res, 'Project Slug is required', {
          code: 'MISSING_PROJECT_SLUG',
        });
        return;
      }

      const project = await this.projectService.getProjectBySlug(req, slug);

      Logger.success(req, 'get_project_by_slug', startTime, {
        slug,
        project_uid: project.uid,
      });

      res.json(project);
    } catch (error) {
      Logger.error(req, 'get_project_by_slug', startTime, error, {
        slug,
      });
      Responder.handle(res, error, 'get_project_by_slug');
    }
  }
}
