// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_ID_PATTERN, SALESFORCE_ACCOUNT_ID_PATTERN } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { OrgLensDocumentsService } from '../services/org-lens-documents.service';

export class OrgLensDocumentsController {
  private readonly service: OrgLensDocumentsService;

  public constructor() {
    this.service = new OrgLensDocumentsService();
  }

  /** GET /api/orgs/:accountId/lens/memberships/:foundationId/documents */
  public async getMembershipDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const foundationId = req.params['foundationId'];
    const startTime = logger.startOperation(req, 'get_membership_documents', {
      account_id: accountId,
      foundation_id: foundationId,
    });

    try {
      this.assertAccountId(accountId, 'get_membership_documents');
      this.assertFoundationId(foundationId, 'get_membership_documents');

      const { response, certificateDegraded } = await this.service.getMembershipDocuments(req, accountId, foundationId);

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
        account_id: accountId,
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

  private assertAccountId(accountId: string | undefined, operation: string): asserts accountId is string {
    if (!accountId || typeof accountId !== 'string') {
      throw ServiceValidationError.forField('accountId', 'accountId path parameter is required', { operation });
    }
    if (!SALESFORCE_ACCOUNT_ID_PATTERN.test(accountId)) {
      throw ServiceValidationError.forField('accountId', 'Invalid Salesforce accountId format', { operation });
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
