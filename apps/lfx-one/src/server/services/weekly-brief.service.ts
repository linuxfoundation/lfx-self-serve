// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { WEEKLY_BRIEF_DEFAULT_THROTTLE } from '@lfx-one/shared/constants';
import {
  GenerateWeeklyBriefRequest,
  GenerateWeeklyBriefResponse,
  SaveWeeklyBriefRequest,
  WeeklyBrief,
  WeeklyBriefCurrentResponse,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceError } from '../errors';

import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Returns the ISO timestamp for the upcoming Sunday at 00:00:00 UTC.
 * Used as the rolling window-reset for the WG Weekly Brief throttle.
 */
function nextSundayIso(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday
  const daysUntilSunday = day === 0 ? 7 : 7 - day;
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilSunday, 0, 0, 0, 0));
  return next.toISOString();
}

/**
 * Returns Sunday→Saturday ISO range for the current week (UTC).
 */
function currentWeekWindow(): { window_start: string; window_end: string } {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday
  const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day, 0, 0, 0, 0));
  const saturday = new Date(sunday);
  saturday.setUTCDate(sunday.getUTCDate() + 6);
  saturday.setUTCHours(23, 59, 59, 999);
  return {
    window_start: sunday.toISOString(),
    window_end: saturday.toISOString(),
  };
}

function buildMockBrief(committeeId: string, overrides: Partial<WeeklyBrief> = {}): WeeklyBrief {
  const nowIso = new Date().toISOString();
  const { window_start, window_end } = currentWeekWindow();
  return {
    uid: 'wb_mock_00000000-0000-0000-0000-000000000001',
    committee_uid: committeeId,
    window_start,
    window_end,
    state: 'generated',
    brief_text:
      'This week the working group made steady progress across collaboration and delivery streams. ' +
      'There were 2 meetings held, with active participation from 3 members covering roadmap alignment, ' +
      'open issues, and upcoming release planning.\n\n' +
      'Discussion focused on outstanding action items, contributor onboarding, and prioritization for the ' +
      'next iteration. The group surfaced no blocking risks and is on track for the planned milestones.',
    source_refs: [],
    prompt_version: 'v1',
    model: 'mock',
    regeneration_count: 0,
    private_source_present: false,
    created_at: nowIso,
    updated_at: nowIso,
    revision: 1,
    ...overrides,
  };
}

/**
 * Service for the WG Weekly Brief feature.
 *
 * Switches between mock data (default) and live committee-service proxy based on
 * `WEEKLY_BRIEF_BACKEND`. Mock mode lets the UI iterate without standing up the
 * upstream brief endpoints; flipping to 'live' proxies straight through. Mock
 * mode is refused outright when `NODE_ENV=production` — see `isLive()`.
 */
export class WeeklyBriefService {
  private microserviceProxy: MicroserviceProxyService = new MicroserviceProxyService();

  /**
   * GET /committees/:committeeId/weekly-briefs/current
   *
   * Upstream's own contract is 200-with-null-brief-and-throttle when no draft
   * exists yet for the window — a 404 here means "committee not found", a
   * real error the caller needs to see, not an empty-brief state to paper
   * over.
   */
  public async getCurrentBrief(req: Request, committeeId: string): Promise<WeeklyBriefCurrentResponse> {
    if (!this.isLive(req)) {
      return {
        brief: buildMockBrief(committeeId),
        throttle: {
          ...WEEKLY_BRIEF_DEFAULT_THROTTLE,
          generates_used: 1,
          window_resets_at: nextSundayIso(),
        },
      };
    }

    logger.debug(req, 'get_weekly_brief_current', 'Proxying to committee-service', { committee_id: committeeId });
    return this.microserviceProxy.proxyRequest<WeeklyBriefCurrentResponse>(
      req,
      'LFX_V2_SERVICE',
      `/committees/${encodeURIComponent(committeeId)}/weekly-briefs/current`,
      'GET'
    );
  }

  /**
   * POST /committees/:committeeId/weekly-briefs/generate
   *
   * Asynchronous upstream: 202 with the brief in `generating` state; the
   * source-gather + LLM call run out-of-band, and callers observe the
   * terminal `generated`/`error` state via GET /current. We propagate the
   * real status code (via `proxyRequestWithResponse`) instead of collapsing
   * everything to 200, so the client can tell "accepted, still working" from
   * "done". 409 (`edited_brief_exists`) and 429 (`throttle_exceeded`) are
   * propagated as-is.
   */
  public async generateBrief(
    req: Request,
    committeeId: string,
    body: GenerateWeeklyBriefRequest
  ): Promise<{ status: number; data: GenerateWeeklyBriefResponse }> {
    if (!this.isLive(req)) {
      const regenerationCount = body?.force ? 2 : 1;
      const data: GenerateWeeklyBriefResponse = {
        brief: buildMockBrief(committeeId, {
          regeneration_count: regenerationCount,
          revision: regenerationCount,
        }),
        throttle: {
          ...WEEKLY_BRIEF_DEFAULT_THROTTLE,
          generates_used: WEEKLY_BRIEF_DEFAULT_THROTTLE.generates_limit,
          regenerations_used: regenerationCount > 1 ? regenerationCount - 1 : 0,
          window_resets_at: nextSundayIso(),
        },
      };
      // Mock mode completes synchronously (no background job to model the
      // real async delay against) — this is a deliberate simplification for
      // local dev, not a claim that upstream behaves this way. See the live
      // branch below for the real 202/generating contract.
      return { status: 200, data };
    }

    logger.debug(req, 'generate_weekly_brief', 'Proxying to committee-service', { committee_id: committeeId, force: body?.force });
    const response = await this.microserviceProxy.proxyRequestWithResponse<GenerateWeeklyBriefResponse>(
      req,
      'LFX_V2_SERVICE',
      `/committees/${encodeURIComponent(committeeId)}/weekly-briefs/generate`,
      'POST',
      undefined,
      body
    );
    return { status: response.status, data: response.data };
  }

  /**
   * PUT /committees/:committeeId/weekly-briefs/current
   *
   * 409 (revision conflict) is propagated as-is so the UI can prompt the user to
   * reload the latest server copy before retrying their edit.
   */
  public async saveBrief(req: Request, committeeId: string, body: SaveWeeklyBriefRequest): Promise<WeeklyBrief> {
    if (!this.isLive(req)) {
      return buildMockBrief(committeeId, {
        state: 'edited',
        brief_text: body.brief_text,
        revision: body.revision + 1,
      });
    }

    logger.debug(req, 'save_weekly_brief', 'Proxying to committee-service', { committee_id: committeeId });
    return this.microserviceProxy.proxyRequest<WeeklyBrief>(
      req,
      'LFX_V2_SERVICE',
      `/committees/${encodeURIComponent(committeeId)}/weekly-briefs/current`,
      'PUT',
      undefined,
      body
    );
  }

  /**
   * Refuses mock mode outright in production instead of silently serving
   * fabricated brief content: mock mode never calls upstream, so it also
   * never enforces committee-level authorization — any authenticated caller
   * would get a "brief" for any committee UID they type. `WEEKLY_BRIEF_BACKEND`
   * ships unset in `.env.example`, so this is the only thing standing between
   * a misconfigured deploy and that failure mode.
   */
  private isLive(req: Request): boolean {
    const backend = process.env['WEEKLY_BRIEF_BACKEND'];
    if (backend === 'live') {
      return true;
    }
    if (process.env['NODE_ENV'] === 'production') {
      throw new MicroserviceError(
        'WEEKLY_BRIEF_BACKEND must be "live" in production — refusing to serve mock weekly-brief content',
        500,
        'WEEKLY_BRIEF_MISCONFIGURED',
        { operation: 'weekly_brief_backend_check', service: 'weekly_brief_service' }
      );
    }
    logger.warning(req, 'weekly_brief_mock_mode', 'Serving mock weekly-brief data — WEEKLY_BRIEF_BACKEND is not "live"', {});
    return false;
  }
}
