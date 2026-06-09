// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  GenerateWeeklyBriefRequest,
  GenerateWeeklyBriefResponse,
  SaveWeeklyBriefRequest,
  WeeklyBrief,
  WeeklyBriefCurrentResponse,
  WeeklyBriefThrottle,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceError } from '../errors';

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

function defaultThrottle(): WeeklyBriefThrottle {
  return {
    generates_used: 0,
    generates_limit: 2,
    regenerations_used: 0,
    regenerations_limit: 3,
    window_resets_at: nextSundayIso(),
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
 * upstream brief endpoints; flipping to 'live' proxies straight through.
 */
export class WeeklyBriefService {
  private microserviceProxy: MicroserviceProxyService = new MicroserviceProxyService();

  /**
   * GET /committees/:committeeId/weekly-briefs/current
   *
   * Upstream may 404 when no brief has been generated yet for the current window;
   * we normalize that to `{ brief: null, throttle: defaultThrottle() }` so the UI
   * can render the empty-state without treating it as an error.
   */
  public async getCurrentBrief(req: Request, committeeId: string): Promise<WeeklyBriefCurrentResponse> {
    if (!this.isLive()) {
      return {
        brief: buildMockBrief(committeeId),
        throttle: {
          generates_used: 1,
          generates_limit: 2,
          regenerations_used: 0,
          regenerations_limit: 3,
          window_resets_at: nextSundayIso(),
        },
      };
    }

    try {
      return await this.microserviceProxy.proxyRequest<WeeklyBriefCurrentResponse>(
        req,
        'LFX_V2_SERVICE',
        `/committees/${committeeId}/weekly-briefs/current`,
        'GET'
      );
    } catch (error) {
      // Narrow the 404 to the proxy error type — checking a loose `.status`
      // property could mask other errors that happen to have that field.
      if (error instanceof MicroserviceError && error.statusCode === 404) {
        return { brief: null, throttle: defaultThrottle() };
      }
      throw error;
    }
  }

  /**
   * POST /committees/:committeeId/weekly-briefs/generate
   *
   * 429 (throttle exhausted) and 409 (revision conflict / concurrent generate) are
   * propagated as-is so the controller / global error handler can surface them to
   * the UI without losing the upstream status code.
   */
  public async generateBrief(req: Request, committeeId: string, body: GenerateWeeklyBriefRequest): Promise<GenerateWeeklyBriefResponse> {
    if (!this.isLive()) {
      const regenerationCount = body?.revision ? body.revision : 1;
      return {
        brief: buildMockBrief(committeeId, {
          regeneration_count: regenerationCount,
          revision: regenerationCount,
        }),
        throttle: {
          generates_used: 2,
          generates_limit: 2,
          regenerations_used: regenerationCount > 1 ? regenerationCount - 1 : 0,
          regenerations_limit: 3,
          window_resets_at: nextSundayIso(),
        },
      };
    }

    return this.microserviceProxy.proxyRequest<GenerateWeeklyBriefResponse>(
      req,
      'LFX_V2_SERVICE',
      `/committees/${committeeId}/weekly-briefs/generate`,
      'POST',
      undefined,
      body
    );
  }

  /**
   * PUT /committees/:committeeId/weekly-briefs/current
   *
   * 409 (revision conflict) is propagated as-is so the UI can prompt the user to
   * reload the latest server copy before retrying their edit.
   */
  public async saveBrief(req: Request, committeeId: string, body: SaveWeeklyBriefRequest): Promise<WeeklyBrief> {
    if (!this.isLive()) {
      return buildMockBrief(committeeId, {
        state: 'edited',
        brief_text: body.brief_text,
        revision: body.revision + 1,
      });
    }

    return this.microserviceProxy.proxyRequest<WeeklyBrief>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/weekly-briefs/current`, 'PUT', undefined, body);
  }

  private isLive(): boolean {
    return process.env['WEEKLY_BRIEF_BACKEND'] === 'live';
  }
}
