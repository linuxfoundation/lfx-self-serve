// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NAV_LENSES } from '@lfx-one/shared/constants';
import { NavLens } from '@lfx-one/shared/interfaces';
import { isFilterSafeIdentifier } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { getStringQueryParam } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { NavigationService } from '../services/navigation.service';
import { OrgNavigationService } from '../services/org-navigation.service';

function isNavLens(value: string | undefined): value is NavLens {
  return !!value && NAV_LENSES.includes(value as NavLens);
}

export class NavigationController {
  private readonly navigationService: NavigationService;
  private readonly orgNavigationService: OrgNavigationService;

  public constructor() {
    this.navigationService = new NavigationService();
    this.orgNavigationService = new OrgNavigationService();
  }

  public async getLensItems(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_lens_items');

    try {
      const lens = getStringQueryParam(req, 'lens');

      if (!isNavLens(lens)) {
        throw ServiceValidationError.forField('lens', `lens query parameter must be one of: ${NAV_LENSES.join(', ')}`, {
          operation: 'get_lens_items',
          service: 'navigation_controller',
          path: req.path,
        });
      }

      const pageToken = getStringQueryParam(req, 'page_token');
      const name = getStringQueryParam(req, 'name');
      const selectedUid = this.sanitizeSelectedUid(req, getStringQueryParam(req, 'selected_uid'), 'get_lens_items');

      const result = await this.navigationService.getLensItems(req, { lens, pageToken, name, selectedUid });

      logger.success(req, 'get_lens_items', startTime, {
        lens: result.lens,
        item_count: result.items.length,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /** `GET /api/nav/org-items` — paginated FGA-filtered org list for the org selector (contracts/bff-org-items.md). */
  public async getOrgItems(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_items');

    try {
      const pageToken = getStringQueryParam(req, 'page_token');
      const name = getStringQueryParam(req, 'name');
      const selectedUid = this.sanitizeSelectedUid(req, getStringQueryParam(req, 'selected_uid'), 'get_org_items');

      // page_token and selected_uid are mutually exclusive — `selected_uid` injection
      // only applies on the first natural page, never on continuation pages.
      if (pageToken && selectedUid) {
        throw ServiceValidationError.forField('selected_uid', 'page_token and selected_uid are mutually exclusive', {
          operation: 'get_org_items',
          service: 'navigation_controller',
          path: req.path,
        });
      }

      const result = await this.orgNavigationService.getOrgItems(req, { pageToken, name, selectedUid });

      logger.success(req, 'get_org_items', startTime, {
        has_search: !!name?.trim(),
        has_page_token: !!pageToken,
        has_selected_uid: !!selectedUid,
        item_count: result.items.length,
        has_next_page: !!result.next_page_token,
        upstream_failed: result.upstream_failed,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /** Fail closed on allowlist rejection — log warning and drop the pin hint rather than passing an unsafe uid downstream. */
  private sanitizeSelectedUid(req: Request, selectedUid: string | undefined, operation: string): string | undefined {
    if (!selectedUid) return undefined;
    if (isFilterSafeIdentifier(selectedUid)) return selectedUid;
    logger.warning(req, operation, 'Refusing selected_uid outside filter-safe allowlist', { uid_length: selectedUid.length });
    return undefined;
  }
}
