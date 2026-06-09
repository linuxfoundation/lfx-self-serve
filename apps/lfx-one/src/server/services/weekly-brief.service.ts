// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_QUERY_PARAMS, WEEKLY_BRIEF_DEFAULT_THROTTLE } from '@lfx-one/shared/constants';
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

function defaultThrottle(): WeeklyBriefThrottle {
  return {
    ...WEEKLY_BRIEF_DEFAULT_THROTTLE,
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
 *
 * When `COMMITTEE_SERVICE_URL` is set on the live path, calls the committee-
 * service directly at that base URL instead of going through the
 * `LFX_V2_SERVICE` gateway — useful for testing against a locally-running
 * committee-service without retargeting `LFX_V2_SERVICE` globally.
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
          ...WEEKLY_BRIEF_DEFAULT_THROTTLE,
          generates_used: 1,
          window_resets_at: nextSundayIso(),
        },
      };
    }

    try {
      return await this.proxyToCommitteeService<WeeklyBriefCurrentResponse>(req, `/committees/${committeeId}/weekly-briefs/current`, 'GET');
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

    return this.proxyToCommitteeService<GenerateWeeklyBriefResponse>(req, `/committees/${committeeId}/weekly-briefs/generate`, 'POST', body);
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

    return this.proxyToCommitteeService<WeeklyBrief>(req, `/committees/${committeeId}/weekly-briefs/current`, 'PUT', body);
  }

  private isLive(): boolean {
    return process.env['WEEKLY_BRIEF_BACKEND'] === 'live';
  }

  /**
   * Routes a committee-service call. By default goes through `LFX_V2_SERVICE`
   * via `MicroserviceProxyService`. When `COMMITTEE_SERVICE_URL` is set, calls
   * that base URL directly with the incoming Authorization header forwarded —
   * lets us point at a local committee-service without retargeting
   * `LFX_V2_SERVICE` globally.
   */
  private async proxyToCommitteeService<T>(req: Request, path: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
    const overrideUrl = process.env['COMMITTEE_SERVICE_URL'];
    logger.debug(req, 'proxy_to_committee_service', overrideUrl ? 'Using COMMITTEE_SERVICE_URL override' : 'Using LFX_V2_SERVICE gateway', { path, method });
    // Direct fetch (not via MicroserviceProxyService) is deliberate for the local-
    // dev override path: keeps the COMMITTEE_SERVICE_URL switch scoped to weekly
    // brief without retargeting the shared LFX_V2_SERVICE URL globally.
    if (overrideUrl) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (req.bearerToken) {
        headers['Authorization'] = `Bearer ${req.bearerToken}`;
      }
      // Use `new URL` so a trailing slash on COMMITTEE_SERVICE_URL doesn't
      // produce `//path` and so the absence of one doesn't drop the path.
      const target = new URL(path, overrideUrl.endsWith('/') ? overrideUrl : overrideUrl + '/');
      // Match MicroserviceProxyService.proxyRequest which always appends
      // DEFAULT_QUERY_PARAMS (`v=1`) — keeping behaviour consistent across
      // the gateway and override paths so the override is a drop-in for
      // local dev.
      for (const [k, v] of Object.entries(DEFAULT_QUERY_PARAMS)) {
        if (!target.searchParams.has(k)) {
          target.searchParams.set(k, v);
        }
      }
      // 15s timeout + abort signal so a hanging committee-service doesn't
      // wedge the BFF request indefinitely.
      const response = await fetch(target.toString(), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      const operation = `${method.toLowerCase()}_${path.replace(/\//g, '_')}`;
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let errorBody: unknown;
        try {
          errorBody = errorText ? JSON.parse(errorText) : undefined;
        } catch {
          errorBody = errorText ? { message: errorText } : undefined;
        }
        throw MicroserviceError.fromMicroserviceResponse(response.status, response.statusText, errorBody, 'COMMITTEE_SERVICE_URL', path, operation);
      }
      // 204 / empty body on a path that expects a JSON envelope is an
      // upstream contract violation — wrap as 502 (bad gateway) rather than
      // leaking the raw 204 status through MicroserviceError, since the
      // weekly-brief endpoints always return a payload on success.
      if (response.status === 204 || response.headers.get('content-length') === '0') {
        throw MicroserviceError.fromMicroserviceResponse(
          502,
          'Bad Gateway',
          { message: `committee-service returned ${response.status} where a JSON payload was expected` },
          'COMMITTEE_SERVICE_URL',
          path,
          operation
        );
      }
      // Defensively text-read + parse: an empty/non-JSON 200 body would make
      // response.json() throw a SyntaxError that bypasses MicroserviceError
      // wrapping and surfaces as an unhelpful 500 to the UI.
      const text = await response.text();
      if (!text) {
        throw MicroserviceError.fromMicroserviceResponse(
          502,
          'Bad Gateway',
          { message: 'committee-service returned an empty 2xx body' },
          'COMMITTEE_SERVICE_URL',
          path,
          operation
        );
      }
      try {
        return JSON.parse(text) as T;
      } catch (err) {
        throw MicroserviceError.fromMicroserviceResponse(
          502,
          'Bad Gateway',
          { message: 'committee-service returned a non-JSON 2xx body', detail: err instanceof Error ? err.message : String(err) },
          'COMMITTEE_SERVICE_URL',
          path,
          operation
        );
      }
    }
    return this.microserviceProxy.proxyRequest<T>(req, 'LFX_V2_SERVICE', path, method, undefined, body);
  }
}
