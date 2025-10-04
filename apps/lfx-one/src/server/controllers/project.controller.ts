// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AddUserToProjectRequest, UpdateUserRoleRequest } from '@lfx-one/shared/interfaces';
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
      await Promise.all(
        projects.map(async (project) => {
          project.meetings_count = Number(await this.meetingService.getMeetingsCount(req, { tags: `project_uid:${project.uid}` }).catch(() => 0));
          project.committees_count = Number(await this.committeeService.getCommitteesCount(req, { tags: `project_uid:${project.uid}` }).catch(() => 0));
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
      await Promise.all(
        results.map(async (project) => {
          project.meetings_count = Number(await this.meetingService.getMeetingsCount(req, { tags: `project_uid:${project.uid}` }).catch(() => 0));
          project.committees_count = Number(await this.committeeService.getCommitteesCount(req, { tags: `project_uid:${project.uid}` }).catch(() => 0));
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

  /**
   * GET /projects/:uid/permissions
   */
  public async getProjectPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = Logger.start(req, 'get_project_permissions', {
      uid,
    });

    try {
      // Check if the project uid is provided
      if (!uid) {
        Logger.error(req, 'get_project_permissions', startTime, new Error('Missing project uid parameter'));

        // Create a validation error
        const validationError = ServiceValidationError.forField('uid', 'Project uid is required', {
          operation: 'get_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Get the project permissions
      const settings = await this.projectService.getProjectSettings(req, uid);

      // Log the success
      Logger.success(req, 'get_project_permissions', startTime, {
        uid,
        project_uid: settings.uid,
      });

      // Send the permissions to the client
      res.json(settings);
    } catch (error) {
      // Log the error
      Logger.error(req, 'get_project_permissions', startTime, error, {
        uid,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * POST /projects/:uid/permissions - Add user
   */
  public async addUserToProjectPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = Logger.start(req, 'add_user_project_permissions', {
      uid,
    });

    try {
      // Validate project uid
      if (!uid) {
        Logger.error(req, 'add_user_project_permissions', startTime, new Error('Missing project uid parameter'));

        const validationError = ServiceValidationError.forField('uid', 'Project uid is required', {
          operation: 'add_user_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const userData: AddUserToProjectRequest = req.body;

      // Validate required fields
      if (!userData.username || !userData.role) {
        Logger.error(req, 'add_user_project_permissions', startTime, new Error('Missing required fields'));

        const validationError = ServiceValidationError.forField('body', 'Username and role are required', {
          operation: 'add_user_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Validate role value
      if (!['view', 'manage'].includes(userData.role)) {
        Logger.error(req, 'add_user_project_permissions', startTime, new Error('Invalid role value'));

        const validationError = ServiceValidationError.forField('role', 'Role must be either "view" or "manage"', {
          operation: 'add_user_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Detect if input is email or username
      const isEmail = userData.username.includes('@');
      let username = userData.username;

      if (isEmail) {
        req.log.info(
          {
            email: userData.username,
            operation: 'add_user_project_permissions',
          },
          'Email detected, resolving to username via NATS'
        );

        // Resolve email to username via NATS
        username = await this.projectService.resolveEmailToUsername(req, userData.username);

        req.log.info(
          {
            email: userData.username,
            username,
            operation: 'add_user_project_permissions',
          },
          'Successfully resolved email to username'
        );
      }

      const result = await this.projectService.updateProjectPermissions(req, uid, 'add', username, userData.role);

      Logger.success(req, 'add_user_project_permissions', startTime, {
        uid,
        username,
        role: userData.role,
        resolved_from_email: isEmail,
      });

      res.status(201).json(result);
    } catch (error) {
      Logger.error(req, 'add_user_project_permissions', startTime, error, {
        uid,
      });
      next(error);
    }
  }

  /**
   * PUT /projects/:uid/permissions/:username - Update user role
   */
  public async updateUserPermissionRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, username } = req.params;
    const startTime = Logger.start(req, 'update_user_role_project_permissions', {
      uid,
      username,
    });

    try {
      // Validate parameters
      if (!uid) {
        Logger.error(req, 'update_user_role_project_permissions', startTime, new Error('Missing project uid parameter'));

        const validationError = ServiceValidationError.forField('uid', 'Project uid is required', {
          operation: 'update_user_role_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      if (!username) {
        Logger.error(req, 'update_user_role_project_permissions', startTime, new Error('Missing username parameter'));

        const validationError = ServiceValidationError.forField('username', 'Username is required', {
          operation: 'update_user_role_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const roleData: UpdateUserRoleRequest = req.body;

      // Validate required fields
      if (!roleData.role) {
        Logger.error(req, 'update_user_role_project_permissions', startTime, new Error('Missing role field'));

        const validationError = ServiceValidationError.forField('role', 'Role is required', {
          operation: 'update_user_role_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Validate role value
      if (!['view', 'manage'].includes(roleData.role)) {
        Logger.error(req, 'update_user_role_project_permissions', startTime, new Error('Invalid role value'));

        const validationError = ServiceValidationError.forField('role', 'Role must be either "view" or "manage"', {
          operation: 'update_user_role_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const result = await this.projectService.updateProjectPermissions(req, uid, 'update', username, roleData.role);

      Logger.success(req, 'update_user_role_project_permissions', startTime, {
        uid,
        username,
        new_role: roleData.role,
      });

      res.json(result);
    } catch (error) {
      Logger.error(req, 'update_user_role_project_permissions', startTime, error, {
        uid,
        username,
      });
      next(error);
    }
  }

  /**
   * DELETE /projects/:uid/permissions/:username - Remove user
   */
  public async removeUserFromProjectPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, username } = req.params;
    const startTime = Logger.start(req, 'remove_user_project_permissions', {
      uid,
      username,
    });

    try {
      // Validate parameters
      if (!uid) {
        Logger.error(req, 'remove_user_project_permissions', startTime, new Error('Missing project uid parameter'));

        const validationError = ServiceValidationError.forField('uid', 'Project uid is required', {
          operation: 'remove_user_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      if (!username) {
        Logger.error(req, 'remove_user_project_permissions', startTime, new Error('Missing username parameter'));

        const validationError = ServiceValidationError.forField('username', 'Username is required', {
          operation: 'remove_user_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      await this.projectService.updateProjectPermissions(req, uid, 'remove', username);

      Logger.success(req, 'remove_user_project_permissions', startTime, {
        uid,
        username,
      });

      res.status(204).send();
    } catch (error) {
      Logger.error(req, 'remove_user_project_permissions', startTime, error, {
        uid,
        username,
      });
      next(error);
    }
  }

  private isUuid(slug: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
  }
}
