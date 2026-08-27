// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { REWARD_SUBJECT_LOOKUP_PAGE_SIZE, SALESFORCE_ID_PATTERN } from '@lfx-one/shared/constants';
import type { RewardUserLookupPage, RewardUserLookupRow, RewardsSubject } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { REWARDS_SERVICE_NAME } from '../constants';
import { AuthenticationError, MicroserviceError } from '../errors';
import { getUserServiceBaseUrl } from '../helpers/api-gateway.helper';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import { getEffectiveUsername, isImpersonating, usernameMatches } from './auth-helper';

export async function resolveRewardsSubject(req: Request): Promise<RewardsSubject> {
  if (!isImpersonating(req)) {
    return { mode: 'self', readOnly: false };
  }

  const username = getEffectiveUsername(req)?.trim();
  if (!username) {
    throw new AuthenticationError('Impersonation target identity is unavailable', {
      operation: 'resolve_rewards_subject',
      service: REWARDS_SERVICE_NAME,
    });
  }

  const baseUrl = getUserServiceBaseUrl('resolve_rewards_subject', REWARDS_SERVICE_NAME);
  const query = new URLSearchParams({
    username,
    pageSize: REWARD_SUBJECT_LOOKUP_PAGE_SIZE.toString(),
    offset: '0',
  });
  const response = await gatewayFetch<RewardUserLookupPage>(req, `${baseUrl}/users?${query}`, {
    operation: 'resolve_rewards_subject',
    service: REWARDS_SERVICE_NAME,
    errorMessage: 'Rewards target lookup failed',
    errorCode: 'REWARDS_SUBJECT_RESOLUTION_FAILED',
    redactResponseBody: true,
  });

  const target = selectExactTarget(response, username);
  return {
    mode: 'impersonated',
    username,
    salesforceId: target.ID!.trim(),
    readOnly: true,
  };
}

function selectExactTarget(response: RewardUserLookupPage | null, username: string): RewardUserLookupRow {
  const rows = response?.Data;
  const totalSize = response?.Metadata?.TotalSize;
  const hasOneResult = Array.isArray(rows) && rows.length === 1 && totalSize === 1;
  const target = hasOneResult ? rows[0] : undefined;
  const returnedUsername = target?.Username?.trim();
  const salesforceId = target?.ID?.trim();

  if (!target || !returnedUsername || !salesforceId || !SALESFORCE_ID_PATTERN.test(salesforceId) || !usernameMatches(username, returnedUsername)) {
    throw new MicroserviceError('Rewards target could not be resolved safely', 502, 'REWARDS_SUBJECT_RESOLUTION_FAILED', {
      operation: 'resolve_rewards_subject',
      service: REWARDS_SERVICE_NAME,
    });
  }

  return target;
}
