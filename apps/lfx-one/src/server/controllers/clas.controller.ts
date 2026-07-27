// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Read-only "My CLAs" controller (Milestone 1, Me lens).
// The user identity is derived strictly from the session — request input never
// selects whose CLAs are read (research R3, the SS server is the authz boundary).

import { NextFunction, Request, Response } from 'express';

import { AuthenticationError } from '../errors';
import { ClaService } from '../services/cla.service';
import { logger } from '../services/logger.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

export class ClasController {
  private readonly claService = new ClaService();

  // GET /api/me/clas
  public async getMyClas(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_my_clas');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_my_clas' });
      }

      const result = await this.claService.getMyClas(req);

      logger.success(req, 'get_my_clas', startTime, {
        agreement_count: result.agreements.length,
        matched_user_ids: result.identity.matchedUserIds,
        github_linked: result.identity.githubLinked,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/me/clas/:signatureId/pdf-url
  public async getPdfUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_cla_pdf_url');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_cla_pdf_url' });
      }

      const signatureId = (req.params['signatureId'] ?? '').trim();

      // Re-resolve the session's own agreements and confirm the requested signature is an
      // ICLA the caller owns before asking EasyCLA for the presigned URL. Unknown, not-owned,
      // and ECLA IDs all return 404 (never 403) so this never leaks whether an ID exists.
      const { agreements } = await this.claService.getMyClas(req);
      const owned = agreements.find((a) => a.id === signatureId && a.pdfAvailable);
      if (!owned) {
        res.status(404).json({ message: 'Signed document not found' });
        return;
      }

      const pdf = await this.claService.getSignedDocumentUrl(req, signatureId);
      if (!pdf) {
        res.status(404).json({ message: 'Signed document not found' });
        return;
      }

      logger.success(req, 'get_cla_pdf_url', startTime, { signature_id: signatureId });
      res.json(pdf);
    } catch (error) {
      next(error);
    }
  }
}
