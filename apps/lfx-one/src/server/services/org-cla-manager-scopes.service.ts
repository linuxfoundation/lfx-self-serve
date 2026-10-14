// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ORG_ACCOUNT_ID_PATTERN,
  ORG_CLA_MANAGER_ROLE,
  ORG_CLA_MANAGER_SCOPE_TYPE,
  ORG_CLA_MANAGER_SCOPES_NAMESPACE,
  ORG_CLA_MANAGER_SCOPES_TTL_SECONDS,
} from '@lfx-one/shared/constants';
import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { getUserServiceBaseUrl } from '../helpers/api-gateway.helper';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import type { UserServiceMePermissions, UserServiceScopePermission } from '../types/cla.types';
import { getEffectiveUsername, isImpersonating } from '../utils/auth-helper';
import { logger } from './logger.service';
import { buildUserCacheKey, valkeyService } from './valkey.service';

const SERVICE = 'org_cla_manager_scopes';
const OPERATION = 'get_cla_manager_scopes';

/** Why a `cla-manager` scope named a company the lens cannot open. Logged as counts, never as values. */
export type ClaManagerScopeRejection = 'malformed_scope' | 'not_account_id';

export interface ClaManagerCompanies {
  companySfids: Set<string>;
  rejected: Record<ClaManagerScopeRejection, number>;
}

/**
 * Whether a company id from a `cla-manager` scope can address the lens. The lens routes key on the
 * 18-character `001…` account id (`assertOrgUid`), so anything else — a 15-character form, or an
 * Org Service `lf…` id from before the M3 import — cannot be opened and is dropped here rather than
 * listed as an entry that then fails. The one place to change if those companies get an entry.
 */
export function isLensAddressableCompanyId(companyId: string): boolean {
  return ORG_ACCOUNT_ID_PATTERN.test(companyId);
}

/**
 * The company halves of a `project|organization` scope's ids, `null` for an id that is not a
 * pair. user-service returns one scope per role whose `ID` lists every grant as a
 * `projectSfid|companySfid` string; a bare two-element `[projectSfid, companySfid]` is read as one pair.
 */
function companyIdsOf(scope: UserServiceScopePermission): (string | null)[] {
  const ids = Array.isArray(scope.ID) ? scope.ID.filter((id): id is string => typeof id === 'string') : [];
  if (!ids.some((id) => id.includes('|'))) return [ids.length === 2 ? ids[1].trim() : null];
  return ids.map((id) => {
    const parts = id.split('|');
    return parts.length === 2 && parts[1].trim() ? parts[1].trim() : null;
  });
}

/**
 * The companies the caller manages CLAs for, from their own `cla-manager` scopes.
 *
 * Only `Role === 'cla-manager'` on a `project|organization` scope counts. The request already asks
 * for that role, but the role is re-checked on every scope: a signatory or designee scope must never
 * qualify, even if the filter is ignored upstream.
 */
export function claManagerCompanies(payload: UserServiceMePermissions | null | undefined): ClaManagerCompanies {
  const companySfids = new Set<string>();
  const rejected: Record<ClaManagerScopeRejection, number> = { malformed_scope: 0, not_account_id: 0 };

  for (const permission of payload?.Permissions ?? []) {
    for (const scope of permission?.Scopes ?? []) {
      if (scope?.Role !== ORG_CLA_MANAGER_ROLE || scope.Type !== ORG_CLA_MANAGER_SCOPE_TYPE) continue;
      const companyIds = companyIdsOf(scope);
      for (const companyId of companyIds) {
        if (!companyId) {
          rejected.malformed_scope += 1;
        } else if (!isLensAddressableCompanyId(companyId)) {
          rejected.not_account_id += 1;
        } else {
          companySfids.add(companyId);
        }
      }
    }
  }

  return { companySfids, rejected };
}

function isCachedSfidList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((id) => typeof id === 'string' && isLensAddressableCompanyId(id));
}

/**
 * The caller's CLA-manager companies, read from user-service `GET /v1/me/permissions` with the
 * caller's own token — the same ACS hop the CLA pages already make for per-action checks. While
 * impersonating, the target's token is forwarded so the answer is the target's, as in
 * `OrgClaPermissionsService`.
 *
 * Every lens consumer of the CLA-manager qualification — the CLA route gate, the selector, the
 * address resolver — reads it through `getCompanySfids`, so a condition on the whole entry (a
 * server-side flag, a membership filter) belongs there.
 *
 * Throws when user-service cannot answer: a failed lookup is not "manages nothing", and must reach
 * callers as an outage. Memoized per request; non-empty answers are cached per user for
 * `ORG_CLA_MANAGER_SCOPES_TTL_SECONDS`, empty and failed ones never.
 */
export class OrgClaManagerScopesService {
  private static readonly byRequest = new WeakMap<Request, Promise<ReadonlySet<string>>>();

  public getCompanySfids(req: Request): Promise<ReadonlySet<string>> {
    let pending = OrgClaManagerScopesService.byRequest.get(req);
    if (!pending) {
      pending = this.resolve(req);
      OrgClaManagerScopesService.byRequest.set(req, pending);
    }
    return pending;
  }

  private async resolve(req: Request): Promise<ReadonlySet<string>> {
    const username = getEffectiveUsername(req);
    if (!username) {
      return new Set();
    }

    const sfids = await valkeyService.withCache<string[]>(
      buildUserCacheKey(ORG_CLA_MANAGER_SCOPES_NAMESPACE, username),
      ORG_CLA_MANAGER_SCOPES_TTL_SECONDS,
      () => this.fetch(req),
      isCachedSfidList,
      (value) => value.length > 0
    );
    return new Set(sfids);
  }

  private async fetch(req: Request): Promise<string[]> {
    // Without the target's token, `gatewayFetch` would fall back to the gateway token and the answer
    // (cached under the target's username) would be someone else's scopes.
    if (isImpersonating(req) && !req.bearerToken) {
      throw new MicroserviceError('Failed to read CLA manager scopes', 503, 'CLA_MANAGER_SCOPES_LOOKUP_FAILED', {
        operation: OPERATION,
        service: SERVICE,
        path: '/me/permissions',
      });
    }
    const url = `${getUserServiceBaseUrl(OPERATION, SERVICE)}/me/permissions?role=${encodeURIComponent(ORG_CLA_MANAGER_ROLE)}`;
    const payload = await gatewayFetch<UserServiceMePermissions>(req, url, {
      operation: OPERATION,
      service: SERVICE,
      errorMessage: 'Failed to read CLA manager scopes',
      errorCode: 'CLA_MANAGER_SCOPES_LOOKUP_FAILED',
      redactResponseBody: true,
      bearerToken: isImpersonating(req) ? req.bearerToken : undefined,
    });

    const { companySfids, rejected } = claManagerCompanies(payload);
    if (rejected.malformed_scope > 0 || rejected.not_account_id > 0) {
      logger.warning(req, OPERATION, 'Dropped CLA manager scopes the lens cannot address', {
        malformed_scope: rejected.malformed_scope,
        not_account_id: rejected.not_account_id,
      });
    }
    logger.debug(req, OPERATION, 'Resolved CLA manager companies', { company_count: companySfids.size });
    return [...companySfids];
  }
}
