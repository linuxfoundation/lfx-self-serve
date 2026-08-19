// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Read-only "CLAs" controller (Milestone 1, Me lens).
// The user identity is derived strictly from the session — request input never
// selects whose CLAs are read (research R3). SS asserts the trusted identity keys;
// EasyCLA re-verifies each key belongs to the caller and owns the signature, so the
// upstream endpoint — not this controller — is the ownership authorization boundary.

import { CLA_GROUP_SEARCH_MIN_CHARS } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError } from '../errors';
import { getStringQueryParam } from '../helpers/validation.helper';
import { ClaService } from '../services/cla.service';
import { logger } from '../services/logger.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

// A CLA Group UUID, hyphenated or not — the two spellings the producer's own pattern accepts.
// Anchored with fixed-length runs, so it cannot backtrack.
const CLA_GROUP_ID_PATTERN = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

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
  // Live four-source CLA-Group search (#1250), behind the route #1251's picker already calls.
  // Not impersonation-blocked: selection is a read. The sign hand-off next door is the write.
  public async getClaGroupOptions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_cla_group_options');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_cla_group_options' });
      }

      const searchTerm = (getStringQueryParam(req, 'q') ?? '').trim();

      // Upstream requires three characters and answers 422 (400 once trimmed) below that. The
      // picker gates on the same length; this is the second line, so a caller that skips the
      // picker gets an empty set rather than an error describing a mistake nobody made.
      if (searchTerm.length < CLA_GROUP_SEARCH_MIN_CHARS) {
        logger.success(req, 'get_cla_group_options', startTime, { result_count: 0, truncated: false, term_too_short: true });
        res.json({ searchTerm, resultCount: 0, truncated: false, results: [] });
        return;
      }

      const envelope = await this.claService.searchClaGroups(req, searchTerm);

      logger.success(req, 'get_cla_group_options', startTime, { result_count: envelope.resultCount, truncated: envelope.truncated });
      res.json(envelope);
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

  // POST /api/me/clas/prepare-sign
  // Asks the CLA service to open the signing session and answers with the Console address it
  // returned. Nothing here composes that address.
  //
  // Deliberately performs no resolution and no fallback on refusal. Those judgements belong to
  // the layer holding the identity provider's attestation; duplicating them here would mean
  // deciding on weaker evidence, and the only thing a pre-check could achieve is hiding a
  // refusal that has to stay visible.
  //
  // Blocked during impersonation at the route, so there is no impersonation branch here.
  public async prepareSign(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'prepare_cla_sign');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'prepare_cla_sign' });
      }

      // The chosen account and the confirmed group are the only things taken from the body. The
      // handle is read from the session's own accounts by the service, and the return address is
      // derived from the request — EasyCLA stores that value and redirects to it verbatim, so a
      // client-supplied one would turn the hand-off into an open redirect.
      const body = req.body as { githubId?: unknown; claGroupId?: unknown } | undefined;

      const githubId = String(body?.githubId ?? '').trim();
      if (!/^[1-9][0-9]*$/.test(githubId)) {
        res.status(400).json({ message: 'A GitHub account number is required' });
        return;
      }

      // Required upstream, and answered here rather than after a gateway round trip that would
      // learn the same thing. Hyphens are optional because the producer's own pattern allows
      // both spellings of the UUID.
      const claGroupId = String(body?.claGroupId ?? '').trim();
      if (!CLA_GROUP_ID_PATTERN.test(claGroupId)) {
        res.status(400).json({ message: 'A CLA group identifier is required' });
        return;
      }

      const result = await this.claService.prepareSign(req, githubId, claGroupId);

      logger.success(req, 'prepare_cla_sign', startTime);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}
