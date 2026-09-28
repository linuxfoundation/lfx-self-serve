// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  INSIGHTS_TOKEN_AUDIENCE,
  INSIGHTS_TOKEN_ELIGIBILITY_UNAVAILABLE,
  INSIGHTS_TOKEN_ERROR_CODES,
  INSIGHTS_TOKEN_INELIGIBLE,
} from '@lfx-one/shared/constants';
import type {
  CreateInsightsTokenResponse,
  InsightsToken,
  InsightsTokenEligibility,
  InsightsTokenEligibleOrg,
  MemberOrgTier,
  PatServiceCreateResponse,
  PatServiceListResponse,
  PatServiceToken,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { getDefaultMessageForStatus } from '../helpers/http-status.helper';

import { MicroserviceError } from '../errors/microservice.error';
import { getUsernameFromAuth } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';
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
 * bearer (the service scopes tokens to the caller's principal). Eligibility follows architecture
 * option 4b: the UI/BFF asks the member-service tier endpoint before the PAT service issues a token.
 */
export class InsightsTokensService {
  private readonly microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
  }

  /** Caller's Insights tokens, newest first. Key Contacts only; the audience is always fixed server-side. */
  public async listTokens(req: Request): Promise<InsightsToken[]> {
    await this.assertKeyContact(req, 'list_insights_tokens', '/tokens');
    const response = await this.microserviceProxy.proxyRequest<PatServiceListResponse>(req, 'LFX_V2_SERVICE', '/tokens', 'GET', {
      v: '1',
      audience: INSIGHTS_TOKEN_AUDIENCE,
    });
    const tokens = (response?.tokens ?? []).map((token) => this.toInsightsToken(token));
    logger.debug(req, 'list_insights_tokens', 'Fetched Insights tokens from PAT service', { count: tokens.length });
    return tokens;
  }

  /** Issues a token for a Key Contact. The plaintext secret is returned exactly once by the PAT service. */
  public async createToken(req: Request, name: string): Promise<CreateInsightsTokenResponse> {
    await this.assertKeyContact(req, 'create_insights_token', '/tokens');

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

  /** Revokes one of the caller's tokens, for Key Contacts only. The PAT service returns 404 for tokens the caller does not own. */
  public async revokeToken(req: Request, uid: string): Promise<void> {
    await this.assertKeyContact(req, 'revoke_insights_token', '/tokens/{uid}');
    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/tokens/${encodeURIComponent(uid)}`, 'DELETE', { v: '1' });
    logger.debug(req, 'revoke_insights_token', 'PAT service revoked Insights token', { token_uid: uid });
  }

  /**
   * Whether the caller may create tokens: they must be a Key Contact of at least one org. Any entry
   * with a non-empty `b2b_org_uid` is enough; `company_name` is optional upstream and the tier value
   * itself is not checked. Fails closed:
   * an empty list or a missing username yields `canCreate: false`; any upstream error, a response that
   * is not a list, or a non-empty list with no usable org uid (including the
   * gateway denying the M2M caller before its FGA team tuples exist) yields `canCreate: false` with
   * `checkFailed: true`, so the UI can say "couldn't verify" instead of "not a Key Contact".
   *
   * The tier endpoint is M2M-only (FGA team `member_tiers_caller`). The username comes from the
   * authenticated session, never from client input, so a caller can only look up themselves; the M2M
   * token is scoped to this single call via `options.bearerToken`.
   */
  public async getEligibility(req: Request): Promise<InsightsTokenEligibility> {
    const username = await getUsernameFromAuth(req);
    if (!username) {
      logger.warning(req, 'get_insights_token_eligibility', 'No username on session; treating as ineligible');
      return INSIGHTS_TOKEN_INELIGIBLE;
    }

    try {
      const m2mToken = await generateM2MToken(req);
      logger.debug(req, 'get_insights_token_eligibility', 'Minted M2M token; looking up member tiers');
      const tiers = await this.microserviceProxy.proxyRequest<MemberOrgTier[]>(
        req,
        'LFX_V2_SERVICE',
        `/b2b_orgs/member-tiers/${encodeURIComponent(username)}`,
        'GET',
        { v: '1' },
        undefined,
        undefined,
        { bearerToken: m2mToken }
      );

      // A 200 that is not a list means the check could not be completed, not that the caller has no orgs;
      // throw so the catch below reports it as unavailable rather than "not a Key Contact".
      if (!Array.isArray(tiers)) {
        throw new TypeError('Member tier response is not a list');
      }

      // Eligibility keys on the org uid: member-service omits `company_name` when the Account has none,
      // and a Key Contact of such an org is still eligible. The name is carried only when present.
      const seen = new Set<string>();
      const orgs: InsightsTokenEligibleOrg[] = [];
      for (const tier of tiers) {
        const uid = tier.b2b_org_uid?.trim();
        if (!uid || seen.has(uid)) continue;
        seen.add(uid);
        const name = tier.company_name?.trim();
        orgs.push(name ? { uid, name } : { uid });
      }
      // Upstream requires `b2b_org_uid` on every entry, so a non-empty list with none usable is a broken
      // response, not a confirmed "not a Key Contact". Only an empty list means ineligible.
      if (tiers.length > 0 && orgs.length === 0) {
        throw new TypeError('Member tier response has no usable org uid');
      }

      logger.debug(req, 'get_insights_token_eligibility', 'Resolved member tiers', {
        tier_count: tiers.length,
        org_count: orgs.length,
      });
      return { canCreate: orgs.length > 0, orgs, checkFailed: false };
    } catch (error) {
      // Not `{ err: error }`: a MicroserviceError's path/operation embed the username from the tier URL.
      const status = error instanceof MicroserviceError ? error.statusCode : undefined;
      const code = error instanceof MicroserviceError ? error.code : (error as Error)?.name;
      logger.warning(req, 'get_insights_token_eligibility', 'Member tier lookup failed; failing closed', { status, code });
      return INSIGHTS_TOKEN_ELIGIBILITY_UNAVAILABLE;
    }
  }

  /**
   * Re-runs the Key Contact check (the UI gate is not trusted) before any token call, so list, create
   * and revoke share one enforcement: 503 `eligibility_unavailable` when it could not be verified, 403
   * `not_key_contact` when the caller is not one. A user who loses Key Contact status loses access to
   * their existing tokens too (product decision, IN-1233).
   */
  private async assertKeyContact(req: Request, operation: string, path: string): Promise<void> {
    const eligibility = await this.getEligibility(req);
    if (eligibility.checkFailed) {
      throw new MicroserviceError('Key Contact eligibility could not be verified', 503, 'SERVICE_UNAVAILABLE', {
        operation,
        service: 'insights_tokens_service',
        path,
        errorBody: { error: INSIGHTS_TOKEN_ERROR_CODES.ELIGIBILITY_UNAVAILABLE },
      });
    }
    if (!eligibility.canCreate) {
      throw new MicroserviceError('Only Key Contacts of a member organization can use Insights API tokens', 403, 'FORBIDDEN', {
        operation,
        service: 'insights_tokens_service',
        path,
        errorBody: { error: INSIGHTS_TOKEN_ERROR_CODES.NOT_KEY_CONTACT },
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
