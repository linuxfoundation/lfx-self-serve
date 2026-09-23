// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_ACCESS_UNVERIFIABLE_MESSAGE, ORG_ACCOUNT_ID_PATTERN } from '@lfx-one/shared/constants';
import type { Request } from 'express';

import { MicroserviceError, ServiceValidationError } from '../errors';
import { AccessCheckService } from '../services/access-check.service';
import { assertOrgLensRead } from './org-lens-read-access.helper';

const accessCheck = new AccessCheckService();

/**
 * Read gate for org-scoped Snowflake analytics keyed by a caller-supplied account id.
 *
 * The analytics lane reads `ANALYTICS.PLATINUM_LFX_ONE.*` with the BFF's own credentials, so the
 * account id only filters rows — it never authorizes them (ADR-0038). The caller must hold read
 * permission on that organization: `assertOrgLensRead`, the same gate as every Org Lens read (org
 * grant, inherited grant, or `b2b_org#auditor`, which covers key-contact promotion and LF team
 * membership). Personas never grant access here — they shape presentation only.
 *
 * Only the canonical 18-char SFID is accepted (`ORG_ACCOUNT_ID_PATTERN`, 400 on the `accountId`
 * field otherwise), so the id authorized here is byte-for-byte the id the handler queries.
 * Failure semantics are `assertOrgLensRead`'s: 403 when the caller has no access, 503 when it
 * could not be verified.
 */
export async function assertOrgAnalyticsRead(req: Request, accountId: string, operation: string): Promise<void> {
  if (!ORG_ACCOUNT_ID_PATTERN.test(accountId)) {
    throw ServiceValidationError.forField('accountId', 'Invalid organization account id format', { operation });
  }

  await assertOrgLensRead(req, accountId, operation);
}

/**
 * The subset of `accountIds` the caller holds `b2b_org#auditor` on, in request order.
 *
 * One batched authorizer check covers the whole list, so a caller cannot turn the batch into one
 * upstream round-trip per id. Non-canonical ids are dropped before the check. An authorizer
 * failure fails the whole call closed (503) rather than reading as "no access".
 */
export async function filterReadableAccountIds(req: Request, accountIds: string[], operation: string): Promise<string[]> {
  const canonical = accountIds.filter((accountId) => ORG_ACCOUNT_ID_PATTERN.test(accountId));
  if (canonical.length === 0) {
    return [];
  }

  let granted: Map<string, boolean>;
  try {
    granted = await accessCheck.checkAccessStrict(
      req,
      canonical.map((id) => ({ resource: 'b2b_org', id, access: 'auditor' }))
    );
  } catch (error) {
    throw new MicroserviceError(ORG_ACCESS_UNVERIFIABLE_MESSAGE, 503, 'ROLE_GRANTS_UNAVAILABLE', {
      operation,
      service: 'LFX_V2_SERVICE',
      path: '/access-check',
      originalError: error instanceof Error ? error : undefined,
    });
  }

  return canonical.filter((accountId) => granted.get(`${accountId}#auditor`) === true);
}
