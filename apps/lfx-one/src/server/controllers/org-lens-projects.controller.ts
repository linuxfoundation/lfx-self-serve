// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { getStringQueryParam } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { OrgLensProjectsService } from '../services/org-lens-projects.service';

export class OrgLensProjectsController {
  private readonly service = new OrgLensProjectsService();

  public async getProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_lens_projects', { org_uid: orgUid });

    try {
      assertOrgUid(orgUid, 'get_org_lens_projects');
      const response = await this.service.getProjects(orgUid, getStringQueryParam(req, 'orgName') ?? '', this.parseSlugList(getStringQueryParam(req, 'slugs')));

      logger.success(req, 'get_org_lens_projects', startTime, {
        org_uid: orgUid,
        project_count: response.projects.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error: unknown) {
      next(error);
    }
  }

  public async searchProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'search_org_lens_projects', { org_uid: orgUid });

    try {
      assertOrgUid(orgUid, 'search_org_lens_projects');
      const response = await this.service.searchProjects(
        orgUid,
        getStringQueryParam(req, 'q') ?? '',
        this.parseSlugList(getStringQueryParam(req, 'excludeSlugs')) ?? []
      );

      logger.success(req, 'search_org_lens_projects', startTime, {
        org_uid: orgUid,
        result_count: response.results.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error: unknown) {
      next(error);
    }
  }

  public async getWorkspaces(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_lens_project_workspaces', { org_uid: orgUid });

    try {
      assertOrgUid(orgUid, 'get_org_lens_project_workspaces');
      const response = await this.service.getWorkspaces(req, orgUid);

      logger.success(req, 'get_org_lens_project_workspaces', startTime, {
        org_uid: orgUid,
        workspace_count: response.workspaces.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error: unknown) {
      next(error);
    }
  }

  public async createWorkspace(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'create_org_lens_project_workspace', { org_uid: orgUid });

    try {
      assertOrgUid(orgUid, 'create_org_lens_project_workspace');
      const name = this.readRequiredStringBody(req, 'name', 'create_org_lens_project_workspace');
      const workspace = await this.service.createWorkspace(req, orgUid, name.trim());

      logger.success(req, 'create_org_lens_project_workspace', startTime, {
        org_uid: orgUid,
        workspace_id: workspace.id,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json({ workspace });
    } catch (error: unknown) {
      next(error);
    }
  }

  public async renameWorkspace(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const workspaceId = req.params['workspaceId'];
    const startTime = logger.startOperation(req, 'rename_org_lens_project_workspace', { org_uid: orgUid, workspace_id: workspaceId });

    try {
      assertOrgUid(orgUid, 'rename_org_lens_project_workspace');
      this.assertWorkspaceId(workspaceId, 'rename_org_lens_project_workspace');
      const name = this.readRequiredStringBody(req, 'name', 'rename_org_lens_project_workspace');
      const workspace = await this.service.renameWorkspace(req, orgUid, workspaceId, name.trim());

      logger.success(req, 'rename_org_lens_project_workspace', startTime, {
        org_uid: orgUid,
        workspace_id: workspace.id,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json({ workspace });
    } catch (error: unknown) {
      next(error);
    }
  }

  public async deleteWorkspace(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const workspaceId = req.params['workspaceId'];
    const startTime = logger.startOperation(req, 'delete_org_lens_project_workspace', { org_uid: orgUid, workspace_id: workspaceId });

    try {
      assertOrgUid(orgUid, 'delete_org_lens_project_workspace');
      this.assertWorkspaceId(workspaceId, 'delete_org_lens_project_workspace');
      await this.service.deleteWorkspace(req, orgUid, workspaceId);

      logger.success(req, 'delete_org_lens_project_workspace', startTime, { org_uid: orgUid, workspace_id: workspaceId });
      res.status(204).send();
    } catch (error: unknown) {
      next(error);
    }
  }

  public async addProjectsToWorkspace(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const workspaceId = req.params['workspaceId'];
    const startTime = logger.startOperation(req, 'add_org_lens_workspace_projects', { org_uid: orgUid, workspace_id: workspaceId });

    try {
      assertOrgUid(orgUid, 'add_org_lens_workspace_projects');
      this.assertWorkspaceId(workspaceId, 'add_org_lens_workspace_projects');
      const slugs = this.readStringArrayBody(req, 'slugs', 'add_org_lens_workspace_projects');
      const workspace = await this.service.addProjectsToWorkspace(req, orgUid, workspaceId, slugs);

      logger.success(req, 'add_org_lens_workspace_projects', startTime, {
        org_uid: orgUid,
        workspace_id: workspaceId,
        project_count: workspace.projectSlugs.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json({ workspace });
    } catch (error: unknown) {
      next(error);
    }
  }

  public async removeProjectFromWorkspace(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const workspaceId = req.params['workspaceId'];
    const slug = req.params['slug'];
    const startTime = logger.startOperation(req, 'remove_org_lens_workspace_project', { org_uid: orgUid, workspace_id: workspaceId, project_slug: slug });

    try {
      assertOrgUid(orgUid, 'remove_org_lens_workspace_project');
      this.assertWorkspaceId(workspaceId, 'remove_org_lens_workspace_project');
      if (!slug) {
        throw ServiceValidationError.forField('slug', 'Project slug path parameter is required', { operation: 'remove_org_lens_workspace_project' });
      }
      const workspace = await this.service.removeProjectFromWorkspace(req, orgUid, workspaceId, slug);

      logger.success(req, 'remove_org_lens_workspace_project', startTime, {
        org_uid: orgUid,
        workspace_id: workspaceId,
        project_count: workspace.projectSlugs.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json({ workspace });
    } catch (error: unknown) {
      next(error);
    }
  }

  private parseSlugList(value: string | undefined): string[] | null {
    if (!value) {
      return null;
    }
    const slugs = [
      ...new Set(
        value
          .split(',')
          .map((slug) => slug.trim().toLowerCase())
          .filter(Boolean)
      ),
    ];
    return slugs.length ? slugs : null;
  }

  private assertWorkspaceId(workspaceId: string | undefined, operation: string): asserts workspaceId is string {
    if (!workspaceId) {
      throw ServiceValidationError.forField('workspaceId', 'Workspace id path parameter is required', { operation });
    }
  }

  private readRequiredStringBody(req: Request, field: string, operation: string): string {
    const value = req.body?.[field];
    if (typeof value !== 'string' || !value.trim()) {
      throw ServiceValidationError.forField(field, `${field} must be a non-empty string`, { operation });
    }
    return value;
  }

  private readStringArrayBody(req: Request, field: string, operation: string): string[] {
    const value = req.body?.[field];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
      throw ServiceValidationError.forField(field, `${field} must be an array of non-empty strings`, { operation });
    }
    return value;
  }
}
