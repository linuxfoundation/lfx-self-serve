// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { init } from '@launchdarkly/node-server-sdk';
import { LAUNCHDARKLY_SERVER_INIT_TIMEOUT_SECONDS } from '@lfx-one/shared/constants';
import { Request } from 'express';

import { getEffectiveUsername, isImpersonating } from '../utils/auth-helper';
import { logger } from './logger.service';

import type { LDClient } from '@launchdarkly/node-server-sdk';

/**
 * Per-user LaunchDarkly flag evaluation for the BFF.
 *
 * The browser evaluates flags through the OpenFeature Web SDK, which cannot gate an Express
 * handler, and `server-feature-flag.helper.ts` only reads env vars, which cannot target
 * individual users. This service is the one place the server asks LaunchDarkly about a user, with
 * the same context shape and key the browser sends (`kind: 'user'`, see `resolveContextKey`), so a
 * flag targeted at named users gives the same answer on both sides.
 *
 * Needs `LD_SDK_KEY`, the **server-side** SDK key. `LD_CLIENT_ID` is a client-side ID and cannot be
 * used here. Without the key, or while LaunchDarkly is unreachable, every evaluation returns the
 * caller's default, so callers must pass the safe value (fail closed for access checks).
 *
 * Lazy singleton: the SDK connects on the first evaluation, so pods and tests that never evaluate
 * a flag never open a streaming connection.
 */
export class LaunchDarklyServerService {
  private static instance: LaunchDarklyServerService | null = null;
  private client: LDClient | null = null;
  private initAttempted = false;
  private closed = false;
  private missingKeyLogged = false;

  public static getInstance(): LaunchDarklyServerService {
    if (!LaunchDarklyServerService.instance) {
      LaunchDarklyServerService.instance = new LaunchDarklyServerService();
    }
    return LaunchDarklyServerService.instance;
  }

  /** Closes the client only if it was ever created, so server shutdown never opens a connection to close it. */
  public static shutdownIfInitialized(): Promise<void> {
    return LaunchDarklyServerService.instance?.shutdown() ?? Promise.resolve();
  }

  /** Drops the singleton (for tests). */
  public static resetInstance(): void {
    LaunchDarklyServerService.instance?.client?.close();
    LaunchDarklyServerService.instance = null;
  }

  /**
   * Whether `flagKey` is on for the authenticated user. Returns `defaultValue` when there is no
   * username on the session, no SDK key, LaunchDarkly has not connected in time, or evaluation
   * throws. Never throws.
   */
  public async isFlagEnabled(req: Request, flagKey: string, defaultValue = false): Promise<boolean> {
    try {
      const contextKey = this.resolveContextKey(req);
      if (!contextKey) {
        logger.warning(req, 'evaluate_server_flag', 'No username on session; using flag default', { flag: flagKey });
        return defaultValue;
      }

      const client = await this.getReadyClient(req);
      if (!client) {
        return defaultValue;
      }

      return await client.boolVariation(flagKey, { kind: 'user', key: contextKey }, defaultValue);
    } catch (error) {
      logger.warning(req, 'evaluate_server_flag', 'Flag evaluation failed; using flag default', {
        flag: flagKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return defaultValue;
    }
  }

  /**
   * The LaunchDarkly context key, derived the same way as the browser's `targetingKey`
   * (`FeatureFlagService.initialize`: `preferred_username`, then `username`, then the LF username
   * claim), so one username targets a user on both sides. Read from the signed OIDC session, never
   * from client input. While impersonating, the target's stored username is used, so the
   * impersonator's own targeting never leaks into the target's read-only view.
   */
  private resolveContextKey(req: Request): string | null {
    if (isImpersonating(req)) {
      return getEffectiveUsername(req);
    }

    const user = req.oidc?.user;
    const key = user?.['preferred_username'] || user?.['username'] || user?.['https://sso.linuxfoundation.org/claims/username'];
    return typeof key === 'string' && key ? key : null;
  }

  private async getReadyClient(req: Request): Promise<LDClient | null> {
    const sdkKey = process.env['LD_SDK_KEY'];
    if (!sdkKey) {
      // An unset key is a valid, safe configuration, so warn once per process instead of on every request.
      if (this.missingKeyLogged) {
        logger.debug(req, 'evaluate_server_flag', 'LD_SDK_KEY is not set; using flag default');
      } else {
        this.missingKeyLogged = true;
        logger.warning(req, 'evaluate_server_flag', 'LD_SDK_KEY is not set; server flag evaluation is disabled');
      }
      return null;
    }

    if (this.closed) {
      return null;
    }

    this.client ??= init(sdkKey);

    // Only the first evaluation waits for the connection. While LaunchDarkly stays unreachable the SDK
    // keeps retrying, and waiting again would add the full timeout to every later request.
    if (this.client.initialized()) {
      return this.client;
    }
    if (this.initAttempted) {
      return null;
    }
    this.initAttempted = true;

    try {
      await this.client.waitForInitialization({ timeout: LAUNCHDARKLY_SERVER_INIT_TIMEOUT_SECONDS });
      return this.client;
    } catch (error) {
      // The SDK keeps connecting in the background; once it reports ready, later requests use it.
      logger.warning(req, 'evaluate_server_flag', 'LaunchDarkly not ready; using flag default', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /** After shutdown no request may open a new connection; evaluations fail closed. */
  private shutdown(): Promise<void> {
    this.closed = true;
    this.client?.close();
    this.client = null;
    return Promise.resolve();
  }
}
