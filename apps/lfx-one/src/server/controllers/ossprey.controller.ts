// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OsspreyListParams, OsspreyMetrics, OsspreyPackagesResponse } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import {
  getStringQueryParam,
  parseAssignStewardBody,
  parseEscalateBody,
  parseOpenStewardshipBody,
  parseOsspreyHealthBand,
  parseOsspreyStatus,
  parseOsspreyVulnFilter,
  parseOspreySortKey,
  parseStewardshipId,
  parseUpdateStatusBody,
} from '../helpers/validation.helper';
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
        status: parseOsspreyStatus(req),
        healthBand: parseOsspreyHealthBand(req),
        vulnFilter: parseOsspreyVulnFilter(req),
        busFactor1Only: getStringQueryParam(req, 'busFactor1Only') === 'true',
        staleOnly: getStringQueryParam(req, 'staleOnly') === 'true',
        unstewardedOnly: getStringQueryParam(req, 'unstewardedOnly') === 'true',
        sortBy: parseOspreySortKey(req),
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

  public async openStewardship(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'open_ossprey_stewardship');

    try {
      const purl = parseOpenStewardshipBody(req, 'open_ossprey_stewardship');

      const data = await this.osspreyService.openStewardship(req, purl);

      logger.success(req, 'open_ossprey_stewardship', startTime, { purl });

      res.json(data);
    } catch (error) {
      return next(error);
    }
  }

  public async assignSteward(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'assign_ossprey_steward');

    try {
      const id = parseStewardshipId(req, 'assign_ossprey_steward');
      const body = parseAssignStewardBody(req, 'assign_ossprey_steward');

      const data = await this.osspreyService.assignSteward(req, id, body);

      logger.success(req, 'assign_ossprey_steward', startTime, { stewardship_id: id, role: body.role });

      res.json(data);
    } catch (error) {
      return next(error);
    }
  }

  public async escalateStewardship(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'escalate_ossprey_stewardship');

    try {
      const id = parseStewardshipId(req, 'escalate_ossprey_stewardship');
      const body = parseEscalateBody(req, 'escalate_ossprey_stewardship');

      const data = await this.osspreyService.escalateStewardship(req, id, body);

      logger.success(req, 'escalate_ossprey_stewardship', startTime, { stewardship_id: id, resolution_path: body.resolutionPath });

      res.json(data);
    } catch (error) {
      return next(error);
    }
  }

  public async updateStewardshipStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'update_ossprey_stewardship_status');

    try {
      const id = parseStewardshipId(req, 'update_ossprey_stewardship_status');
      const body = parseUpdateStatusBody(req, 'update_ossprey_stewardship_status');

      const data = await this.osspreyService.updateStewardshipStatus(req, id, body);

      logger.success(req, 'update_ossprey_stewardship_status', startTime, { stewardship_id: id, status: body.status });

      res.json(data);
    } catch (error) {
      return next(error);
    }
  }
}
