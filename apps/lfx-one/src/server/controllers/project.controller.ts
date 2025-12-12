// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AddUserToProjectRequest, UpdateUserRoleRequest } from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
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
    const startTime = logger.startOperation(req, 'get_projects', {
      query_params: logger.sanitize(req.query as Record<string, any>),
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

      logger.success(req, 'get_projects', startTime, {
        project_count: projects.length,
      });

      // Send the projects to the client
      res.json(projects);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projects/search
   */
  public async searchProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { q } = req.query;
    const startTime = logger.startOperation(req, 'search_projects', {
      has_query: !!q,
    });

    try {
      // Check if the search query is provided and is a string
      if (!q || typeof q !== 'string') {
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
      logger.success(req, 'search_projects', startTime, {
        result_count: results.length,
      });

      // Send the results to the client
      res.json(results);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projects/:slug
   */
  public async getProjectBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { slug } = req.params;
    const startTime = logger.startOperation(req, 'get_project_by_slug', {
      slug,
    });

    try {
      // Check if the project slug is provided
      if (!slug) {
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
      if (isUuid(slug)) {
        // If the slug is a uuid, get the project by id
        const project = await this.projectService.getProjectById(req, slug);
        res.json(project);
        return;
      }

      // If the slug is not a uuid, get the project by slug
      const project = await this.projectService.getProjectBySlug(req, slug);

      // Log the success
      logger.success(req, 'get_project_by_slug', startTime, {
        slug,
        project_uid: project.uid,
      });

      // Send the project to the client
      res.json(project);
    } catch (error) {
      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * GET /projects/:uid/permissions
   */
  public async getProjectPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_project_permissions', {
      uid,
    });

    try {
      // Check if the project uid is provided
      if (!uid) {
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
      logger.success(req, 'get_project_permissions', startTime, {
        uid,
        project_uid: settings.uid,
      });

      // Send the permissions to the client
      res.json(settings);
    } catch (error) {
      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * POST /projects/:uid/permissions - Add user
   */
  public async addUserToProjectPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'add_user_project_permissions', {
      uid,
    });

    try {
      // Validate project uid
      if (!uid) {
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

      // Check if manual user data is provided (for users not found in directory)
      let manualUserInfo: { name: string; email: string; username: string; avatar?: string } | undefined;
      if (userData.name || userData.email || userData.avatar) {
        manualUserInfo = {
          name: userData.name || '',
          email: userData.email || '',
          username: userData.username, // Keep the original input for manual user info
        };
        // Only include avatar if it's not empty
        if (userData.avatar) {
          manualUserInfo.avatar = userData.avatar;
        }
      }

      // Pass the original input (email or username) to updateProjectPermissions
      // The service will handle the email_to_sub -> email_to_username flow internally
      const result = await this.projectService.updateProjectPermissions(req, uid, 'add', userData.username, userData.role, manualUserInfo);

      logger.success(req, 'add_user_project_permissions', startTime, {
        uid,
        username: userData.username,
        role: userData.role,
        is_email: isEmail,
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /projects/:uid/permissions/:username - Update user role
   */
  public async updateUserPermissionRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, username } = req.params;
    const startTime = logger.startOperation(req, 'update_user_role_project_permissions', {
      uid,
      username,
    });

    try {
      // Validate parameters
      if (!uid) {
        const validationError = ServiceValidationError.forField('uid', 'Project uid is required', {
          operation: 'update_user_role_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      if (!username) {
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
        const validationError = ServiceValidationError.forField('role', 'Role must be either "view" or "manage"', {
          operation: 'update_user_role_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      const result = await this.projectService.updateProjectPermissions(req, uid, 'update', username, roleData.role);

      logger.success(req, 'update_user_role_project_permissions', startTime, {
        uid,
        username,
        new_role: roleData.role,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /projects/:uid/permissions/:username - Remove user
   */
  public async removeUserFromProjectPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid, username } = req.params;
    const startTime = logger.startOperation(req, 'remove_user_project_permissions', {
      uid,
      username,
    });

    try {
      // Validate parameters
      if (!uid) {
        const validationError = ServiceValidationError.forField('uid', 'Project uid is required', {
          operation: 'remove_user_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      if (!username) {
        const validationError = ServiceValidationError.forField('username', 'Username is required', {
          operation: 'remove_user_project_permissions',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      await this.projectService.updateProjectPermissions(req, uid, 'remove', username);

      logger.success(req, 'remove_user_project_permissions', startTime, {
        uid,
        username,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /projects/pending-action-surveys - Get pending survey actions for the authenticated user
   */
  public async getPendingActionSurveys(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_pending_action_surveys');

    try {
      // Extract user email from OIDC
      const userEmail = req.oidc?.user?.['email'];
      if (!userEmail) {
        const validationError = ServiceValidationError.forField('email', 'User email not found in authentication context', {
          operation: 'get_pending_action_surveys',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Extract projectSlug from query parameters
      const projectSlug = req.query['projectSlug'] as string | undefined;
      if (!projectSlug) {
        const validationError = ServiceValidationError.forField('projectSlug', 'projectSlug query parameter is required', {
          operation: 'get_pending_action_surveys',
          service: 'project_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Get pending surveys from service
      const pendingActions = await this.projectService.getPendingActionSurveys(userEmail, projectSlug);

      logger.success(req, 'get_pending_action_surveys', startTime, {
        project_slug: projectSlug,
        survey_count: pendingActions.length,
      });

      res.json(pendingActions);
    } catch (error) {
      next(error);
    }
  }
}
