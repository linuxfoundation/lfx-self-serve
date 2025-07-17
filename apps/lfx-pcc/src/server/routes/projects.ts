// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response, Router } from 'express';

import { ApiClientService } from '../services/api-client.service';
import { MicroserviceProxyService } from '../services/microservice-proxy.service';

const router = Router();

const apiClient = new ApiClientService({
  timeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000,
});

const proxyService = new MicroserviceProxyService(apiClient);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projects = await proxyService.proxyRequest(req, 'QUERY_SERVICE', '', 'GET', undefined, req.query as Record<string, any>);

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

    // Pass slug as a query parameter along with any existing query params
    const params = {
      ...req.query,
      slug: projectSlug,
    };

    const project = await proxyService.proxyRequest(req, 'QUERY_SERVICE', '', 'GET', undefined, params);

    return res.json(project);
  } catch (error) {
    console.error(`Failed to fetch project ${req.params['slug']}:`, error);
    return next(error);
  }
});

export default router;
