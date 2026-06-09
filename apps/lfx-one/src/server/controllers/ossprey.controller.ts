// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OsspreyListParams, OsspreyPackagesResponse } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { OsspreyServerService } from '../services/ossprey.service';
import { logger } from '../services/logger.service';

export class OsspreyController {
  private readonly osspreyService = new OsspreyServerService();

  public async getPackages(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_ossprey_packages');

    try {
      const params: OsspreyListParams = {
        sort: req.query['sort'] as string | undefined,
        status: req.query['status'] as string | undefined,
        ecosystem: req.query['ecosystem'] as string | undefined,
        lifecycle: req.query['lifecycle'] as string | undefined,
        healthBand: req.query['healthBand'] as string | undefined,
        vulnFilter: req.query['vulnFilter'] as string | undefined,
        search: req.query['search'] as string | undefined,
        cursor: req.query['cursor'] as string | undefined,
        limit: req.query['limit'] ? Number(req.query['limit']) : undefined,
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
