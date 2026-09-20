// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CLA_GROUP_ID_PATTERN, PERSON_KEY_PATTERN } from '@lfx-one/shared/constants';
import type { OrgClaManagerAddRequest } from '@lfx-one/shared/interfaces';
import { hasOrgClaManagerAddErrors, validateOrgClaManagerAdd } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { OrgClaService } from '../services/org-cla.service';
import { logger } from '../services/logger.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

export class OrgClasController {
  private readonly orgClaService = new OrgClaService();

  // GET /api/orgs/:orgUid/lens/cla-groups
  public async listClaGroups(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'list_org_cla_groups');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'list_org_cla_groups' });
      }

      const orgUid = req.params['orgUid'];
      assertOrgUid(orgUid, 'list_org_cla_groups');

      const result = await this.orgClaService.listClaGroups(req, orgUid);

      logger.success(req, 'list_org_cla_groups', startTime, { org_uid: orgUid, cla_group_count: result.claGroups.length });
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/orgs/:orgUid/lens/cla-groups/:signatureId/pdf-url
  public async getPdfUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_cla_pdf_url');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_org_cla_pdf_url' });
      }

      const orgUid = req.params['orgUid'];
      assertOrgUid(orgUid, 'get_org_cla_pdf_url');

      const signatureId = (req.params['signatureId'] ?? '').trim();
      if (!signatureId) {
        throw ServiceValidationError.forField('signatureId', 'signatureId path parameter is required', { operation: 'get_org_cla_pdf_url' });
      }

      const pdf = await this.orgClaService.getPdfUrl(req, orgUid, signatureId);

      // Ahead of the branch, so the 404 carries it too, as `sendBlock` in
      // org-lens-project-detail.controller.ts does. A 404 is heuristically cacheable, and this
      // one is transient — it is also the answer while a signed document is not yet available
      // upstream — so a cached copy would keep failing retries after the document exists. The
      // success body is a short-lived presigned URL, which must not be stored either.
      res.setHeader('Cache-Control', 'no-store');

      if (!pdf) {
        // A handled outcome, not an error: absent is what the service returns for a signature
        // this organization does not hold, an unsigned agreement, or a document upstream has
        // no URL for. It still closes the operation, so request duration stays balanced.
        logger.success(req, 'get_org_cla_pdf_url', startTime, { org_uid: orgUid, signature_id: signatureId, found: false });
        res.status(404).json({ message: 'Signed document not found' });
        return;
      }

      logger.success(req, 'get_org_cla_pdf_url', startTime, { org_uid: orgUid, signature_id: signatureId, found: true });
      res.json(pdf);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/orgs/:orgUid/lens/cla-groups/:signatureId/managers
  public async listManagers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'list_org_cla_managers');

    try {
      const { orgUid, signatureId } = await this.requireAgreementContext(req, 'list_org_cla_managers');

      const result = await this.orgClaService.getManagers(req, orgUid, signatureId);

      // Ahead of the branch so the 404 carries it too.
      res.setHeader('Cache-Control', 'no-store');

      if (!result) {
        logger.success(req, 'list_org_cla_managers', startTime, { org_uid: orgUid, signature_id: signatureId, found: false });
        res.status(404).json({ message: 'Agreement not found' });
        return;
      }

      logger.success(req, 'list_org_cla_managers', startTime, { org_uid: orgUid, signature_id: signatureId, manager_count: result.managers.length });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/orgs/:orgUid/lens/cla-groups/:signatureId/managers
  public async addManager(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'add_org_cla_manager');

    try {
      const { orgUid, signatureId } = await this.requireAgreementContext(req, 'add_org_cla_manager');

      const body = (req.body ?? {}) as Partial<OrgClaManagerAddRequest>;
      const validation = validateOrgClaManagerAdd(body);
      if (hasOrgClaManagerAddErrors(validation)) {
        throw ServiceValidationError.fromFieldErrors(validation as Record<string, string>, 'Validation failed', { operation: 'add_org_cla_manager' });
      }

      const manager = await this.orgClaService.addManager(req, orgUid, signatureId, {
        firstName: body.firstName!.trim(),
        lastName: body.lastName!.trim(),
        email: body.email!.trim(),
      });

      res.setHeader('Cache-Control', 'no-store');

      if (!manager) {
        logger.success(req, 'add_org_cla_manager', startTime, { org_uid: orgUid, signature_id: signatureId, found: false });
        res.status(404).json({ message: 'Agreement not found' });
        return;
      }

      logger.success(req, 'add_org_cla_manager', startTime, { org_uid: orgUid, signature_id: signatureId });
      res.status(201).json(manager);
    } catch (error) {
      next(error);
    }
  }

  // DELETE /api/orgs/:orgUid/lens/cla-groups/:signatureId/managers/:lfUsername
  public async removeManager(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'remove_org_cla_manager');

    try {
      const { orgUid, signatureId } = await this.requireAgreementContext(req, 'remove_org_cla_manager');

      const lfUsername = (req.params['lfUsername'] ?? '').trim();
      if (!PERSON_KEY_PATTERN.test(lfUsername)) {
        throw ServiceValidationError.forField('lfUsername', 'A valid lfUsername path parameter is required', { operation: 'remove_org_cla_manager' });
      }

      const removed = await this.orgClaService.removeManager(req, orgUid, signatureId, lfUsername);

      res.setHeader('Cache-Control', 'no-store');

      if (!removed) {
        logger.success(req, 'remove_org_cla_manager', startTime, { org_uid: orgUid, signature_id: signatureId, found: false });
        res.status(404).json({ message: 'Agreement not found' });
        return;
      }

      logger.success(req, 'remove_org_cla_manager', startTime, { org_uid: orgUid, signature_id: signatureId });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  private async requireAgreementContext(req: Request, operation: string): Promise<{ orgUid: string; signatureId: string }> {
    if (!(await getUsernameFromAuth(req))) {
      throw new AuthenticationError('User authentication required', { operation });
    }

    const orgUid = req.params['orgUid'];
    assertOrgUid(orgUid, operation);

    const signatureId = (req.params['signatureId'] ?? '').trim();
    if (!CLA_GROUP_ID_PATTERN.test(signatureId)) {
      throw ServiceValidationError.forField('signatureId', 'A valid signatureId path parameter is required', { operation });
    }

    return { orgUid, signatureId };
  }
}
