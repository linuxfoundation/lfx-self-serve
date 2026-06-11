// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OsspreyHealthBand, OsspreyListParams, OsspreyMetrics, OsspreyPackagesResponse, OsspreyStatus, OspreySortKey } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { getStringQueryParam } from '../helpers/validation.helper';
import { OsspreyServerService } from '../services/ossprey.service';
import { logger } from '../services/logger.service';

export class OsspreyController {
  private readonly osspreyService = new OsspreyServerService();

  public async getMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_ossprey_metrics');

    try {
      const data: OsspreyMetrics = await this.osspreyService.getMetrics(req);

      logger.success(req, 'get_ossprey_metrics', startTime);

      res.json(data);
    } catch (error) {
      return next(error);
    }
  }

  public async getPackages(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_ossprey_packages');

    try {
      const pageRaw = getStringQueryParam(req, 'page');
      const pageSizeRaw = getStringQueryParam(req, 'pageSize');
      const params: OsspreyListParams = {
        page: pageRaw ? Number(pageRaw) : undefined,
        pageSize: pageSizeRaw ? Number(pageSizeRaw) : undefined,
        search: getStringQueryParam(req, 'search'),
        ecosystem: getStringQueryParam(req, 'ecosystem'),
        lifecycle: getStringQueryParam(req, 'lifecycle'),
        status: getStringQueryParam(req, 'status') as OsspreyStatus | undefined,
        healthBand: getStringQueryParam(req, 'healthBand') as OsspreyHealthBand | undefined,
        vulnFilter: getStringQueryParam(req, 'vulnFilter') as OsspreyListParams['vulnFilter'],
        busFactor1Only: getStringQueryParam(req, 'busFactor1Only') === 'true',
        staleOnly: getStringQueryParam(req, 'staleOnly') === 'true',
        unstewardedOnly: getStringQueryParam(req, 'unstewardedOnly') === 'true',
        sortBy: getStringQueryParam(req, 'sortBy') as OspreySortKey | undefined,
      };

      const data: OsspreyPackagesResponse = await this.osspreyService.getPackages(req, params);

      logger.success(req, 'get_ossprey_packages', startTime, {
        package_count: data.packages?.length ?? 0,
      });

      res.json(data);
    } catch (error) {
      return next(error);
    }
  }

  public async getPackage(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_ossprey_package');
    // Express already URL-decodes route params — decoding again would corrupt
    // purls with literal %-escapes (e.g. scoped npm: pkg:npm/%40scope/name).
    const purl = req.params['purl'] as string;

    try {
      const pkg = await this.osspreyService.getPackage(req, purl);

      if (!pkg) {
        logger.debug(req, 'get_ossprey_package', 'Package not found', { purl });
        // Intentional: 404 is a valid non-error outcome here, not an exception path.
        res.status(404).json({ error: 'NOT_FOUND', message: 'Package not found.' });
        return;
      }

      logger.success(req, 'get_ossprey_package', startTime, { purl });

      res.json(pkg);
    } catch (error) {
      return next(error);
    }
  }
}
