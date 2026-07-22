// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { FOUNDATION_ID_PATTERN, PD_DEFAULT_TIME_RANGE, PD_VALID_TIME_RANGES } from '@lfx-one/shared/constants';
import type { OrgLensLeaderboardTimeRange } from '@lfx-one/shared/interfaces';

import { ServiceValidationError } from '../errors';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { logger } from '../services/logger.service';
import { OrgLensProjectDetailService } from '../services/org-lens-project-detail.service';

/** HTTP boundary for the Org Lens · Project Detail endpoint — validation, lifecycle logging, error propagation. */
export class OrgLensProjectDetailController {
  private readonly service: OrgLensProjectDetailService;

  public constructor() {
    this.service = new OrgLensProjectDetailService();
  }

  public async getHeroBlock(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { orgUid, projectSlug } = this.context(req);
    const startTime = logger.startOperation(req, 'get_org_lens_project_detail_hero', { org_uid: orgUid, project_slug: projectSlug });
    try {
      assertOrgUid(orgUid, 'get_org_lens_project_detail_hero');
      this.assertProjectSlug(projectSlug, 'get_org_lens_project_detail_hero');
      const block = await this.service.getHeroBlock(orgUid, projectSlug);
      this.sendBlock(req, res, 'get_org_lens_project_detail_hero', startTime, orgUid, projectSlug, block);
    } catch (error) {
      next(error);
    }
  }

  public async getInfluenceBlock(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { orgUid, projectSlug, range } = this.context(req);
    const startTime = logger.startOperation(req, 'get_org_lens_project_detail_influence', { org_uid: orgUid, project_slug: projectSlug, range });
    try {
      assertOrgUid(orgUid, 'get_org_lens_project_detail_influence');
      this.assertProjectSlug(projectSlug, 'get_org_lens_project_detail_influence');
      const block = await this.service.getInfluenceBlock(orgUid, projectSlug, range);
      this.sendBlock(req, res, 'get_org_lens_project_detail_influence', startTime, orgUid, projectSlug, block);
    } catch (error) {
      next(error);
    }
  }

  public async getTrendBlock(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { orgUid, projectSlug } = this.context(req);
    const startTime = logger.startOperation(req, 'get_org_lens_project_detail_trend', { org_uid: orgUid, project_slug: projectSlug });
    try {
      assertOrgUid(orgUid, 'get_org_lens_project_detail_trend');
      this.assertProjectSlug(projectSlug, 'get_org_lens_project_detail_trend');
      const block = await this.service.getTrendBlock(orgUid, projectSlug);
      this.sendBlock(req, res, 'get_org_lens_project_detail_trend', startTime, orgUid, projectSlug, block);
    } catch (error) {
      next(error);
    }
  }

  public async getTechnicalBoard(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { orgUid, projectSlug, range } = this.context(req);
    const startTime = logger.startOperation(req, 'get_org_lens_project_detail_board_technical', { org_uid: orgUid, project_slug: projectSlug, range });
    try {
      assertOrgUid(orgUid, 'get_org_lens_project_detail_board_technical');
      this.assertProjectSlug(projectSlug, 'get_org_lens_project_detail_board_technical');
      const block = await this.service.getTechnicalBoard(orgUid, projectSlug, range);
      this.sendBlock(req, res, 'get_org_lens_project_detail_board_technical', startTime, orgUid, projectSlug, block);
    } catch (error) {
      next(error);
    }
  }

  public async getEcosystemBoard(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { orgUid, projectSlug, range } = this.context(req);
    const startTime = logger.startOperation(req, 'get_org_lens_project_detail_board_ecosystem', { org_uid: orgUid, project_slug: projectSlug, range });
    try {
      assertOrgUid(orgUid, 'get_org_lens_project_detail_board_ecosystem');
      this.assertProjectSlug(projectSlug, 'get_org_lens_project_detail_board_ecosystem');
      const block = await this.service.getEcosystemBoard(orgUid, projectSlug, range);
      this.sendBlock(req, res, 'get_org_lens_project_detail_board_ecosystem', startTime, orgUid, projectSlug, block);
    } catch (error) {
      next(error);
    }
  }

  public async getCardDrawer(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { orgUid, projectSlug, range } = this.context(req);
    const cardKey = req.params['cardKey'];
    const startTime = logger.startOperation(req, 'get_org_lens_card_drawer', { org_uid: orgUid, project_slug: projectSlug, card_key: cardKey, range });
    try {
      assertOrgUid(orgUid, 'get_org_lens_card_drawer');
      this.assertProjectSlug(projectSlug, 'get_org_lens_card_drawer');
      this.assertCardKey(cardKey, 'get_org_lens_card_drawer');
      const section = await this.service.getCardDrawer(orgUid, projectSlug, cardKey, range);
      this.sendBlock(req, res, 'get_org_lens_card_drawer', startTime, orgUid, projectSlug, section);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:orgUid/lens/projects/:projectSlug/cards/:cardKey/roster?range=&page=&pageSize= */
  public async getCardRoster(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const projectSlug = req.params['projectSlug'];
    const cardKey = req.params['cardKey'];
    const rawOrgName = typeof req.query['orgName'] === 'string' ? req.query['orgName'].trim() : '';
    const orgName = rawOrgName || 'Your Organization';
    const rawRange = typeof req.query['range'] === 'string' ? req.query['range'] : '';
    const range: OrgLensLeaderboardTimeRange = PD_VALID_TIME_RANGES.has(rawRange) ? (rawRange as OrgLensLeaderboardTimeRange) : PD_DEFAULT_TIME_RANGE;
    const page = this.parseNonNegativeInt(req.query['page'], 0);
    const pageSize = this.parseNonNegativeInt(req.query['pageSize'], 10);

    const startTime = logger.startOperation(req, 'get_org_lens_card_roster', {
      org_uid: orgUid,
      project_slug: projectSlug,
      card_key: cardKey,
      range,
      page,
      page_size: pageSize,
    });

    try {
      assertOrgUid(orgUid, 'get_org_lens_card_roster');
      this.assertProjectSlug(projectSlug, 'get_org_lens_card_roster');
      this.assertCardKey(cardKey, 'get_org_lens_card_roster');

      const roster = await this.service.getCardRoster(orgUid, orgName, projectSlug, cardKey, range, page, pageSize);

      logger.success(req, 'get_org_lens_card_roster', startTime, { org_uid: orgUid, project_slug: projectSlug, card_key: cardKey, total: roster.total });
      res.setHeader('Cache-Control', 'no-store');
      res.json(roster);
    } catch (error) {
      next(error);
    }
  }

  // FOUNDATION_ID_PATTERN is the general SSR path-param validator (`[A-Za-z0-9-]{1,64}`); it also
  // covers the project slug shape, so it is reused here for the slug-keyed detail route.
  private assertProjectSlug(projectSlug: string | undefined, operation: string): asserts projectSlug is string {
    if (!projectSlug || typeof projectSlug !== 'string') {
      throw ServiceValidationError.forField('projectSlug', 'projectSlug path parameter is required', { operation });
    }
    if (!FOUNDATION_ID_PATTERN.test(projectSlug)) {
      throw ServiceValidationError.forField('projectSlug', 'Invalid projectSlug format', { operation });
    }
  }

  // Card keys are lowercase hyphenated slugs (e.g. 'board-members'); the same path-param shape applies.
  private assertCardKey(cardKey: string | undefined, operation: string): asserts cardKey is string {
    if (!cardKey || typeof cardKey !== 'string') {
      throw ServiceValidationError.forField('cardKey', 'cardKey path parameter is required', { operation });
    }
    if (!FOUNDATION_ID_PATTERN.test(cardKey)) {
      throw ServiceValidationError.forField('cardKey', 'Invalid cardKey format', { operation });
    }
  }

  private parseNonNegativeInt(value: unknown, fallback: number): number {
    const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private context(req: Request): { orgUid: string | undefined; projectSlug: string | undefined; range: OrgLensLeaderboardTimeRange } {
    const rawRange = typeof req.query['range'] === 'string' ? req.query['range'] : '';
    return {
      orgUid: req.params['orgUid'],
      projectSlug: req.params['projectSlug'],
      range: PD_VALID_TIME_RANGES.has(rawRange) ? (rawRange as OrgLensLeaderboardTimeRange) : PD_DEFAULT_TIME_RANGE,
    };
  }

  private sendBlock(req: Request, res: Response, operation: string, startTime: number, orgUid: string, projectSlug: string, block: unknown): void {
    res.setHeader('Cache-Control', 'no-store');
    if (block === null) {
      logger.success(req, operation, startTime, { org_uid: orgUid, project_slug: projectSlug, found: false });
      res.status(404).json({ message: 'Not found' });
      return;
    }
    logger.success(req, operation, startTime, { org_uid: orgUid, project_slug: projectSlug, found: true });
    res.json(block);
  }
}
