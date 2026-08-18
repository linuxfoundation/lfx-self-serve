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

  // GET /api/me/clas/github-accounts
  // The accounts the contributor has already linked, for the selection step (#1252).
  // A lookup failure surfaces as a failure rather than as an empty list: routing someone
  // who has a linked account into account-linking is worse than telling them the choice is
  // unavailable right now.
  public async getGithubAccounts(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_cla_github_accounts');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_cla_github_accounts' });
      }

      const options = await this.claService.listGithubAccounts(req);

      logger.success(req, 'get_cla_github_accounts', startTime, { account_count: options.accounts.length });
      res.json(options);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/me/clas/signing-identity
  // Forwards the contributor's choice and returns the record identifier the hand-off uses.
  //
  // Deliberately performs no resolution, no check of the selection against the list this
  // controller served, and no fallback on refusal. Those judgements belong to the layer
  // holding the identity provider's attestation; duplicating them here would mean deciding
  // on weaker evidence, and the only thing a pre-check could achieve is hiding a refusal
  // that has to stay visible.
  //
  // Blocked during impersonation at the route, so there is no impersonation branch here.
  public async bindSigningIdentity(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'bind_cla_signing_identity');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'bind_cla_signing_identity' });
      }

      // The account number is the only thing taken from the body. The handle that accompanies
      // it is read from the session's own accounts by the service, so there is nothing here for
      // a caller to influence beyond which of their own accounts they name.
      const body = req.body as { githubId?: unknown } | undefined;

      const githubId = String(body?.githubId ?? '').trim();
      if (!/^[1-9][0-9]*$/.test(githubId)) {
        res.status(400).json({ message: 'A GitHub account number is required' });
        return;
      }

      const result = await this.claService.bindSigningIdentity(req, githubId);

      logger.success(req, 'bind_cla_signing_identity', startTime);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}
