// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Auth0Identity } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';
import { EmailVerificationService } from './email-verification.service';

/**
 * Service for fetching Auth0 user identity data.
 * Routes through the NATS auth-service which has internal M2M access to Auth0.
 */
export class Auth0Service {
  private emailVerificationService: EmailVerificationService;

  public constructor() {
    this.emailVerificationService = new EmailVerificationService();
  }

  /**
   * Get the linked identities for an Auth0 user via NATS auth-service.
   * Sends the user's Auth0 sub (e.g., "auth0|fghiasy") which the auth-service
   * resolves via canonical lookup without JWT validation.
   *
   * @param req - Express request for logging context
   * @param auth0Sub - The user's Auth0 sub claim (e.g., "auth0|fghiasy")
   * @returns Array of Auth0 linked identities
   */
  public async getUserIdentities(req: Request, auth0Sub: string): Promise<Auth0Identity[]> {
    if (!auth0Sub) {
      logger.debug(req, 'get_auth0_identities', 'Skipping Auth0 identity lookup — no auth0Sub available');
      return [];
    }

    logger.debug(req, 'get_auth0_identities', 'Fetching Auth0 user identities via NATS', { auth0_sub: auth0Sub });

    return this.emailVerificationService.listIdentities(req, auth0Sub);
  }
}
