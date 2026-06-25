// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PersonaType } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError } from '../errors';
import { personaDetectionService } from '../utils/persona-helper';
import { logger } from '../services/logger.service';

const ED: PersonaType = 'executive-director';

// ED authorization must come from server-verified persona detection, not the
// PERSONA_COOKIE_KEY cookie — that cookie is unsigned plain JSON and is
// client-spoofable. getPersonas() is cached per username/email so the cost is
// amortized across requests.
export async function requireExecutiveDirector(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await personaDetectionService.getPersonas(req);
    const isED = result.personas.includes(ED);

    if (isED) {
      next();
      return;
    }

    logger.warning(req, 'require_executive_director', 'Non-ED user attempted ED-only endpoint', {
      path: req.path,
      personas: result.personas,
    });

    next(
      new AuthorizationError('Executive Director access required for this resource', {
        operation: 'require_executive_director',
        service: 'authorization',
        path: req.path,
        code: 'EXECUTIVE_DIRECTOR_REQUIRED',
      })
    );
  } catch (error) {
    next(error);
  }
}
