// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { UUID_REGEX } from '@lfx-one/shared/constants';
import { MemberServiceB2bOrgResponse, OrgCanonicalRecord, OrgItem, RoleGrantsResponse } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { MicroserviceError } from '../errors/microservice.error';
import { ServiceValidationError } from '../errors/service-validation.error';
import orgSelectorMock from '../services/fixtures/org-selector.mock.json';
import { logger } from '../services/logger.service';
import { MicroserviceProxyService } from '../services/microservice-proxy.service';
import { OrgIdentityResolver } from '../services/org-identity-resolver.service';
import { OrgRoleGrantsService } from '../services/org-role-grants.service';
import { getEffectiveUsername } from '../utils/auth-helper';
import { isMockOrgItemsEnabled } from '../utils/mock-org-items.util';

/** BFF for org-identity routes: `/me/role-grants` + polymorphic canonical-record endpoint. See contracts/bff-org-*.md. */
export class OrgIdentityController {
  private readonly orgRoleGrantsService: OrgRoleGrantsService;
  private readonly orgIdentityResolver: OrgIdentityResolver;
  private readonly microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.orgRoleGrantsService = new OrgRoleGrantsService();
    this.orgIdentityResolver = OrgIdentityResolver.getInstance();
    this.microserviceProxy = new MicroserviceProxyService();
  }

  /** `GET /api/orgs/me/role-grants` — caller's writer/auditor uid sets (contracts/bff-org-role-grants.md). */
  public async getRoleGrants(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_role_grants');

    try {
      const username = getEffectiveUsername(req);
      if (!username) {
        throw ServiceValidationError.forField('username', 'Authenticated username is required', {
          operation: 'get_org_role_grants',
          service: 'org_identity_controller',
          path: req.path,
        });
      }

      const result: RoleGrantsResponse = await this.orgRoleGrantsService.getRoleGrants(req, username);

      logger.success(req, 'get_org_role_grants', startTime, { writer_count: result.writers.length, auditor_count: result.auditors.length });

      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /** Polymorphic canonical-record endpoint backing `/uid/:uid`, `/sfid/:accountId`, and `/:id` (contracts/bff-org-canonical-record.md). */
  public async getCanonicalRecord(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_canonical_record');

    try {
      const { identifier, identifierKind } = this.extractIdentifier(req);

      if (isMockOrgItemsEnabled()) {
        const mockResponse = this.getMockCanonicalRecord(identifier, identifierKind);
        if (!mockResponse) {
          res.status(404).json({ error: 'Organization not found' });
          logger.success(req, 'get_org_canonical_record', startTime, { identifier_kind: identifierKind, uid: null, status_code: 404, mock: true });
          return;
        }
        logger.success(req, 'get_org_canonical_record', startTime, {
          identifier_kind: identifierKind,
          uid: mockResponse.uid,
          has_parent: !!mockResponse.parentUid,
          mock: true,
        });
        res.setHeader('Cache-Control', 'no-store');
        res.json(mockResponse);
        return;
      }

      // `identifier_cache_hit` is null for uid-routed requests (no resolver lookup) so the metric reflects true LRU state.
      let uid: string | null = identifier;
      let identifierCacheHit: boolean | null = null;
      if (identifierKind === 'sfid') {
        const result = await this.orgIdentityResolver.getUidBySfid(identifier, req);
        uid = result.uid;
        identifierCacheHit = result.cacheHit;
        if (!uid) {
          res.status(404).json({ error: 'Organization not found' });
          logger.success(req, 'get_org_canonical_record', startTime, {
            identifier_kind: identifierKind,
            uid: null,
            status_code: 404,
            identifier_cache_hit: identifierCacheHit,
          });
          return;
        }
      }

      const record = await this.fetchCanonicalRecord(req, uid);
      if (!record) {
        res.status(404).json({ error: 'Organization not found' });
        logger.success(req, 'get_org_canonical_record', startTime, {
          identifier_kind: identifierKind,
          uid,
          status_code: 404,
          identifier_cache_hit: identifierCacheHit,
        });
        return;
      }

      const response = this.toCanonicalRecord(record);

      logger.success(req, 'get_org_canonical_record', startTime, {
        identifier_kind: identifierKind,
        uid: response.uid,
        has_parent: !!response.parentUid,
        identifier_cache_hit: identifierCacheHit,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      // Map member-service 5xx → 502 Bad Gateway per FR-020. Resolver upstream failures bubble here too.
      if (error instanceof MicroserviceError && error.statusCode >= 500) {
        logger.warning(req, 'get_org_canonical_record', 'Upstream failure', { err: error, upstream_status: error.statusCode });
        res.status(502).json({ error: 'Upstream member-service failure' });
        return;
      }
      // 404 → 404 with deliberate no-information-leak envelope.
      if (error instanceof MicroserviceError && error.statusCode === 404) {
        res.status(404).json({ error: 'Organization not found' });
        return;
      }
      next(error);
    }
  }

  /** Parses `req.params` into `{ identifier, identifierKind }`; polymorphic `/:id` uses UUID_REGEX to dispatch (mirrors project.controller pattern). */
  private extractIdentifier(req: Request): { identifier: string; identifierKind: 'uid' | 'sfid' } {
    const { uid, accountId, id } = req.params;
    if (uid) {
      this.assertNonEmpty(uid, 'uid', 'get_org_canonical_record', req.path);
      return { identifier: uid, identifierKind: 'uid' };
    }
    if (accountId) {
      this.assertNonEmpty(accountId, 'accountId', 'get_org_canonical_record', req.path);
      return { identifier: accountId, identifierKind: 'sfid' };
    }
    if (id) {
      this.assertNonEmpty(id, 'id', 'get_org_canonical_record', req.path);
      return { identifier: id, identifierKind: UUID_REGEX.test(id) ? 'uid' : 'sfid' };
    }
    throw ServiceValidationError.forField('id', 'Identifier path parameter is required', {
      operation: 'get_org_canonical_record',
      service: 'org_identity_controller',
      path: req.path,
    });
  }

  private assertNonEmpty(value: string, field: string, operation: string, path: string): void {
    if (typeof value !== 'string' || value.trim() === '') {
      throw ServiceValidationError.forField(field, `${field} is required`, { operation, service: 'org_identity_controller', path });
    }
  }

  private async fetchCanonicalRecord(req: Request, uid: string): Promise<MemberServiceB2bOrgResponse | null> {
    try {
      return await this.microserviceProxy.proxyRequest<MemberServiceB2bOrgResponse>(req, 'LFX_V2_SERVICE', `/b2b_orgs/${encodeURIComponent(uid)}`, 'GET');
    } catch (error) {
      // 404 collapses to null so the caller emits a consistent envelope; re-throw 5xx so the catch above maps to 502.
      if (error instanceof MicroserviceError && error.statusCode === 404) return null;
      throw error;
    }
  }

  /** MOCK_ORG_ITEMS dev branch — looks up the fixture row by uid or sfid; overlays `canonicalExtras` when defined. */
  private getMockCanonicalRecord(identifier: string, identifierKind: 'uid' | 'sfid'): OrgCanonicalRecord | null {
    const items = orgSelectorMock.items as OrgItem[];
    const match = identifierKind === 'uid' ? items.find((item) => item.uid === identifier) : items.find((item) => item.accountId === identifier);
    if (!match) return null;
    type MockCanonicalExtras = Partial<Pick<OrgCanonicalRecord, 'description' | 'website' | 'industry' | 'sector' | 'numberOfEmployees' | 'parentUid'>>;
    const extrasMap = (orgSelectorMock.canonicalExtras ?? {}) as Record<string, MockCanonicalExtras>;
    const extras = extrasMap[match.uid] ?? {};
    return {
      uid: match.uid,
      accountId: match.accountId ?? null,
      name: match.name,
      description: extras.description ?? null,
      website: extras.website ?? null,
      primaryDomain: match.primaryDomain ?? null,
      logoUrl: match.logoUrl ?? null,
      industry: extras.industry ?? null,
      sector: extras.sector ?? null,
      numberOfEmployees: extras.numberOfEmployees ?? null,
      parentUid: extras.parentUid ?? null,
      isMember: match.isMember ?? false,
    };
  }

  /** Transforms member-service snake_case response to the BFF camelCase contract. */
  private toCanonicalRecord(raw: MemberServiceB2bOrgResponse): OrgCanonicalRecord {
    return {
      uid: raw.uid,
      accountId: raw.sfid ?? null,
      name: raw.name,
      description: raw.description ?? null,
      website: raw.website ?? null,
      primaryDomain: raw.primary_domain ?? null,
      logoUrl: raw.logo_url ?? null,
      industry: raw.industry ?? null,
      sector: raw.sector ?? null,
      numberOfEmployees: raw.number_of_employees ?? null,
      parentUid: raw.parent_uid ?? null,
      isMember: raw.is_member ?? false,
    };
  }
}
