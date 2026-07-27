// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';

import { assertOrgLensRead } from '../helpers/org-lens-read-access.helper';
import { parseOrgMeetingsRange } from '../helpers/org-meetings-range.helper';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { logger } from '../services/logger.service';
import { OrgLensMeetingsService } from '../services/org-lens-meetings.service';

/**
 * HTTP boundary for the Org Lens Meetings insights endpoints.
 *
 * Every handler runs the same prelude: validate `:orgUid`, then verify the caller's grant on that
 * org *before* touching the cache or Snowflake. `:orgUid` is the analytics filter, not the
 * authorization — an authenticated caller with no grant on this org must never reach the data.
 */
export class OrgLensMeetingsController {
  private readonly service: OrgLensMeetingsService;

  public constructor() {
    this.service = new OrgLensMeetingsService();
  }

  public async getKpi(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_org_lens_meetings_kpi';
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, operation, { org_uid: orgUid });
    try {
      assertOrgUid(orgUid, operation);
      const range = parseOrgMeetingsRange(req.query['range'], operation);
      await assertOrgLensRead(req, orgUid, operation);

      const summary = await this.service.getKpiSummary(req, orgUid, range);
      logger.success(req, operation, startTime, { org_uid: orgUid, range });
      this.send(res, summary);
    } catch (error) {
      return next(error);
    }
  }

  public async getSpend(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_org_lens_meetings_spend';
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, operation, { org_uid: orgUid });
    try {
      assertOrgUid(orgUid, operation);
      const range = parseOrgMeetingsRange(req.query['range'], operation);
      await assertOrgLensRead(req, orgUid, operation);

      const breakdown = await this.service.getSpendBreakdown(req, orgUid, range);
      logger.success(req, operation, startTime, {
        org_uid: orgUid,
        range,
        foundation_segments: breakdown.byFoundation.length,
        project_segments: breakdown.byProject.length,
        // Zero here is the small-org safeguard, not an error — worth seeing in telemetry.
        meeting_type_segments: breakdown.byMeetingType.length,
        role_segments: breakdown.byRole.length,
      });
      this.send(res, breakdown);
    } catch (error) {
      return next(error);
    }
  }

  /** No `range` parameter — the influence surface is range-independent by contract. */
  public async getInfluence(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_org_lens_meetings_influence';
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, operation, { org_uid: orgUid });
    try {
      assertOrgUid(orgUid, operation);
      await assertOrgLensRead(req, orgUid, operation);

      const rows = await this.service.getInfluenceRows(req, orgUid);
      logger.success(req, operation, startTime, { org_uid: orgUid, rows: rows.length });
      this.send(res, rows);
    } catch (error) {
      return next(error);
    }
  }

  /** Sibling Org Lens convention: analytics are cached server-side in Valkey, never by the browser. */
  private send(res: Response, body: unknown): void {
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  }
}
