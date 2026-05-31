// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_ID_PATTERN } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { logger } from '../services/logger.service';
import { OrgLensDocumentsService } from '../services/org-lens-documents.service';
import { OrgSfidResolver } from '../services/org-sfid-resolver.service';

export class OrgLensDocumentsController {
  private readonly service: OrgLensDocumentsService;
  private readonly orgSfidResolver: OrgSfidResolver;

  public constructor() {
    this.service = new OrgLensDocumentsService();
    this.orgSfidResolver = new OrgSfidResolver();
  }

  /** GET /api/orgs/:orgUid/lens/memberships/:foundationId/documents */
  public async getMembershipDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const foundationId = req.params['foundationId'];
    const startTime = logger.startOperation(req, 'get_membership_documents', {
      org_uid: orgUid,
      foundation_id: foundationId,
    });

    try {
      assertOrgUid(orgUid, 'get_membership_documents');
      this.assertFoundationId(foundationId, 'get_membership_documents');

      const sfid = (await this.orgSfidResolver.resolveSfid(req, orgUid)) ?? '';
      const { response, certificateDegraded } = await this.service.getMembershipDocuments(req, sfid, foundationId);

      // Spec 019 SC-015: structured observability field distinguishing legitimate
      // non-TLF orgs ('absent') from cert-table outages ('degraded') without
      // needing to grep warning logs.
      let certificateState: 'present' | 'absent' | 'degraded';
      if (response.certificateTemplate) {
        certificateState = 'present';
      } else if (certificateDegraded) {
        certificateState = 'degraded';
      } else {
        certificateState = 'absent';
      }

      logger.success(req, 'get_membership_documents', startTime, {
        org_uid: orgUid,
        foundation_id: foundationId,
        agreement_count: response.agreements.length,
        certificate_state: certificateState,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  private assertFoundationId(foundationId: string | undefined, operation: string): asserts foundationId is string {
    if (!foundationId || typeof foundationId !== 'string') {
      throw ServiceValidationError.forField('foundationId', 'foundationId path parameter is required', { operation });
    }
    if (!FOUNDATION_ID_PATTERN.test(foundationId)) {
      throw ServiceValidationError.forField('foundationId', 'Invalid foundationId format', { operation });
    }
  }
}
