// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FAVORITE_PROJECTS_MAX_VALUES,
  FAVORITE_PROJECTS_PREFERENCE_APP_NAME,
  FAVORITE_PROJECTS_PREFERENCE_NAME,
  FAVORITE_PROJECTS_PREFERENCE_VALUE_MAX_LENGTH,
  NAV_LENSES,
} from '@lfx-one/shared/constants';
import { NavLens } from '@lfx-one/shared/interfaces';
import { isFilterSafeIdentifier } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { getStringQueryParam } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { NavigationService } from '../services/navigation.service';
import { OrgNavigationService } from '../services/org-navigation.service';
import { UserPreferenceService } from '../services/user-preference.service';
import { isImpersonating } from '../utils/auth-helper';

import type { PreferenceReadResponse, PreferenceUpsertRequest } from '@lfx-one/shared/interfaces';

function isNavLens(value: string | undefined): value is NavLens {
  return !!value && NAV_LENSES.includes(value as NavLens);
}

export class NavigationController {
  private readonly navigationService: NavigationService;
  private readonly orgNavigationService: OrgNavigationService;
  private readonly userPreferenceService: UserPreferenceService;

  public constructor() {
    this.navigationService = new NavigationService();
    this.orgNavigationService = new OrgNavigationService();
    this.userPreferenceService = new UserPreferenceService();
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

  /**
   * GET /api/nav/favorite-projects — the current user's favorited foundation/project uids (GH-2995).
   * A single global preference, unlike Social Listening's per-foundation family — no `:name` param.
   */
  public async getFavoriteProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_favorite_projects';
    const startTime = logger.startOperation(req, operation);

    try {
      // The API Gateway token always resolves the impersonator's profile — during impersonation
      // answer "no favorites" so the target-scoped selector never renders the impersonator's state.
      if (isImpersonating(req)) {
        logger.success(req, operation, startTime, { impersonating: true });
        const response: PreferenceReadResponse = { name: FAVORITE_PROJECTS_PREFERENCE_NAME, value: null };
        res.json(response);
        return;
      }

      const value = await this.userPreferenceService.getPreference(req, FAVORITE_PROJECTS_PREFERENCE_APP_NAME, FAVORITE_PROJECTS_PREFERENCE_NAME);

      logger.success(req, operation, startTime, { found: value !== null });

      const response: PreferenceReadResponse = { name: FAVORITE_PROJECTS_PREFERENCE_NAME, value };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** PUT /api/nav/favorite-projects — upsert the current user's favorited uids. Body: `{ value: string }` (stringified JSON array of uids). */
  public async upsertFavoriteProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'upsert_favorite_projects';
    const startTime = logger.startOperation(req, operation);

    try {
      const value = this.parseFavoriteProjectsValue(req, operation);
      await this.userPreferenceService.upsertPreference(req, FAVORITE_PROJECTS_PREFERENCE_APP_NAME, FAVORITE_PROJECTS_PREFERENCE_NAME, value);

      logger.success(req, operation, startTime);

      const response: PreferenceReadResponse = { name: FAVORITE_PROJECTS_PREFERENCE_NAME, value };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /api/nav/favorite-projects — clears the current user's favorites. Idempotent: deleting an absent preference succeeds with `value: null`. */
  public async deleteFavoriteProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'delete_favorite_projects';
    const startTime = logger.startOperation(req, operation);

    try {
      await this.userPreferenceService.deletePreference(req, FAVORITE_PROJECTS_PREFERENCE_APP_NAME, FAVORITE_PROJECTS_PREFERENCE_NAME);

      logger.success(req, operation, startTime);

      const response: PreferenceReadResponse = { name: FAVORITE_PROJECTS_PREFERENCE_NAME, value: null };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  private parseFavoriteProjectsValue(req: Request, operation: string): string {
    const body = req.body as PreferenceUpsertRequest | undefined;

    if (typeof body?.value !== 'string') {
      throw ServiceValidationError.forField('value', 'Request body must be { value: string }', { operation });
    }

    if (body.value.length > FAVORITE_PROJECTS_PREFERENCE_VALUE_MAX_LENGTH) {
      throw ServiceValidationError.forField('value', 'value exceeds the maximum allowed size', { operation });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.value);
    } catch {
      throw ServiceValidationError.forField('value', 'value must be valid JSON', { operation });
    }

    if (!Array.isArray(parsed) || parsed.length > FAVORITE_PROJECTS_MAX_VALUES || !parsed.every((uid) => typeof uid === 'string' && uid.length > 0)) {
      throw ServiceValidationError.forField('value', `value must be a JSON array of up to ${FAVORITE_PROJECTS_MAX_VALUES} non-empty uid strings`, {
        operation,
      });
    }

    return body.value;
  }

  /** Fail closed on allowlist rejection — log warning and drop the pin hint rather than passing an unsafe uid downstream. */
  private sanitizeSelectedUid(req: Request, selectedUid: string | undefined, operation: string): string | undefined {
    if (!selectedUid) return undefined;
    if (isFilterSafeIdentifier(selectedUid)) return selectedUid;
    logger.warning(req, operation, 'Refusing selected_uid outside filter-safe allowlist', { uid_length: selectedUid.length });
    return undefined;
  }
}
