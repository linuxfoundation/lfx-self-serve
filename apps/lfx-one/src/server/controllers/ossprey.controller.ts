// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OsspreyListParams, OsspreyPackagesResponse } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { getStringQueryParam } from '../helpers/validation.helper';
import { OsspreyServerService } from '../services/ossprey.service';
import { logger } from '../services/logger.service';

export class OsspreyController {
  private readonly osspreyService = new OsspreyServerService();

  public async getPackages(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_ossprey_packages');

    try {
      const pageRaw = getStringQueryParam(req, 'page');
      const pageSizeRaw = getStringQueryParam(req, 'pageSize');
      const params: OsspreyListParams = {
        page: pageRaw ? Number(pageRaw) : undefined,
        pageSize: pageSizeRaw ? Number(pageSizeRaw) : undefined,
        ecosystem: getStringQueryParam(req, 'ecosystem'),
        lifecycle: getStringQueryParam(req, 'lifecycle'),
        busFactor1Only: getStringQueryParam(req, 'busFactor1Only') === 'true',
        staleOnly: getStringQueryParam(req, 'staleOnly') === 'true',
        unstewardedOnly: getStringQueryParam(req, 'unstewardedOnly') === 'true',
        sortBy: getStringQueryParam(req, 'sortBy') as OsspreyListParams['sortBy'],
        sortDir: getStringQueryParam(req, 'sortDir') as OsspreyListParams['sortDir'],
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
    const purl = decodeURIComponent(req.params['purl'] as string);

    try {
      const pkg = await this.osspreyService.getPackage(req, purl);

      if (!pkg) {
        logger.debug(req, 'get_ossprey_package', 'Package not found', { purl });
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
