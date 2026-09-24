// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { INSIGHTS_TOKEN_AUDIENCE, INSIGHTS_TOKEN_ELIGIBILITY_UNAVAILABLE, INSIGHTS_TOKEN_INELIGIBLE } from '@lfx-one/shared/constants';
import type {
  CreateInsightsTokenResponse,
  InsightsToken,
  InsightsTokenEligibility,
  MemberOrgTier,
  PatServiceCreateResponse,
  PatServiceListResponse,
  PatServiceToken,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceError } from '../errors/microservice.error';
import { getUsernameFromAuth } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

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

  /** Caller's Insights tokens, newest first. The audience is always fixed server-side. */
  public async listTokens(req: Request): Promise<InsightsToken[]> {
    const response = await this.microserviceProxy.proxyRequest<PatServiceListResponse>(req, 'LFX_V2_SERVICE', '/tokens', 'GET', {
      v: '1',
      audience: INSIGHTS_TOKEN_AUDIENCE,
    });
    const tokens = (response?.tokens ?? []).map((token) => this.toInsightsToken(token));
    logger.debug(req, 'list_insights_tokens', 'Fetched Insights tokens from PAT service', { count: tokens.length });
    return tokens;
  }

  /** Issues a token. The plaintext secret is returned exactly once by the PAT service. */
  public async createToken(req: Request, name: string): Promise<CreateInsightsTokenResponse> {
    const response = await this.microserviceProxy.proxyRequest<PatServiceCreateResponse>(
      req,
      'LFX_V2_SERVICE',
      '/tokens',
      'POST',
      { v: '1' },
      { name, audience: INSIGHTS_TOKEN_AUDIENCE }
    );
    // Never log the name or the secret; the token uid is enough to trace the call.
    logger.debug(req, 'create_insights_token', 'PAT service issued Insights token', { token_uid: response.token.uid });
    return { token: this.toInsightsToken(response.token), secret: response.secret };
  }

  /** Revokes one of the caller's tokens. The PAT service returns 404 for tokens the caller does not own. */
  public async revokeToken(req: Request, uid: string): Promise<void> {
    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/tokens/${encodeURIComponent(uid)}`, 'DELETE', { v: '1' });
    logger.debug(req, 'revoke_insights_token', 'PAT service revoked Insights token', { token_uid: uid });
  }

  /**
   * Whether the caller may create tokens: they must be a Key Contact of at least one org. Any org
   * entry that carries a company name is enough — the tier value itself is not checked. Fails closed:
   * an empty list or a missing username yields `canCreate: false`; any upstream error (including the
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

      const seen = new Set<string>();
      const orgs = (Array.isArray(tiers) ? tiers : [])
        .filter((tier) => !!tier.company_name?.trim())
        .filter((tier) => {
          if (seen.has(tier.b2b_org_uid)) return false;
          seen.add(tier.b2b_org_uid);
          return true;
        })
        .map((tier) => ({ uid: tier.b2b_org_uid, name: (tier.company_name as string).trim() }));

      logger.debug(req, 'get_insights_token_eligibility', 'Resolved member tiers', {
        tier_count: Array.isArray(tiers) ? tiers.length : 0,
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
