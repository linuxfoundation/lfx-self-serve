// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ALLOWED_ORG_LOGO_MIME_TYPES, HTTP_HEADERS, ORG_ACCOUNT_ID_PATTERN } from '@lfx-one/shared/constants';
import {
  MemberServiceB2bOrgResponse,
  MemberServiceB2bOrgUpdateBody,
  OrgCanonicalRecord,
  OrgUpdateRequest,
  RoleGrantsResponse,
} from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { MicroserviceError } from '../errors/microservice.error';
import { ServiceValidationError } from '../errors/service-validation.error';
import { logger } from '../services/logger.service';
import { MicroserviceProxyService } from '../services/microservice-proxy.service';
import { OrgLensAddressesService } from '../services/org-lens-addresses.service';
import { OrgRoleGrantsService } from '../services/org-role-grants.service';
import { getEffectiveUsername } from '../utils/auth-helper';

/** BFF for org-identity routes: `/me/role-grants` + account-id-keyed canonical-record endpoint. See contracts/bff-org-*.md. */
export class OrgIdentityController {
  private readonly orgRoleGrantsService: OrgRoleGrantsService;
  private readonly microserviceProxy: MicroserviceProxyService;
  private readonly orgLensAddressesService: OrgLensAddressesService;

  public constructor() {
    this.orgRoleGrantsService = new OrgRoleGrantsService();
    this.microserviceProxy = new MicroserviceProxyService();
    this.orgLensAddressesService = new OrgLensAddressesService();
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

  /** Canonical-record endpoint backing `/uid/:uid` and `/:id` — both keyed by the org account id (18-char SFID, spec 002). See contracts/bff-org-canonical-record.md. */
  public async getCanonicalRecord(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_canonical_record');

    try {
      const uid = this.extractUid(req);

      const record = await this.fetchCanonicalRecord(req, uid);
      if (!record) {
        res.status(404).json({ error: 'Organization not found' });
        logger.success(req, 'get_org_canonical_record', startTime, { uid, status_code: 404 });
        return;
      }

      const response = this.toCanonicalRecord(record);

      logger.success(req, 'get_org_canonical_record', startTime, {
        uid: response.uid,
        has_parent: !!response.parentUid,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      // Map member-service 5xx/408 → 502 Bad Gateway per FR-020. Resolver upstream failures bubble here too.
      if (error instanceof MicroserviceError && (error.statusCode >= 500 || error.statusCode === 408)) {
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

  /** Spec 021 — `PUT /api/orgs/uid/:uid`. Partial-update proxy to member-service `PUT /b2b_orgs/{uid}`. Returns the full updated canonical record so the client can refresh the read-only view without an extra GET (FR-016). */
  public async updateOrg(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'update_org_canonical_record');

    try {
      const uid = req.params['uid'];
      this.assertNonEmpty(uid, 'uid', 'update_org_canonical_record', req.path);
      if (!ORG_ACCOUNT_ID_PATTERN.test(uid)) {
        throw ServiceValidationError.forField('uid', 'Invalid organization identifier', {
          operation: 'update_org_canonical_record',
          service: 'org_identity_controller',
          path: req.path,
        });
      }

      const update = this.toMemberServiceUpdate(req.body as OrgUpdateRequest | undefined);

      const raw = await this.microserviceProxy.proxyRequest<MemberServiceB2bOrgResponse>(
        req,
        'LFX_V2_SERVICE',
        `/b2b_orgs/${encodeURIComponent(uid)}`,
        'PUT',
        undefined,
        update
      );

      const response = this.toCanonicalRecord(raw);

      logger.success(req, 'update_org_canonical_record', startTime, { uid, field_count: Object.keys(update).length });
      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 403) {
        logger.warning(req, 'update_org_canonical_record', 'Upstream rejected with 403', { err: error });
        res.status(403).json({ error: 'You no longer have permission to edit this organization.' });
        return;
      }
      if (error instanceof MicroserviceError && error.statusCode === 404) {
        res.status(404).json({ error: 'Organization not found' });
        return;
      }
      if (error instanceof MicroserviceError && (error.statusCode >= 500 || error.statusCode === 408)) {
        logger.warning(req, 'update_org_canonical_record', 'Upstream failure', { err: error, upstream_status: error.statusCode });
        res.status(502).json({ error: 'Unable to save changes. Please try again.' });
        return;
      }
      next(error);
    }
  }

  /**
   * LFXV2-3288 — `POST /api/orgs/uid/:uid/logo`. BFF proxy leg to member-service's
   * `POST /b2b_orgs/{uid}/logo` (LFXV2-2016): forwards the browser's raw upload using the caller's
   * own access token (never M2M), reusing the already-buffered request body (no streaming), and
   * propagating member-service's response as-is — the settled transport contract from the
   * object-storage skill (PR #67). Member-service owns S3 write + Salesforce `Logo_URL__c` patch;
   * this BFF does not touch object storage directly.
   */
  public async uploadLogo(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'upload_org_logo', {
      content_type: req.headers['content-type'],
      content_length: req.headers['content-length'],
    });

    try {
      const uid = req.params['uid'];
      this.assertNonEmpty(uid, 'uid', 'upload_org_logo', req.path);
      if (!ORG_ACCOUNT_ID_PATTERN.test(uid)) {
        throw ServiceValidationError.forField('uid', 'Invalid organization identifier', {
          operation: 'upload_org_logo',
          service: 'org_identity_controller',
          path: req.path,
        });
      }

      const rawContentType = req.headers['content-type'];
      const contentType = (Array.isArray(rawContentType) ? rawContentType[0] : rawContentType || '').split(';')[0].trim();
      if (!(ALLOWED_ORG_LOGO_MIME_TYPES as readonly string[]).includes(contentType)) {
        throw ServiceValidationError.forField('content-type', `Unsupported logo content type: ${contentType || 'unknown'}`, {
          operation: 'upload_org_logo',
          service: 'org_identity_controller',
          path: req.path,
        });
      }

      const buffer: unknown = req.body;
      if (Array.isArray(buffer) || !Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw ServiceValidationError.forField('body', 'Request body must contain logo image data', {
          operation: 'upload_org_logo',
          service: 'org_identity_controller',
          path: req.path,
        });
      }

      // member-service's upload-b2b-org-logo requires If-Match (unlike the sibling org-update
      // endpoint) so it can detect a concurrent write before it repoints Logo_URL__c — fetch a
      // fresh ETag immediately beforehand so this request always carries a current one.
      const { headers: orgHeaders } = await this.microserviceProxy.proxyRequestWithResponse<MemberServiceB2bOrgResponse>(
        req,
        'LFX_V2_SERVICE',
        `/b2b_orgs/${encodeURIComponent(uid)}`,
        'GET'
      );
      const ifMatch = orgHeaders[HTTP_HEADERS.ETAG.toLowerCase()];

      const raw = await this.microserviceProxy.proxyRequest<MemberServiceB2bOrgResponse>(
        req,
        'LFX_V2_SERVICE',
        `/b2b_orgs/${encodeURIComponent(uid)}/logo`,
        'POST',
        undefined,
        buffer,
        { [HTTP_HEADERS.CONTENT_TYPE]: contentType, [HTTP_HEADERS.IF_MATCH]: ifMatch }
      );

      const response = this.toCanonicalRecord(raw);

      logger.success(req, 'upload_org_logo', startTime, { uid, logo_url: response.logoUrl });
      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      if (error instanceof ServiceValidationError) {
        next(error);
        return;
      }
      if (error instanceof MicroserviceError && error.statusCode === 403) {
        logger.warning(req, 'upload_org_logo', 'Upstream rejected with 403', { err: error });
        res.status(403).json({ error: 'You no longer have permission to edit this organization.' });
        return;
      }
      if (error instanceof MicroserviceError && error.statusCode === 404) {
        res.status(404).json({ error: 'Organization not found' });
        return;
      }
      if (error instanceof MicroserviceError && error.statusCode === 412) {
        logger.warning(req, 'upload_org_logo', 'Upstream rejected with 412 (org changed since the pre-upload fetch)', { err: error });
        res.status(409).json({ error: 'This organization was updated elsewhere. Refresh the page and try again.' });
        return;
      }
      if (error instanceof MicroserviceError && (error.statusCode >= 500 || error.statusCode === 408)) {
        logger.warning(req, 'upload_org_logo', 'Upstream failure', { err: error, upstream_status: error.statusCode });
        res.status(502).json({ error: 'Unable to upload logo. Please try again.' });
        return;
      }
      next(error);
    }
  }

  /**
   * Spec 023/002 — `GET /api/orgs/uid/:uid/addresses`. The route uid is the org account id (18-char SFID); queries the Snowflake platinum table directly, maps SHIPPING→primaryAddress and BILLING→billingAddress. Returns 200 with nulls for lookup/data failures; validation errors still propagate.
   *
   * Access model: auth-gated, NOT org-membership-gated. Any authenticated LFX user can fetch any org's addresses by uid — deliberately matching the canonical-record route (`GET /api/orgs/uid/:uid`), since org profile/address data is treated as non-secret among authenticated LFX users. Do not add an FGA grant check here without a product decision.
   */
  public async getOrgAddresses(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_addresses');
    const emptyResponse = { primaryAddress: null, billingAddress: null };

    try {
      const uid = req.params['uid'];
      this.assertNonEmpty(uid, 'uid', 'get_org_addresses', req.path);
      if (!ORG_ACCOUNT_ID_PATTERN.test(uid)) {
        throw ServiceValidationError.forField('uid', 'Invalid organization identifier', {
          operation: 'get_org_addresses',
          service: 'org_identity_controller',
          path: req.path,
        });
      }
    } catch (error) {
      next(error);
      return;
    }

    // Spec 002: the route uid IS the org account id (SFID); query Snowflake directly (no resolver).
    const uid = req.params['uid']!;
    const sfid: string = uid;

    try {
      const result = await this.orgLensAddressesService.getAddresses(sfid);

      logger.success(req, 'get_org_addresses', startTime, {
        uid,
        sfid,
        has_primary: !!result.primaryAddress,
        has_billing: !!result.billingAddress,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      if (error instanceof ServiceValidationError) {
        next(error);
        return;
      }
      logger.warning(req, 'get_org_addresses', 'Address warehouse lookup failed; returning empty', { err: error, uid, sfid });
      res.setHeader('Cache-Control', 'no-store');
      res.json(emptyResponse);
    }
  }

  /** Extracts and validates the org account id (SFID) from `/uid/:uid` or the catch-all `/:id` route (spec 002). */
  private extractUid(req: Request): string {
    const uid = req.params['uid'] ?? req.params['id'];
    this.assertNonEmpty(uid, 'uid', 'get_org_canonical_record', req.path);
    if (!ORG_ACCOUNT_ID_PATTERN.test(uid)) {
      throw ServiceValidationError.forField('uid', 'Invalid organization identifier', {
        operation: 'get_org_canonical_record',
        service: 'org_identity_controller',
        path: req.path,
      });
    }
    return uid;
  }

  private assertNonEmpty(value: string | undefined, field: string, operation: string, path: string): asserts value is string {
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

  /** Spec 021 — Whitelist + camelCase → snake_case transform for the PUT body; `name`/`logoUrl` stripped (FR-011/012); `undefined` omitted to preserve upstream "no change" semantics. */
  private toMemberServiceUpdate(body: OrgUpdateRequest | undefined): MemberServiceB2bOrgUpdateBody {
    const payload: MemberServiceB2bOrgUpdateBody = {};
    if (!body || typeof body !== 'object') return payload;

    if (body.description !== undefined) payload.description = body.description;
    if (body.website !== undefined) payload.website = body.website;
    if (body.industry !== undefined) payload.industry = body.industry;
    if (body.sector !== undefined) payload.sector = body.sector;
    if (body.crunchBaseUrl !== undefined) payload.crunch_base_url = body.crunchBaseUrl;
    if (body.numberOfEmployees !== undefined) payload.number_of_employees = body.numberOfEmployees;

    return payload;
  }

  /** Transforms member-service snake_case response to the BFF camelCase contract. */
  private toCanonicalRecord(raw: MemberServiceB2bOrgResponse): OrgCanonicalRecord {
    // Spec 002: member-service v0.7.0 makes the canonical b2b_org uid the 18-char SFID, so the
    // account id IS the uid (no resolver). Prefer an explicit sfid if upstream ever serializes one.
    const accountId = raw.sfid ?? raw.uid;
    return {
      // Spec 002: uid and accountId are the same canonical 18-char SFID. Anchor both to `accountId`
      // so they can never diverge if member-service later serializes `sfid` separately.
      uid: accountId,
      accountId,
      name: raw.name,
      description: raw.description ?? null,
      website: raw.website ?? null,
      primaryDomain: raw.primary_domain ?? null,
      logoUrl: raw.logo_url ?? null,
      industry: raw.industry ?? null,
      sector: raw.sector ?? null,
      numberOfEmployees: raw.number_of_employees ?? null,
      crunchBaseUrl: raw.crunch_base_url ?? null,
      updatedAt: raw.updated_at ?? null,
      parentUid: raw.parent_uid ?? null,
      isMember: raw.is_member ?? false,
    };
  }
}
