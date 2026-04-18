// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NAV_LENSES } from '@lfx-one/shared/constants';
import { NavLens } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { getStringQueryParam } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { NavigationService } from '../services/navigation.service';

function isNavLens(value: string | undefined): value is NavLens {
  return !!value && NAV_LENSES.includes(value as NavLens);
}

export class NavigationController {
  private readonly navigationService: NavigationService;

  public constructor() {
    this.navigationService = new NavigationService();
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

      const result = await this.navigationService.getLensItems(req, { lens, pageToken, name });

      logger.success(req, 'get_lens_items', startTime, {
        lens: result.lens,
        item_count: result.items.length,
        bypass_active: result.bypass_active,
        persona_fetch_failed: result.persona_fetch_failed,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}
