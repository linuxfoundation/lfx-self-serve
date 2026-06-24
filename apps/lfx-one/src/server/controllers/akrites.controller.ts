// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AkritesActivityResponse, AkritesListParams, AkritesMetrics, AkritesPackagesResponse, AkritesScatterResponse } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import {
  getStringQueryParam,
  parseAssignStewardBody,
  parseEscalateBody,
  parseOpenStewardshipBody,
  parseAkritesHealthBand,
  parseAkritesStatus,
  parseAkritesVulnFilter,
  parseAkritesSortKey,
  parseStewardshipId,
  parseUpdateStatusBody,
} from '../helpers/validation.helper';
import { AkritesServerService } from '../services/akrites.service';
import { logger } from '../services/logger.service';

export class AkritesController {
  private readonly akritesService = new AkritesServerService();

  public async getMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_akrites_metrics');

    try {
      const data: AkritesMetrics = await this.akritesService.getMetrics(req);

      logger.success(req, 'get_akrites_metrics', startTime);

      res.json(data);
    } catch (error) {
      return next(error);
    }
  }

  public async getActivityFeed(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_akrites_activity');

    try {
      const pageRaw = getStringQueryParam(req, 'page');
      const pageSizeRaw = getStringQueryParam(req, 'pageSize');
      const parsedPage = pageRaw ? Number(pageRaw) : NaN;
      const parsedPageSize = pageSizeRaw ? Number(pageSizeRaw) : NaN;
      const page = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
      const pageSize = Number.isInteger(parsedPageSize) && parsedPageSize >= 1 ? Math.min(100, parsedPageSize) : 25;

      const data: AkritesActivityResponse = await this.akritesService.getActivityFeed(req, page, pageSize);

      logger.success(req, 'get_akrites_activity', startTime, { row_count: data.rows?.length ?? 0 });

      res.json(data);
    } catch (error) {
      return next(error);
    }
  }

  public async getPackages(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_akrites_packages');

    try {
      const pageRaw = getStringQueryParam(req, 'page');
      const pageSizeRaw = getStringQueryParam(req, 'pageSize');
      const pageNum = pageRaw ? Number(pageRaw) : undefined;
      const pageSizeNum = pageSizeRaw ? Number(pageSizeRaw) : undefined;
      if (pageNum !== undefined && (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > 10_000)) {
        return next(new Error('Invalid page parameter'));
      }
      if (pageSizeNum !== undefined && (!Number.isInteger(pageSizeNum) || pageSizeNum < 1 || pageSizeNum > 500)) {
        return next(new Error('Invalid pageSize parameter'));
      }
      const params: AkritesListParams = {
        page: pageNum,
        pageSize: pageSizeNum,
        search: getStringQueryParam(req, 'search'),
        ecosystem: getStringQueryParam(req, 'ecosystem'),
        lifecycle: getStringQueryParam(req, 'lifecycle'),
        status: parseAkritesStatus(req),
        healthBand: parseAkritesHealthBand(req),
        vulnFilter: parseAkritesVulnFilter(req),
        busFactor1Only: getStringQueryParam(req, 'busFactor1Only') === 'true',
        staleOnly: getStringQueryParam(req, 'staleOnly') === 'true',
        unstewardedOnly: getStringQueryParam(req, 'unstewardedOnly') === 'true',
        sortBy: parseAkritesSortKey(req),
      };

      const data: AkritesPackagesResponse = await this.akritesService.getPackages(req, params);

      logger.success(req, 'get_akrites_packages', startTime, {
        package_count: data.packages?.length ?? 0,
      });

      res.json(data);
    } catch (error) {
      return next(error);
    }
  }

  public async getPackage(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_akrites_package');
    // Express already URL-decodes route params — decoding again would corrupt
    // purls with literal %-escapes (e.g. scoped npm: pkg:npm/%40scope/name).
    const purl = req.params['purl'] as string;

    try {
      const pkg = await this.akritesService.getPackage(req, purl);

      if (!pkg) {
        logger.debug(req, 'get_akrites_package', 'Package not found', { purl });
        // Intentional: 404 is a valid non-error outcome here, not an exception path.
        res.status(404).json({ error: 'NOT_FOUND', message: 'Package not found.' });
        return;
      }

      logger.success(req, 'get_akrites_package', startTime, { purl });

      res.json(pkg);
    } catch (error) {
      return next(error);
    }
  }

  public async openStewardship(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'open_akrites_stewardship');

    try {
      const { purl, actor } = parseOpenStewardshipBody(req, 'open_akrites_stewardship');

      const data = await this.akritesService.openStewardship(req, purl, actor);

      logger.success(req, 'open_akrites_stewardship', startTime, { purl });

      res.json(data);
    } catch (error) {
      return next(error);
    }
  }

  public async assignSteward(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'assign_akrites_steward');

    try {
      const id = parseStewardshipId(req, 'assign_akrites_steward');
      const body = parseAssignStewardBody(req, 'assign_akrites_steward');

      const data = await this.akritesService.assignSteward(req, id, body);

      logger.success(req, 'assign_akrites_steward', startTime, { stewardship_id: id, role: body.steward.role });

      res.json(data);
    } catch (error) {
      return next(error);
    }
  }

  public async escalateStewardship(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'escalate_akrites_stewardship');

    try {
      const id = parseStewardshipId(req, 'escalate_akrites_stewardship');
      const body = parseEscalateBody(req, 'escalate_akrites_stewardship');

      const data = await this.akritesService.escalateStewardship(req, id, body);

      logger.success(req, 'escalate_akrites_stewardship', startTime, { stewardship_id: id, resolution_path: body.resolutionPath });

      res.json(data);
    } catch (error) {
      return next(error);
    }
  }

  public async getScatterData(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_akrites_scatter');

    try {
      const data: AkritesScatterResponse = await this.akritesService.getScatterData(req);

      logger.success(req, 'get_akrites_scatter', startTime, { point_count: data.points?.length ?? 0 });

      res.json(data);
    } catch (error) {
      return next(error);
    }
  }

  public async updateStewardshipStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'update_akrites_stewardship_status');

    try {
      const id = parseStewardshipId(req, 'update_akrites_stewardship_status');
      const body = parseUpdateStatusBody(req, 'update_akrites_stewardship_status');

      const data = await this.akritesService.updateStewardshipStatus(req, id, body);

      logger.success(req, 'update_akrites_stewardship_status', startTime, { stewardship_id: id, status: body.status });

      res.json(data);
    } catch (error) {
      return next(error);
    }
  }
}
