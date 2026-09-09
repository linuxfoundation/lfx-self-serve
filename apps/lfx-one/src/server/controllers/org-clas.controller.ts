// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
      if (!pdf) {
        // A handled outcome, not an error: absent is what the service returns for a signature
        // this organization does not hold, an unsigned agreement, or a document upstream has
        // no URL for. It still closes the operation, so request duration stays balanced.
        logger.success(req, 'get_org_cla_pdf_url', startTime, { org_uid: orgUid, signature_id: signatureId, found: false });
        res.status(404).json({ message: 'Signed document not found' });
        return;
      }

      logger.success(req, 'get_org_cla_pdf_url', startTime, { org_uid: orgUid, signature_id: signatureId, found: true });
      res.setHeader('Cache-Control', 'no-store');
      res.json(pdf);
    } catch (error) {
      next(error);
    }
  }
}
