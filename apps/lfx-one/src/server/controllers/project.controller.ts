// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { Logger } from '../helpers/logger';
import { CommitteeService } from '../services/committee.service';
import { MeetingService } from '../services/meeting.service';
import { ProjectService } from '../services/project.service';

/**
 * Controller for handling project HTTP requests
 */
export class ProjectController {
  private projectService: ProjectService = new ProjectService();
  private meetingService: MeetingService = new MeetingService();
  private committeeService: CommitteeService = new CommitteeService();

  /**
   * GET /projects
   */
  public async getProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_projects', {
      query_params: Logger.sanitize(req.query as Record<string, any>),
    });

    try {
      // Get the projects
      const projects = await this.projectService.getProjects(req, req.query as Record<string, any>);

      // Add metrics to all projects
      // TODO: Remove this once we have a way to get the metrics from the microservice
      await Promise.all(
        projects.map(async (project) => {
          project.meetings_count = (await this.meetingService.getMeetings(req, { tags: `project_uid:${project.uid}` }).catch(() => [])).length;
          project.committees_count = (await this.committeeService.getCommittees(req, { tags: `project_uid:${project.uid}` }).catch(() => [])).length;
        })
      );

      Logger.success(req, 'get_projects', startTime, {
        project_count: projects.length,
      });

      // Send the projects to the client
      res.json(projects);
    } catch (error) {
      // Log the error
      Logger.error(req, 'get_projects', startTime, error);
      next(error);
    }
  }

  /**
   * GET /projects/search
   */
  public async searchProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { q } = req.query;
    const startTime = Logger.start(req, 'search_projects', {
      has_query: !!q,
    });

    try {
      // Check if the search query is provided and is a string
      if (!q || typeof q !== 'string') {
        Logger.error(req, 'search_projects', startTime, new Error('Missing or invalid search query'), {
          query_type: typeof q,
        });

        // Create a validation error
        const validationError = ServiceValidationError.forField('q', 'Search query is required and must be a string', {
          operation: 'search_projects',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Search for the projects
      const results = await this.projectService.searchProjects(req, q);

      // Add metrics to all projects
      // TODO: Remove this once we have a way to get the metrics from the microservice
      await Promise.all(
        results.map(async (project) => {
          project.meetings_count = (await this.meetingService.getMeetings(req, { tags: `project_uid:${project.uid}` }).catch(() => [])).length;
          project.committees_count = (await this.committeeService.getCommittees(req, { tags: `project_uid:${project.uid}` }).catch(() => [])).length;
        })
      );

      // Log the success
      Logger.success(req, 'search_projects', startTime, {
        result_count: results.length,
      });

      // Send the results to the client
      res.json(results);
    } catch (error) {
      // Log the error
      Logger.error(req, 'search_projects', startTime, error);
      next(error);
    }
  }

  /**
   * GET /projects/:slug
   */
  public async getProjectBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { slug } = req.params;
    const startTime = Logger.start(req, 'get_project_by_slug', {
      slug,
    });

    try {
      // Check if the project slug is provided
      if (!slug) {
        Logger.error(req, 'get_project_by_slug', startTime, new Error('Missing project slug parameter'));

        // Create a validation error
        const validationError = ServiceValidationError.forField('slug', 'Project slug is required', {
          operation: 'get_project_by_slug',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Check if slug is a uuid
      if (this.isUuid(slug)) {
        // If the slug is a uuid, get the project by id
        const project = await this.projectService.getProjectById(req, slug);
        res.json(project);
        return;
      }

      // If the slug is not a uuid, get the project by slug
      const project = await this.projectService.getProjectBySlug(req, slug);

      // Log the success
      Logger.success(req, 'get_project_by_slug', startTime, {
        slug,
        project_uid: project.uid,
      });

      // Send the project to the client
      res.json(project);
    } catch (error) {
      // Log the error
      Logger.error(req, 'get_project_by_slug', startTime, error, {
        slug,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  private isUuid(slug: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
  }
}
