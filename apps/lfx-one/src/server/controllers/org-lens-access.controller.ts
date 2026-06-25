// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Cursor](https://cursor.com)

import { EMAIL_REGEX } from '@lfx-one/shared/constants';
import { OrgAccessInviteRequest, OrgAccessRole, OrgAccessRoleChangeRequest } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { MicroserviceError, ServiceValidationError } from '../errors';
import { mapAccessUpstreamError } from '../helpers/access-error.helper';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { logger } from '../services/logger.service';
import { OrgLensAccessService } from '../services/org-lens-access.service';

// Spec 025 — HTTP boundary for the Org Lens Access tab (list + role change + remove).
export class OrgLensAccessController {
  private readonly service: OrgLensAccessService;

  public constructor() {
    this.service = new OrgLensAccessService();
  }

  // GET /api/orgs/:orgUid/lens/access/users
  public async getUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'list_org_access', { org_uid: orgUid });
    try {
      assertOrgUid(orgUid, 'list_org_access');
      const result = await this.service.listAccessUsers(req, orgUid);
      logger.success(req, 'list_org_access', startTime, { org_uid: orgUid, user_count: result.users.length, can_manage: result.canManage });
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/orgs/:orgUid/lens/access/users
  public async addUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'invite_org_access_user', { org_uid: orgUid });
    try {
      assertOrgUid(orgUid, 'invite_org_access_user');
      const { email, role, name } = this.parseInviteBody(req, 'invite_org_access_user');

      const result = await this.service.inviteUser(req, orgUid, email, role, name);

      logger.success(req, 'invite_org_access_user', startTime, { org_uid: orgUid, role });
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      this.handleWriteError(req, res, next, error, 'invite_org_access_user');
    }
  }

  // PUT /api/orgs/:orgUid/lens/access/users/:email
  public async changeRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const email = req.params['email'];
    const startTime = logger.startOperation(req, 'change_org_access_role', { org_uid: orgUid });
    try {
      assertOrgUid(orgUid, 'change_org_access_role');
      this.assertEmail(email, 'change_org_access_role');
      const role = this.parseRole(req, 'change_org_access_role');

      const result = await this.service.changeRole(req, orgUid, email, role);

      logger.success(req, 'change_org_access_role', startTime, { org_uid: orgUid, role });
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      this.handleWriteError(req, res, next, error, 'change_org_access_role');
    }
  }

  // DELETE /api/orgs/:orgUid/lens/access/users/:email
  public async removeUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const email = req.params['email'];
    const startTime = logger.startOperation(req, 'remove_org_access_user', { org_uid: orgUid });
    try {
      assertOrgUid(orgUid, 'remove_org_access_user');
      this.assertEmail(email, 'remove_org_access_user');

      const result = await this.service.removeUser(req, orgUid, email);

      logger.success(req, 'remove_org_access_user', startTime, { org_uid: orgUid });
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      this.handleWriteError(req, res, next, error, 'remove_org_access_user');
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private parseRole(req: Request, operation: string): OrgAccessRole {
    const raw = (req.body ?? {}) as Partial<OrgAccessRoleChangeRequest>;
    const role = String(raw.role ?? '');
    if (role !== 'admin' && role !== 'viewer') {
      throw ServiceValidationError.forField('role', 'Role must be "admin" or "viewer"', { operation });
    }
    return role;
  }

  private parseInviteBody(req: Request, operation: string): { email: string; role: OrgAccessRole; name: string | null } {
    const raw = (req.body ?? {}) as Partial<OrgAccessInviteRequest>;
    const email = String(raw.email ?? '').trim();
    if (!email || !EMAIL_REGEX.test(email)) {
      throw ServiceValidationError.forField('email', 'A valid email address is required', { operation });
    }
    const role = String(raw.role ?? '');
    if (role !== 'admin' && role !== 'viewer') {
      throw ServiceValidationError.forField('role', 'Role must be "admin" or "viewer"', { operation });
    }
    const name = raw.name != null ? String(raw.name).trim() : '';
    if (name.length > 255) {
      throw ServiceValidationError.forField('name', 'Name must be 255 characters or fewer', { operation });
    }
    return { email, role, name: name || null };
  }

  private assertEmail(email: string | undefined, operation: string): asserts email is string {
    if (!email || !EMAIL_REGEX.test(email)) {
      throw ServiceValidationError.forField('email', 'A valid email address is required', { operation });
    }
  }

  // Maps service/upstream write failures to clean status/message envelopes.
  private handleWriteError(req: Request, res: Response, next: NextFunction, error: unknown, operation: string): void {
    if (error instanceof ServiceValidationError) {
      next(error);
      return;
    }
    // Manager-only gate (FR-011) — surface a clear 403 the UI maps to "no permission".
    // Only the LOCAL assertCanManage gate matches here: proxied upstream errors set
    // `originalMessage` (via MicroserviceError.fromMicroserviceResponse), so an upstream 403
    // (token/ACL) falls through to mapAccessUpstreamError instead of being mislabeled.
    if (error instanceof MicroserviceError && error.statusCode === 403 && !error.originalMessage) {
      logger.warning(req, operation, 'Org access write rejected: caller is not a manager', { status: 403 });
      res.setHeader('Cache-Control', 'no-store');
      res.status(403).json({ error: { code: 'FORBIDDEN', message: error.message, conflict: false } });
      return;
    }
    const mapped = mapAccessUpstreamError(error);
    logger.warning(req, operation, 'Org access write failed', { status: mapped.status, conflict: mapped.conflict });
    res.setHeader('Cache-Control', 'no-store');
    res
      .status(mapped.status)
      .json({ error: { code: mapped.conflict ? 'CONFLICT' : 'ACCESS_WRITE_FAILED', message: mapped.message, conflict: mapped.conflict } });
  }
}
