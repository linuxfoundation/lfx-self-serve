// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import { CheckAliasNatsResponse, GetForwardNatsResponse, SetTargetNatsResponse } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';
import { NatsService } from './nats.service';

/**
 * Client for the lfx-v2-forwards-service over NATS request/reply.
 *
 * Stateless proxy to forwardemail.net that owns the `<alias>@<domain> → target`
 * routing. Alias *ownership* is owned by the auth-service (system-managed linked
 * identity); forwards-service verifies it by forwarding the caller's token to
 * auth-service `user_emails.read`, so the caller supplies the user's JWT and the
 * active domain.
 *
 * Token requirement: `getForward`/`setTarget` validate the JWT against
 * forwards-service `AUTH0_AUDIENCE` (the Auth0 **Management API** audience) with
 * a strict exact-match, so `authToken` must be the **Flow C management token**
 * (same one `add_alias` uses) — not the plain user bearer token. `checkAlias`
 * needs no auth.
 *
 * Follows the same conventions as `email-verification.service.ts`: shared
 * `NatsService`, string codec, 5s timeout, and graceful degradation — a NATS
 * timeout / no-responder surfaces as a service-unavailable signal rather than
 * throwing, so the controller can render the `service_unavailable` state.
 */
export class ForwardsService {
  private natsService: NatsService;

  public constructor() {
    this.natsService = new NatsService();
  }

  /**
   * Check whether an alias is already taken on the domain (unauthenticated).
   * Returns null when the forwards-service is unreachable.
   */
  public async checkAlias(req: Request, alias: string, domain: string): Promise<CheckAliasNatsResponse | null> {
    const codec = this.natsService.getCodec();

    logger.debug(req, 'forwards_check_alias', 'Checking alias availability via NATS', { domain });

    try {
      const payload = JSON.stringify({ alias, domain });
      const response = await this.natsService.request(NatsSubjects.FORWARDS_CHECK_ALIAS, codec.encode(payload), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      return JSON.parse(codec.decode(response.data)) as CheckAliasNatsResponse;
    } catch (error) {
      logger.warning(req, 'forwards_check_alias', 'NATS check alias failed', { domain, err: error });
      return null;
    }
  }

  /**
   * Read the current forwarding target for the caller's alias on the domain.
   * Returns null when the forwards-service is unreachable.
   */
  public async getForward(req: Request, authToken: string, domain: string): Promise<GetForwardNatsResponse | null> {
    const codec = this.natsService.getCodec();

    logger.debug(req, 'forwards_get_forward', 'Reading forward target via NATS', { domain });

    try {
      const payload = JSON.stringify({ user: { auth_token: authToken }, domain });
      const response = await this.natsService.request(NatsSubjects.FORWARDS_GET_FORWARD, codec.encode(payload), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      return JSON.parse(codec.decode(response.data)) as GetForwardNatsResponse;
    } catch (error) {
      logger.warning(req, 'forwards_get_forward', 'NATS get forward failed', { domain, err: error });
      return null;
    }
  }

  /**
   * Create or update (idempotent) the forwarding target for the caller's alias.
   * Returns null when the forwards-service is unreachable.
   */
  public async setTarget(req: Request, authToken: string, forwardTo: string, domain: string): Promise<SetTargetNatsResponse | null> {
    const codec = this.natsService.getCodec();

    logger.debug(req, 'forwards_set_target', 'Setting forward target via NATS', { domain });

    try {
      const payload = JSON.stringify({ user: { auth_token: authToken }, domain, target_email: forwardTo });
      const response = await this.natsService.request(NatsSubjects.FORWARDS_SET_TARGET, codec.encode(payload), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      return JSON.parse(codec.decode(response.data)) as SetTargetNatsResponse;
    } catch (error) {
      logger.warning(req, 'forwards_set_target', 'NATS set target failed', { domain, err: error });
      return null;
    }
  }
}
