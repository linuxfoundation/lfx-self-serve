// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_CLA_ONLY_ORGS_MAX } from '@lfx-one/shared/constants';
import type { OrgResolveResponse, RoleGrantsResponse } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { claServiceBaseUrl } from '../helpers/cla-service-url.helper';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import type { EasyClaCompany } from '../types/cla.types';
import { isImpersonating } from '../utils/auth-helper';
import { logger } from './logger.service';
import { OrgClaAdminService } from './org-cla-admin.service';
import { OrgClaManagerScopesService } from './org-cla-manager-scopes.service';

const SERVICE = 'org_cla_only_orgs';
const OPERATION = 'get_cla_only_org';

/** An organization the caller reaches only as a CLA Manager: Org Lens grants nothing, so it opens on the EasyCLA tab alone. */
export interface ClaOnlyOrg {
  uid: string;
  name: string;
}

export interface ClaOnlyOrgList {
  orgs: ClaOnlyOrg[];
  /** True when the scopes or at least one company lookup failed, so `orgs` is a lower bound. */
  failed: boolean;
}

/**
 * Whether the selector and role grants list CLA-only organizations for this caller: only when Org
 * Lens resolved no organization at all and the caller is not staff. A caller with any grant is
 * answered by Org Lens alone and never costs the user-service call; a CLA Manager of a further
 * company is not listed for them, though a deep link to it still opens its EasyCLA tab.
 *
 * `rosterAnswered` is false when the roster never loaded or the staff check failed. Either leaves
 * "no grant, not staff" unproven, so the caller keeps the normal outage handling instead of being
 * classified CLA-only.
 */
export function claOnlyEntryApplies(isStaff: boolean, grantedOrgCount: number, rosterAnswered: boolean): boolean {
  return rosterAnswered && !isStaff && grantedOrgCount === 0;
}

/**
 * Lists and resolves CLA-only organizations. Which companies are listed comes from
 * `OrgClaManagerScopesService` — the caller's own `cla-manager` scopes, since `cla_admin` can be
 * checked but not listed; an address also qualifies through `cla_admin`. The identity shown for
 * each comes from EasyCLA `GET /v4/company/external/{sfid}` with the caller's token (the target's
 * while impersonating). Query-service is not asked: its per-row read filter is the Org Lens grant
 * these callers do not hold.
 */
export class OrgClaOnlyOrgsService {
  private readonly scopes: OrgClaManagerScopesService;
  private readonly claAdmins: OrgClaAdminService;

  public constructor(scopes?: OrgClaManagerScopesService, claAdmins?: OrgClaAdminService) {
    this.scopes = scopes ?? new OrgClaManagerScopesService();
    this.claAdmins = claAdmins ?? new OrgClaAdminService();
  }

  /** The caller's CLA-manager company SFIDs, sorted. Throws when user-service cannot answer. */
  public async getOrgUids(req: Request): Promise<string[]> {
    return [...(await this.scopes.getCompanySfids(req))].sort();
  }

  /**
   * The caller's CLA-only organizations, added outside the cached grant computation so the grant
   * cache never holds an ACS answer. Asked only when Org Lens granted nothing; an unreadable scope
   * list is logged and answered as none with `claManagerLookup: 'failed'`, leaving the grant arrays —
   * the authoritative part — intact, so the client shows an outage rather than "no organizations".
   */
  public async getRoleGrantClaManagerOrgs(req: Request, grants: RoleGrantsResponse): Promise<Pick<RoleGrantsResponse, 'claManagerOrgs' | 'claManagerLookup'>> {
    const grantedOrgCount = grants.writers.length + grants.auditors.length + grants.cascadingWriters.length + grants.cascadingAuditors.length;
    // A `partial` roster is a lower bound: zero grants there does not prove the caller holds none.
    const rosterAnswered = (grants.lookupOutcome ?? 'ok') === 'ok' && grants.staffCheck !== 'failed';
    if (!claOnlyEntryApplies(grants.isStaff, grantedOrgCount, rosterAnswered)) return { claManagerOrgs: [], claManagerLookup: 'ok' };
    try {
      return { claManagerOrgs: await this.getOrgUids(req), claManagerLookup: 'ok' };
    } catch (error) {
      logger.warning(req, 'get_org_role_grants', 'CLA manager scopes lookup failed; reporting the CLA-only lookup as failed', {
        err: error instanceof Error ? error.message : String(error),
      });
      return { claManagerOrgs: [], claManagerLookup: 'failed' };
    }
  }

  /**
   * The CLA-only organizations to list, each confirmed by EasyCLA. Fails soft per row: a failed
   * lookup drops that row and reports `failed`, so one outage does not hide the rest. At most
   * `ORG_CLA_ONLY_ORGS_MAX` lookups are made.
   */
  public async listOrgs(req: Request): Promise<ClaOnlyOrgList> {
    let uids: string[];
    try {
      uids = await this.getOrgUids(req);
    } catch (error) {
      logger.warning(req, 'list_cla_only_orgs', 'CLA manager scopes lookup failed; listing no CLA-only organizations', {
        err: error instanceof Error ? error.message : String(error),
      });
      return { orgs: [], failed: true };
    }

    if (uids.length > ORG_CLA_ONLY_ORGS_MAX) {
      logger.warning(req, 'list_cla_only_orgs', 'CLA-only organizations over the listing cap; listing the first only', {
        company_count: uids.length,
        cap: ORG_CLA_ONLY_ORGS_MAX,
      });
      uids = uids.slice(0, ORG_CLA_ONLY_ORGS_MAX);
    }

    const settled = await Promise.allSettled(uids.map((uid) => this.lookupCompany(req, uid)));
    const orgs: ClaOnlyOrg[] = [];
    let failed = false;
    for (const result of settled) {
      if (result.status === 'rejected') {
        failed = true;
      } else if (result.value) {
        orgs.push(result.value);
      }
    }
    return { orgs, failed };
  }

  /**
   * One CLA-only organization for an address, or null. The caller qualifies with `cla_admin` on that
   * organization or a `cla-manager` scope on it (#3793); a failed `cla_admin` check is "not held",
   * so the scope decides as before. Null when neither names it, when EasyCLA does not know it, and
   * when an upstream the answer depends on cannot answer: an unverifiable address reads as not found,
   * with the outage logged, rather than opening a page whose every call would then fail.
   */
  public async resolveOrg(req: Request, uid: string): Promise<OrgResolveResponse | null> {
    try {
      const [claAdmin, managed] = await Promise.all([
        this.claAdmins.holds(req, uid),
        this.scopes.getCompanySfids(req).then(
          (uids) => ({ held: uids.has(uid) }),
          (failed: unknown) => ({ failed })
        ),
      ]);
      if (!claAdmin) {
        if ('failed' in managed) throw managed.failed;
        if (!managed.held) return null;
      }
      const org = await this.lookupCompany(req, uid);
      return org ? { uid: org.uid, slug: null, name: org.name, claOnly: true } : null;
    } catch (error) {
      logger.warning(req, 'resolve_cla_only_org', 'Could not verify CLA-only organization; answering not found', {
        org_uid: uid,
        err: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** EasyCLA's record for the company, or null when it has none or it names another company. Throws on any other failure. */
  private async lookupCompany(req: Request, uid: string): Promise<ClaOnlyOrg | null> {
    let company: EasyClaCompany | null;
    try {
      company = await gatewayFetch<EasyClaCompany>(req, `${claServiceBaseUrl(SERVICE)}/v4/company/external/${encodeURIComponent(uid)}`, {
        operation: OPERATION,
        service: SERVICE,
        errorMessage: 'Failed to resolve the organization in EasyCLA',
        errorCode: 'UPSTREAM_ERROR',
        redactResponseBody: true,
        bearerToken: isImpersonating(req) ? req.bearerToken : undefined,
      });
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 404) {
        logger.warning(req, OPERATION, 'CLA-only organization unknown to EasyCLA; omitting it', { org_uid: uid, reason: 'company_not_found' });
        return null;
      }
      throw error;
    }

    if (company && !company.companyExternalID?.trim()) {
      throw new MicroserviceError(
        'Failed to resolve the organization in EasyCLA: upstream company is missing its external id',
        502,
        'UPSTREAM_INVALID_RESPONSE',
        {
          operation: OPERATION,
          service: SERVICE,
        }
      );
    }
    if (company?.companyExternalID?.trim() !== uid) {
      logger.warning(req, OPERATION, 'EasyCLA returned a different company; omitting it', { org_uid: uid, reason: 'company_mismatch' });
      return null;
    }
    return { uid, name: company.companyName?.trim() || uid };
  }
}
