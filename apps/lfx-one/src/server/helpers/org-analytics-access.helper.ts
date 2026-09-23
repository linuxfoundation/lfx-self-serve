// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_ACCESS_UNVERIFIABLE_MESSAGE, ORG_ACCOUNT_ID_PATTERN } from '@lfx-one/shared/constants';
import type { Request } from 'express';

import { BaseApiError, MicroserviceError, ServiceValidationError } from '../errors';
import { personaDetectionService } from '../utils/persona-helper';
import { assertOrgLensRead } from './org-lens-read-access.helper';

/**
 * Read gate for org-scoped Snowflake analytics keyed by a caller-supplied account id.
 *
 * The analytics lane reads `ANALYTICS.PLATINUM_LFX_ONE.*` with the BFF's own credentials, so the
 * account id only filters rows — it never authorizes them (ADR-0038). A caller may read an
 * organization when it is one of their board-member persona organizations (the Board Member
 * dashboard's seed) or when `assertOrgLensRead` admits them (org grant, inherited grant, or
 * `b2b_org#auditor`, which is also how LF team membership resolves) — the organizations the org
 * selector offers them.
 *
 * Only the canonical 18-char SFID is accepted (`ORG_ACCOUNT_ID_PATTERN`, 400 on the `accountId`
 * field otherwise), so the id authorized here is byte-for-byte the id the handler queries.
 *
 * Failure semantics follow `assertOrgLensRead`: 403 when we checked and the caller has no access,
 * 503 when we could not check. A failed persona lookup leaves the board-member branch unverified,
 * so a 403 that follows it is reported as 503 rather than as a verified denial.
 */
export async function assertOrgAnalyticsRead(req: Request, accountId: string, operation: string): Promise<void> {
  if (!ORG_ACCOUNT_ID_PATTERN.test(accountId)) {
    throw ServiceValidationError.forField('accountId', 'Invalid organization account id format', { operation });
  }

  const { organizations, error: personaError } = await personaDetectionService.getDetections(req);
  if (organizations.some((account) => account.accountId === accountId)) {
    return;
  }

  try {
    await assertOrgLensRead(req, accountId, operation);
  } catch (error) {
    if (personaError && error instanceof BaseApiError && error.statusCode === 403) {
      throw new MicroserviceError(ORG_ACCESS_UNVERIFIABLE_MESSAGE, 503, 'PERSONA_DETECTION_UNAVAILABLE', {
        operation,
        service: 'LFX_V2_SERVICE',
      });
    }
    throw error;
  }
}

/**
 * The subset of `accountIds` that are the caller's own board-member organizations, in request order.
 *
 * The batch's one client (the org-selector enrichment in `AccountContextService`) only ever sends those
 * persona seeds, so no other id needs the grant roster or the authorizer — and asking the authorizer
 * per id would hand any caller a client-controlled fan-out of up to one upstream call per id. Ids
 * outside the persona set are dropped without any upstream call. A failed persona lookup cannot say
 * which ids are the caller's, so it fails the call closed (503).
 */
export async function filterReadableAccountIds(req: Request, accountIds: string[], operation: string): Promise<string[]> {
  const { organizations, error } = await personaDetectionService.getDetections(req);
  if (error) {
    throw new MicroserviceError(ORG_ACCESS_UNVERIFIABLE_MESSAGE, 503, 'PERSONA_DETECTION_UNAVAILABLE', { operation, service: 'LFX_V2_SERVICE' });
  }

  const own = new Set(organizations.map((account) => account.accountId));
  return accountIds.filter((accountId) => own.has(accountId) && ORG_ACCOUNT_ID_PATTERN.test(accountId));
}
