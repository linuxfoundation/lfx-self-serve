// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreateUserPermissionRequest, UpdateUserPermissionRequest } from '@lfx-pcc/shared/interfaces';
import { NextFunction, Request, Response, Router } from 'express';

import { ServiceValidationError } from '../errors';
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
      const validationError = ServiceValidationError.forField('projectId', 'Project ID is required', {
        operation: 'get_project_permissions',
        service: 'permissions_route',
        path: req.path,
      });

      return next(validationError);
    }

    req.log.info({ projectId }, 'Fetching project permissions');

    const permissions = await supabaseService.getProjectPermissions(projectId);

    return res.json(permissions);
  } catch (error) {
    req.log.error({ error, projectId: req.params['projectId'] }, 'Error fetching project permissions');
    return next(error);
  }
});

/**
 * POST /api/projects/:projectId/permissions
 * Create a new user with permissions for a specific project
 */
router.post('/:projectId/permissions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const userData: CreateUserPermissionRequest = req.body;

    if (!projectId) {
      const validationError = ServiceValidationError.forField('projectId', 'Project ID is required', {
        operation: 'get_project_permissions',
        service: 'permissions_route',
        path: req.path,
      });

      return next(validationError);
    }

    // Validate required fields
    if (!userData.first_name || !userData.last_name || !userData.email || !userData.permission_scope || !userData.permission_level) {
      return res.status(400).json({
        error: 'Missing required fields: first_name, last_name, email, permission_scope, permission_level',
        code: 'MISSING_REQUIRED_FIELDS',
      });
    }

    // Validate committee_ids for committee scope
    if (userData.permission_scope === 'committee' && (!userData.committee_ids || userData.committee_ids.length === 0)) {
      return res.status(400).json({
        error: 'committee_ids is required when permission_scope is committee',
        code: 'MISSING_COMMITTEE_IDS',
      });
    }

    userData.project_uid = projectId;

    req.log.info({ projectId, userData }, 'Creating user with permissions');

    const result = await supabaseService.createUserWithPermissions(userData);

    return res.status(201).json(result);
  } catch (error) {
    req.log.error({ error, projectId: req.params['projectId'] }, 'Error creating user with permissions');
    return next(error);
  }
});

/**
 * PUT /api/projects/:projectId/permissions/:userId
 * Update user permissions for a specific project
 */
router.put('/:projectId/permissions/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId, userId } = req.params;
    const updateData: Omit<UpdateUserPermissionRequest, 'user_id' | 'project_uid'> = req.body;

    if (!projectId || !userId) {
      return res.status(400).json({
        error: 'Project ID and User ID are required',
        code: 'MISSING_PARAMETERS',
      });
    }

    // Validate required fields
    if (!updateData.permission_scope || !updateData.permission_level) {
      return res.status(400).json({
        error: 'Missing required fields: permission_scope, permission_level',
        code: 'MISSING_REQUIRED_FIELDS',
      });
    }

    // Validate committee_ids for committee scope
    if (updateData.permission_scope === 'committee' && (!updateData.committee_ids || updateData.committee_ids.length === 0)) {
      return res.status(400).json({
        error: 'committee_ids is required when permission_scope is committee',
        code: 'MISSING_COMMITTEE_IDS',
      });
    }

    const fullUpdateData: UpdateUserPermissionRequest = {
      ...updateData,
      user_id: userId,
      project_uid: projectId,
    };

    req.log.info({ projectId, userId, updateData }, 'Updating user permissions');

    await supabaseService.updateUserPermissions(fullUpdateData);

    return res.status(204).send();
  } catch (error) {
    req.log.error({ error, projectId: req.params['projectId'], userId: req.params['userId'] }, 'Error updating user permissions');
    return next(error);
  }
});

/**
 * DELETE /api/projects/:projectId/permissions/:userId
 * Remove user permissions from a specific project
 */
router.delete('/:projectId/permissions/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId, userId } = req.params;

    if (!projectId || !userId) {
      return res.status(400).json({
        error: 'Project ID and User ID are required',
        code: 'MISSING_PARAMETERS',
      });
    }

    req.log.info({ projectId, userId }, 'Removing user permissions from project');

    await supabaseService.removeUserFromProject(userId, projectId);

    return res.status(204).send();
  } catch (error) {
    req.log.error({ error, projectId: req.params['projectId'], userId: req.params['userId'] }, 'Error removing user permissions');
    return next(error);
  }
});

export default router;
