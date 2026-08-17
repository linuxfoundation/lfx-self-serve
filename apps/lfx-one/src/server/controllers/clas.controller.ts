// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Read-only "CLAs" controller (Milestone 1, Me lens).
// The user identity is derived strictly from the session — request input never
// selects whose CLAs are read (research R3). SS asserts the trusted identity keys;
// EasyCLA re-verifies each key belongs to the caller and owns the signature, so the
// upstream endpoint — not this controller — is the ownership authorization boundary.

import { NextFunction, Request, Response } from 'express';

import { AuthenticationError } from '../errors';
import { getStringQueryParam } from '../helpers/validation.helper';
import { listClaGroupOptions } from '../services/cla-group-search.stub';
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

      // EasyCLA's /v4/my-clas/{id}/pdf enforces ownership + ICLA eligibility against the
      // session's identity and returns 404 for unknown, not-owned and ECLA IDs (never 403),
      // so it never leaks whether an ID exists. SS just resolves the session identity and
      // passes it through — no separate ownership pre-check needed.
      const identity = await this.claService.resolveIdentity(req);
      const pdf = await this.claService.getPdfUrl(req, signatureId, identity);
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

  // GET /api/me/clas/sign-options
  // Stubbed CLA-Group selection (#1251); #1250 replaces the stub behind this same route.
  public async getClaGroupOptions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_cla_group_options');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_cla_group_options' });
      }

      const query = getStringQueryParam(req, 'q') ?? '';
      const options = listClaGroupOptions(query);

      logger.success(req, 'get_cla_group_options', startTime, { option_count: options.length, queried: query.length > 0 });
      res.json(options);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/me/clas/sign-handoff
  // Server-owned halves of the Contributor Console URL. Blocked during impersonation at the
  // route (signing is a write), so this handler has no impersonation branch of its own.
  public async getSignHandoff(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_cla_sign_handoff');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_cla_sign_handoff' });
      }

      // Nothing is read from the query or body: whose CLA is being signed is a property of the
      // session, never of request input (FR-003).
      const handoff = await this.claService.getSignHandoff(req);

      logger.success(req, 'get_cla_sign_handoff', startTime);
      res.json(handoff);
    } catch (error) {
      next(error);
    }
  }
}
