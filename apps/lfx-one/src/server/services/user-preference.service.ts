// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { getUserServiceBaseUrl } from '../helpers/api-gateway.helper';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import { logger } from './logger.service';
import { UserService } from './user.service';

import type { UserServicePreference, UserServicePreferenceList } from '@lfx-one/shared/interfaces';

/**
 * Generic per-user preference proxy over the v1 user-service, generalized from the profile-visibility
 * plumbing in `user.service.ts`. Callers pin AppName/Name; the user's `apiGatewayToken` (never M2M) authenticates every upstream call.
 */
export class UserPreferenceService {
  private readonly userService: UserService;

  public constructor() {
    this.userService = new UserService();
  }

  /** Returns the stored `Value`, or null on first use (no row yet is not an error). */
  public async getPreference(req: Request, appName: string, name: string): Promise<string | null> {
    const operation = 'get_user_preference';
    const sfid = await this.resolveSfid(req, operation);
    const existing = await this.fetchPreference(req, sfid, appName, name, operation);
    return existing?.Value ?? null;
  }

  /** Read-first upsert mirroring `upsertVisibilityPreference`: PATCH when present, else POST; a POST that races into a 409 falls back to fetch + PATCH. */
  public async upsertPreference(req: Request, appName: string, name: string, value: string): Promise<void> {
    const operation = 'upsert_user_preference';
    const sfid = await this.resolveSfid(req, operation);
    const existing = await this.fetchPreference(req, sfid, appName, name, operation);

    if (existing) {
      await this.patchPreference(req, sfid, existing, value, operation);
      return;
    }

    const baseUrl = getUserServiceBaseUrl(operation, 'user_service');
    try {
      await gatewayFetch<UserServicePreference>(req, `${baseUrl}/users/${encodeURIComponent(sfid)}/preferences`, {
        operation,
        service: 'user_service',
        errorMessage: 'Preference creation failed',
        errorCode: 'USER_PREFERENCE_CREATE_FAILED',
        method: 'POST',
        body: { AppName: appName, Name: name, Type: 'json', System: false, Value: value },
      });
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 409) {
        logger.warning(req, operation, 'Preference already exists; falling back to update', { name });
        const current = await this.fetchPreference(req, sfid, appName, name, operation);
        if (current) {
          await this.patchPreference(req, sfid, current, value, operation);
          return;
        }
      }
      throw error;
    }
  }

  /** Idempotent delete: an absent row is a no-op success (the client store deletes on empty state). */
  public async deletePreference(req: Request, appName: string, name: string): Promise<void> {
    const operation = 'delete_user_preference';
    const sfid = await this.resolveSfid(req, operation);
    const existing = await this.fetchPreference(req, sfid, appName, name, operation);

    if (!existing) {
      return;
    }

    const baseUrl = getUserServiceBaseUrl(operation, 'user_service');
    await gatewayFetch<null>(req, `${baseUrl}/users/${encodeURIComponent(sfid)}/preferences/${encodeURIComponent(existing.ID)}`, {
      operation,
      service: 'user_service',
      errorMessage: 'Preference delete failed',
      errorCode: 'USER_PREFERENCE_DELETE_FAILED',
      method: 'DELETE',
    });
  }

  private async resolveSfid(req: Request, operation: string): Promise<string> {
    const profile = await this.userService.getApiGatewayProfile(req);

    if (!profile.ID) {
      throw new MicroserviceError('User Salesforce ID not available', 502, 'API_GATEWAY_INVALID_RESPONSE', {
        operation,
        service: 'user_service',
      });
    }

    return profile.ID;
  }

  private async fetchPreference(req: Request, sfid: string, appName: string, name: string, operation: string): Promise<UserServicePreference | null> {
    const baseUrl = getUserServiceBaseUrl(operation, 'user_service');
    // Upstream $filter values are unquoted — quoting matches nothing. A failed filter returns
    // everything, so the find below (by AppName+Name, the uniqueness key) is the real guard.
    const filter = encodeURIComponent(`AppName eq ${appName} and Name eq ${name}`);
    const url = `${baseUrl}/users/${encodeURIComponent(sfid)}/preferences?$filter=${filter}`;

    logger.debug(req, operation, 'Fetching user preference', { name });

    const list = await gatewayFetch<UserServicePreferenceList>(req, url, {
      operation,
      service: 'user_service',
      errorMessage: 'Preference fetch failed',
      errorCode: 'USER_PREFERENCE_FETCH_FAILED',
    });

    return list?.Data?.find((p) => p.Name === name && p.AppName === appName) ?? null;
  }

  /** PATCHes only `Value`, preserving the row's AppName/Name/Type/System. */
  private async patchPreference(req: Request, sfid: string, existing: UserServicePreference, value: string, operation: string): Promise<void> {
    const baseUrl = getUserServiceBaseUrl(operation, 'user_service');
    await gatewayFetch<unknown>(req, `${baseUrl}/users/${encodeURIComponent(sfid)}/preferences/${encodeURIComponent(existing.ID)}`, {
      operation,
      service: 'user_service',
      errorMessage: 'Preference update failed',
      errorCode: 'USER_PREFERENCE_UPDATE_FAILED',
      method: 'PATCH',
      body: { AppName: existing.AppName, Name: existing.Name, Type: existing.Type, System: existing.System, Value: value },
    });
  }
}
