// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Project, QueryServiceResponse } from '@lfx-pcc/shared/interfaces';
import { Request } from 'express';

import { createApiError } from '../utils/api-error';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { NatsService } from './nats.service';

/**
 * Service for handling project business logic
 */
export class ProjectService {
  private microserviceProxy: MicroserviceProxyService;
  private natsService: NatsService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.natsService = new NatsService();
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

    return resources.map((resource) => resource.data);
  }

  /**
   * Fetches a single project by ID
   */
  public async getProjectById(req: Request, projectId: string): Promise<Project> {
    const params = {
      type: 'project',
      tags: projectId,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Project>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    if (!resources || resources.length === 0) {
      throw createApiError({
        message: 'Project not found',
        status: 404,
        code: 'PROJECT_NOT_FOUND',
        service: 'lfx-v2',
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

    return resources[0].data;
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

    const natsResult = await this.natsService.getProjectIdBySlug(projectSlug);

    if (!natsResult.exists || !natsResult.projectId) {
      throw createApiError({
        message: 'Project not found',
        status: 404,
        code: 'PROJECT_NOT_FOUND',
        service: 'nats',
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
}
