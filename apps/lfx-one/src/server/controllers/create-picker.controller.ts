// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CREATABLE_ARTIFACTS } from '@lfx-one/shared/constants';
import { CreatableArtifactType, CreatePickerChildrenQuery } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { CreatePickerService } from '../services/create-picker.service';

const VALID_ARTIFACT_TYPES: CreatableArtifactType[] = CREATABLE_ARTIFACTS.map((artifact) => artifact.type);
const VALID_PARENT_TYPES = ['project', 'committee'];

function parseArtifactType(req: Request, operation: string): CreatableArtifactType {
  const { artifactType } = req.query;
  if (typeof artifactType !== 'string' || !VALID_ARTIFACT_TYPES.includes(artifactType as CreatableArtifactType)) {
    throw ServiceValidationError.forField('artifactType', 'artifactType is required and must be a valid creatable artifact type', {
      operation,
      service: 'create_picker_controller',
      path: req.path,
    });
  }
  return artifactType as CreatableArtifactType;
}

function parseChildrenQuery(req: Request, artifactType: CreatableArtifactType): CreatePickerChildrenQuery {
  const { parentType, parentUid } = req.query;

  if (typeof parentType !== 'string' || !VALID_PARENT_TYPES.includes(parentType)) {
    throw ServiceValidationError.forField('parentType', 'parentType is required and must be "project" or "committee"', {
      operation: 'get_create_picker_children',
      service: 'create_picker_controller',
      path: req.path,
    });
  }
  if (typeof parentUid !== 'string' || !parentUid) {
    throw ServiceValidationError.forField('parentUid', 'parentUid is required', {
      operation: 'get_create_picker_children',
      service: 'create_picker_controller',
      path: req.path,
    });
  }

  return { parentType: parentType as 'project' | 'committee', parentUid, artifactType };
}

/**
 * Controller for the create picker's tree/search endpoints (LFXV2-2838). Backs a lazy
 * direct-grant tree + type-ahead search — no handler here ever enumerates every project.
 */
export class CreatePickerController {
  private createPickerService: CreatePickerService = new CreatePickerService();

  /**
   * GET /create-picker/tree
   */
  public async getTree(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_create_picker_tree', {
      query_params: logger.sanitize(req.query as Record<string, any>),
    });

    try {
      const artifactType = parseArtifactType(req, 'get_create_picker_tree');
      const result = await this.createPickerService.getTree(req, artifactType);

      logger.success(req, 'get_create_picker_tree', startTime, {
        project_count: result.projects.length,
        committee_count: result.committees.length,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /create-picker/tree/children
   */
  public async getChildren(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_create_picker_children', {
      query_params: logger.sanitize(req.query as Record<string, any>),
    });

    try {
      const artifactType = parseArtifactType(req, 'get_create_picker_children');
      const query = parseChildrenQuery(req, artifactType);
      const result = await this.createPickerService.getChildren(req, query.parentType, query.parentUid, query.artifactType);

      logger.success(req, 'get_create_picker_children', startTime, {
        project_count: result.projects.length,
        committee_count: result.committees.length,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /create-picker/search
   */
  public async search(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'search_create_picker', {
      query_params: logger.sanitize(req.query as Record<string, any>),
    });

    try {
      const artifactType = parseArtifactType(req, 'search_create_picker');
      const { q } = req.query;

      if (typeof q !== 'string' || q.trim().length < 2) {
        throw ServiceValidationError.forField('q', 'q is required and must be at least 2 characters', {
          operation: 'search_create_picker',
          service: 'create_picker_controller',
          path: req.path,
        });
      }

      const result = await this.createPickerService.search(req, q.trim(), artifactType);

      logger.success(req, 'search_create_picker', startTime, {
        project_count: result.projects.length,
        committee_count: result.committees.length,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}
