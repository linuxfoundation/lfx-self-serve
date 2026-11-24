// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CDP_COMPANY_ERROR_CODES,
  CDP_COMPANY_ID_PATTERN,
  CDP_COMPANY_SEARCH_MAX_CHARS,
  CDP_COMPANY_SECTION_KEYS,
  CDP_VIEW_OUTCOME_LOCALS_KEY,
  ORG_CATALOGUE_SEARCH_MIN_CHARS,
} from '@lfx-one/shared/constants';
import type { CdpCompanyAvailability, CdpCompanyErrorBody, CdpCompanyServiceResult, CdpSectionKey } from '@lfx-one/shared/interfaces';
import type { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { resolveCdpAudience } from '../helpers/cdp-audience.helper';
import { logCdpCompanyViewOnFinish } from '../helpers/cdp-company-view-log.helper';
import { getStrictStringQueryParam } from '../helpers/strict-query-param.helper';
import { cdpAudienceOf } from '../middleware/require-cdp-audience.middleware';
import { CdpCompanySearchService } from '../services/cdp-company-search.service';
import { CdpCompanyService } from '../services/cdp-company.service';
import { logger } from '../services/logger.service';

/**
 * CDP company BFF. Every route but
 * `/availability` runs behind `requireCdpAudience`, so an outsider never reaches a handler here and never causes an id
 * lookup, a cache read or a warehouse read. Every answer is per caller: `Cache-Control: private, no-store`.
 */
export class CdpCompanyController {
  private readonly service = new CdpCompanyService();
  private readonly searchService = new CdpCompanySearchService();

  // GET /api/companies/availability -> { available }; 503 when the audience check fails. Never logged as a view.
  public async getAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_cdp_company_availability';
    const startTime = logger.startOperation(req, operation);

    try {
      const answer = await resolveCdpAudience(req);
      res.setHeader('Cache-Control', 'private, no-store');
      if (answer.status === 'unverifiable') {
        res.status(503).json({ code: CDP_COMPANY_ERROR_CODES.ROLE_GRANTS_UNAVAILABLE } satisfies CdpCompanyErrorBody);
        return;
      }
      logger.success(req, operation, startTime, { available: answer.status === 'in' });
      res.json({ available: answer.status === 'in' } satisfies CdpCompanyAvailability);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/companies/search?name= -> { items, unavailable? }. Not logged as a view.
  public async search(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'search_cdp_companies';
    const startTime = logger.startOperation(req, operation);

    try {
      const term = getStrictStringQueryParam(req, 'name', operation)?.trim() ?? '';
      if (term.length < ORG_CATALOGUE_SEARCH_MIN_CHARS || term.length > CDP_COMPANY_SEARCH_MAX_CHARS) {
        throw ServiceValidationError.forField('name', `name must be between ${ORG_CATALOGUE_SEARCH_MIN_CHARS} and ${CDP_COMPANY_SEARCH_MAX_CHARS} characters`, {
          operation,
        });
      }

      const response = await this.searchService.search(req, term);

      logger.success(req, operation, startTime, { result_count: response.items.length, unavailable: response.unavailable === true });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/companies/:cdpId -> CdpCompanyPage | { redirect } | 404 NOT_FOUND
  public async getCompany(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_cdp_company';
    const startTime = logger.startOperation(req, operation);

    try {
      const cdpId = parseCdpId(req);
      if (!cdpId) {
        sendRefusal(res, 404, CDP_COMPANY_ERROR_CODES.NOT_FOUND);
        return;
      }
      logCdpCompanyViewOnFinish(req, res, cdpId, 'page');

      const result = await this.service.getPage(req, cdpId);

      logger.success(req, operation, startTime, { outcome: result.outcome });
      sendResult(res, result);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/companies/:cdpId/sections/:section -> the section payload, or 403/404/503 { code }
  public async getSection(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_cdp_company_section';
    const startTime = logger.startOperation(req, operation);

    try {
      const cdpId = parseCdpId(req);
      const section = req.params['section'];
      if (!cdpId || !isSectionKey(section)) {
        sendRefusal(res, 404, CDP_COMPANY_ERROR_CODES.NOT_FOUND);
        return;
      }
      logCdpCompanyViewOnFinish(req, res, cdpId, section);

      const result = await this.service.getSection(req, cdpAudienceOf(res), cdpId, section);

      logger.success(req, operation, startTime, { section, outcome: result.outcome });
      sendResult(res, result);
    } catch (error) {
      next(error);
    }
  }
}

/** The CDP id of the address, or null when it is not in the CDP id format (answered exactly as an unknown id). */
function parseCdpId(req: Request): string | null {
  const raw = req.params['cdpId'];
  return typeof raw === 'string' && CDP_COMPANY_ID_PATTERN.test(raw) ? raw : null;
}

function isSectionKey(value: unknown): value is CdpSectionKey {
  return typeof value === 'string' && (CDP_COMPANY_SECTION_KEYS as readonly string[]).includes(value);
}

function sendResult<T>(res: Response, result: CdpCompanyServiceResult<T>): void {
  res.locals[CDP_VIEW_OUTCOME_LOCALS_KEY] = result.outcome;
  if (result.ok) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(result.value);
    return;
  }
  sendRefusal(res, result.status, result.code);
}

function sendRefusal(res: Response, status: number, code: CdpCompanyErrorBody['code']): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(status).json({ code } satisfies CdpCompanyErrorBody);
}
