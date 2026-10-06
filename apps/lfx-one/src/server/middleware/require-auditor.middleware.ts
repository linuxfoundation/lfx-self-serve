// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { AuthorizationError } from '../errors';
import { logger } from '../services/logger.service';
import { personaDetectionService } from '../utils/persona-helper';

/**
 * Guards the Formations queue endpoints (`foundation/formations`, GH-1958) — root-scoped
 * `auditor_guard` FGA grant, with a root-writer (`writer_guard`) bypass. Unlike the ED/marketing-access
 * siblings, the bypass is deliberately unscoped: as of GH-2367 the
 * queue does take an optional `?foundation_uid=` scope, but that's a query-level `parent` narrowing
 * of an already-permitted row set (`/query/resources` still enforces per-row access upstream, on the
 * relation each indexed formation document names), so
 * it can only shrink what a root auditor sees — never grant access to a row they couldn't already
 * read. There is intentionally no per-project relation check here below the root one.
 */
export async function requireAuditor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [isAuditor, isRootWriter] = await Promise.all([personaDetectionService.checkRootAuditor(req), personaDetectionService.checkRootWriter(req)]);

    if (isAuditor || isRootWriter) {
      next();
      return;
    }

    logger.warning(req, 'require_auditor', 'Non-auditor user attempted a Formations queue endpoint', { path: req.path });

    next(
      new AuthorizationError('Auditor access required for this resource', {
        operation: 'require_auditor',
        service: 'authorization',
        path: req.path,
        code: 'AUDITOR_REQUIRED',
      })
    );
  } catch (error) {
    next(error);
  }
}
