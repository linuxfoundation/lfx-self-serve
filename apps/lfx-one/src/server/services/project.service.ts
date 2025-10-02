// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import { Project, ProjectSettings, ProjectSlugToIdResponse, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { serverLogger } from '../server';
import { AccessCheckService } from './access-check.service';
import { ETagService } from './etag.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { NatsService } from './nats.service';

/**
 * Service for handling project business logic
 */
export class ProjectService {
  private accessCheckService: AccessCheckService;
  private microserviceProxy: MicroserviceProxyService;
  private natsService: NatsService;
  private etagService: ETagService;

  public constructor() {
    this.accessCheckService = new AccessCheckService();
    this.microserviceProxy = new MicroserviceProxyService();
    this.natsService = new NatsService();
    this.etagService = new ETagService();
  }

  /**
   * Fetches all projects based on query parameters
   */
  public async getProjects(req: Request, query: Record<string, any> = {}): Promise<Project[]> {
    const params = {
      ...query,
      type: 'project',
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Project>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    const projects = resources.map((resource) => resource.data);

    // Add writer access field to all projects
    return await this.accessCheckService.addAccessToResources(req, projects, 'project');
  }

  /**
   * Fetches a single project by ID
   */
  public async getProjectById(req: Request, projectId: string, access: boolean = true): Promise<Project> {
    const params = {
      type: 'project',
      tags: projectId,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Project>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    if (!resources || resources.length === 0) {
      throw new ResourceNotFoundError('Project', projectId, {
        operation: 'get_project_by_id',
        service: 'project_service',
        path: '/query/resources',
      });
    }

    if (resources.length > 1) {
      req.log.warn(
        {
          project_id: projectId,
          result_count: resources.length,
        },
        'Multiple projects found for single ID lookup'
      );
    }

    const project = resources[0].data;

    // Add writer access field to the project
    if (access) {
      return await this.accessCheckService.addAccessToResource(req, project, 'project');
    }

    return project;
  }

  /**
   * Search projects by name
   */
  public async searchProjects(req: Request, searchQuery: string): Promise<Project[]> {
    const params = {
      type: 'project',
      name: searchQuery,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Project>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    return resources.map((resource) => resource.data);
  }

  /**
   * Fetches a single project by slug using NATS for slug resolution
   * First resolves slug to ID via NATS, then fetches project data
   */
  public async getProjectBySlug(req: Request, projectSlug: string): Promise<Project> {
    req.log.info(
      {
        slug: projectSlug,
        operation: 'get_project_by_slug_via_nats',
        step: 'nats_lookup',
      },
      'Resolving project slug to ID via NATS'
    );

    const natsResult = await this.getProjectIdBySlug(projectSlug);

    if (!natsResult.exists || !natsResult.projectId) {
      throw new ResourceNotFoundError('Project', projectSlug, {
        operation: 'get_project_by_slug_via_nats',
        service: 'project_service',
        path: '/nats/project-slug-lookup',
      });
    }

    req.log.info(
      {
        slug: projectSlug,
        project_id: natsResult.projectId,
        operation: 'get_project_by_slug_via_nats',
        step: 'nats_success',
      },
      'Successfully resolved slug to ID via NATS'
    );

    // Now fetch the project using the resolved ID
    return this.getProjectById(req, natsResult.projectId);
  }

  public async getProjectSettings(req: Request, projectId: string): Promise<ProjectSettings> {
    return await this.microserviceProxy.proxyRequest<ProjectSettings>(req, 'LFX_V2_SERVICE', `/projects/${projectId}/settings`, 'GET');
  }

  /**
   * Unified method to update project permissions using ETag for safe updates
   */
  public async updateProjectPermissions(
    req: Request,
    projectId: string,
    operation: 'add' | 'update' | 'remove',
    username: string,
    role?: 'view' | 'manage'
  ): Promise<ProjectSettings> {
    // Step 1: Fetch current settings with ETag
    const { data: settings, etag } = await this.etagService.fetchWithETag<ProjectSettings>(
      req,
      'LFX_V2_SERVICE',
      `/projects/${projectId}/settings`,
      `${operation}_user_project_permissions`
    );

    // Step 2: Update the settings based on operation
    const updatedSettings = { ...settings };

    // Initialize arrays if they don't exist
    if (!updatedSettings.writers) updatedSettings.writers = [];
    if (!updatedSettings.auditors) updatedSettings.auditors = [];

    // Remove user from both arrays first (for all operations)
    updatedSettings.writers = updatedSettings.writers.filter((u) => u !== username);
    updatedSettings.auditors = updatedSettings.auditors.filter((u) => u !== username);

    // Add user to appropriate array based on operation and role
    if (operation === 'add' || operation === 'update') {
      if (!role) {
        throw new Error('Role is required for add/update operations');
      }

      if (role === 'manage') {
        updatedSettings.writers = [...new Set([...updatedSettings.writers, username])];
      } else {
        updatedSettings.auditors = [...new Set([...updatedSettings.auditors, username])];
      }
    }
    // For 'remove' operation, user is already removed from both arrays above

    // Step 3: Update settings with ETag
    const result = await this.etagService.updateWithETag<ProjectSettings>(
      req,
      'LFX_V2_SERVICE',
      `/projects/${projectId}/settings`,
      etag,
      updatedSettings,
      `${operation}_user_project_permissions`
    );

    req.log.info(
      {
        operation: `${operation}_user_project_permissions`,
        project_id: projectId,
        username,
        role: role || 'N/A',
      },
      `User ${operation} operation completed successfully`
    );

    return result;
  }

  /**
   * Get project ID by slug using NATS request-reply pattern
   * @private
   */
  private async getProjectIdBySlug(slug: string): Promise<ProjectSlugToIdResponse> {
    const codec = this.natsService.getCodec();

    try {
      const response = await this.natsService.request(NatsSubjects.PROJECT_SLUG_TO_UID, codec.encode(slug), { timeout: NATS_CONFIG.REQUEST_TIMEOUT });

      const projectId = codec.decode(response.data);

      // Check if we got a valid project ID
      if (!projectId || projectId.trim() === '') {
        serverLogger.info({ slug }, 'Project slug not found via NATS');
        return {
          projectId: '',
          slug,
          exists: false,
        };
      }

      serverLogger.info({ slug, project_id: projectId }, 'Successfully resolved project slug to ID');

      return {
        projectId: projectId.trim(),
        slug,
        exists: true,
      };
    } catch (error) {
      serverLogger.error({ error: error instanceof Error ? error.message : error, slug }, 'Failed to resolve project slug via NATS');

      // If it's a timeout or no responder error, treat as not found
      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('503'))) {
        return {
          projectId: '',
          slug,
          exists: false,
        };
      }

      throw error;
    }
  }
}
