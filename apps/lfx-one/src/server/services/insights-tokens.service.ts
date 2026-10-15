// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  INSIGHTS_PUBLIC_API_TOKEN_ACCESS_FLAG,
  INSIGHTS_TOKEN_AUDIENCE,
  INSIGHTS_TOKEN_ELIGIBLE,
  INSIGHTS_TOKEN_ERROR_CODES,
  INSIGHTS_TOKEN_INELIGIBLE,
} from '@lfx-one/shared/constants';
import type {
  CreateInsightsTokenResponse,
  InsightsToken,
  InsightsTokenEligibility,
  PatServiceCreateResponse,
  PatServiceListResponse,
  PatServiceToken,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { getDefaultMessageForStatus } from '../helpers/http-status.helper';

import { MicroserviceError } from '../errors/microservice.error';
import { LaunchDarklyServerService } from './launchdarkly-server.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * The PAT service's refusal with its prose dropped, keeping status, code and the upstream error code.
 *
 * A `token_name_taken` refusal's `message` repeats the requested token name, and
 * `MicroserviceError.fromMicroserviceResponse` copies that sentence into `message` and the raw body
 * into `error_body`, both of which the API error handler logs. Same approach as `withoutUpstreamBody`
 * in `cla.service.ts`, except the discriminating `error` code is kept: the create dialog maps it
 * (as `upstreamCode`) to its inline message, and it names no one.
 */
function withoutPatRefusalText(error: unknown): unknown {
  if (!(error instanceof MicroserviceError)) return error;

  const upstreamCode = typeof error.errorBody?.['error'] === 'string' ? error.errorBody['error'] : undefined;
  return new MicroserviceError(getDefaultMessageForStatus(error.statusCode), error.statusCode, error.code, {
    operation: error.operation,
    service: error.service,
    path: error.path,
    errorBody: upstreamCode ? { error: upstreamCode } : undefined,
    originalMessage: error.originalMessage,
    transportFailure: error.transportFailure,
    clientMessage: error.clientMessage,
  });
}

/**
 * LFX Insights API tokens (IN-1233). Token CRUD proxies `lfx-v2-pat-service` with the user's own
 * bearer (the service scopes tokens to the caller's principal). Access is decided by the
 * `insights-public-api-token-access` flag alone, evaluated on the server for the session user.
 */
export class InsightsTokensService {
  private readonly microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
  }

  /** Caller's Insights tokens, newest first. Flag-enabled users only; the audience is always fixed server-side. */
  public async listTokens(req: Request): Promise<InsightsToken[]> {
    await this.assertAccess(req, 'list_insights_tokens', '/tokens');
    const response = await this.microserviceProxy.proxyRequest<PatServiceListResponse>(req, 'LFX_V2_SERVICE', '/tokens', 'GET', {
      v: '1',
      audience: INSIGHTS_TOKEN_AUDIENCE,
    });
    const tokens = (response?.tokens ?? []).map((token) => this.toInsightsToken(token));
    logger.debug(req, 'list_insights_tokens', 'Fetched Insights tokens from PAT service', { count: tokens.length });
    return tokens;
  }

  /** Issues a token for a flag-enabled user. The plaintext secret is returned exactly once by the PAT service. */
  public async createToken(req: Request, name: string): Promise<CreateInsightsTokenResponse> {
    await this.assertAccess(req, 'create_insights_token', '/tokens');

    let response: PatServiceCreateResponse;
    try {
      response = await this.microserviceProxy.proxyRequest<PatServiceCreateResponse>(
        req,
        'LFX_V2_SERVICE',
        '/tokens',
        'POST',
        { v: '1' },
        { name, audience: INSIGHTS_TOKEN_AUDIENCE }
      );
    } catch (error) {
      throw withoutPatRefusalText(error);
    }
    // The secret is never logged; the token uid is enough to trace the call.
    logger.debug(req, 'create_insights_token', 'PAT service issued Insights token', { token_uid: response.token.uid });
    return { token: this.toInsightsToken(response.token), secret: response.secret };
  }

  /** Revokes one of the caller's tokens, for flag-enabled users only. The PAT service returns 404 for tokens the caller does not own. */
  public async revokeToken(req: Request, uid: string): Promise<void> {
    await this.assertAccess(req, 'revoke_insights_token', '/tokens/{uid}');
    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/tokens/${encodeURIComponent(uid)}`, 'DELETE', { v: '1' });
    logger.debug(req, 'revoke_insights_token', 'PAT service revoked Insights token', { token_uid: uid });
  }

  /**
   * Whether the caller may use Insights tokens. The `insights-public-api-token-access` flag decides on
   * its own: off, the default, means only the LFIDs the flag targets individually; serving it on to
   * everyone opens tokens to every LFID holder. There is no membership lookup. The server evaluates the
   * flag against the session's LFID username, never from anything the client sends, and fails closed:
   * with no SDK key, no username, or LaunchDarkly not reached yet, the answer is `false`. Once
   * connected, a later outage serves the last known flag value, so a targeting removal takes effect on
   * reconnect (accepted; see `LaunchDarklyServerService`). `checkFailed` is never set here; the browser
   * sets it when the eligibility request itself fails.
   */
  public async getEligibility(req: Request): Promise<InsightsTokenEligibility> {
    const enabled = await LaunchDarklyServerService.getInstance().isFlagEnabled(req, INSIGHTS_PUBLIC_API_TOKEN_ACCESS_FLAG, false);
    logger.debug(req, 'get_insights_token_eligibility', 'Evaluated the insights-public-api-token-access flag', { enabled });
    return enabled ? INSIGHTS_TOKEN_ELIGIBLE : INSIGHTS_TOKEN_INELIGIBLE;
  }

  /**
   * Re-runs the flag check (the UI gate is not trusted) before any token call, so list, create and
   * revoke share one enforcement: 403 `not_enabled` when the flag is off for the caller. A user the
   * flag stops targeting loses access to their existing tokens too (product decision, IN-1233).
   */
  private async assertAccess(req: Request, operation: string, path: string): Promise<void> {
    const eligibility = await this.getEligibility(req);
    if (!eligibility.canCreate) {
      throw new MicroserviceError('LFX Insights API tokens are not enabled for this account', 403, 'FORBIDDEN', {
        operation,
        service: 'insights_tokens_service',
        path,
        errorBody: { error: INSIGHTS_TOKEN_ERROR_CODES.NOT_ENABLED },
      });
    }
  }

  private toInsightsToken(token: PatServiceToken): InsightsToken {
    return {
      uid: token.uid,
      name: token.name,
      lookupId: token.lookup_id,
      createdAt: token.created_at,
      lastUsedAt: token.last_used_at ?? null,
    };
  }
}
