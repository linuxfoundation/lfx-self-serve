// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { AuthorizationError } from '../errors';
import { logger } from '../services/logger.service';
import { personaDetectionService } from '../utils/persona-helper';

/**
 * Guards the Formations queue endpoints (`foundation/formations`, GH-1958) — root-scoped `auditor`
 * FGA grant, with a root-writer bypass matching every sibling ED/marketing-access middleware's
 * convention. Deliberately simpler than `require-marketing-access.middleware.ts`: the queue has no
 * `?project=`/`?foundationSlug=` scoping to fall back to (it is locked to the LF root, no nested
 * views), so there is no per-project relation check below the root one.
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
