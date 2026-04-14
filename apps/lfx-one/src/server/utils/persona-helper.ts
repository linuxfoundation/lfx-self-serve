// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import type { PersistedPersonaState, PersonaType, SsrPersonaResult } from '@lfx-one/shared/interfaces';
import { VALID_PERSONAS } from '@lfx-one/shared/interfaces';
import { Request, Response } from 'express';

import { logger } from '../services/logger.service';
import { PersonaDetectionService } from '../services/persona-detection.service';

const DEFAULT_PERSONA: PersonaType = 'contributor';

/** Shared singleton — reused by both SSR helper and persona controller */
export const personaDetectionService = new PersonaDetectionService();

/**
 * Resolve persona for SSR rendering using hybrid cookie-gated strategy:
 * - If persona cookie exists → parse and use it (non-blocking)
 * - If no cookie → fetch from NATS persona service (blocking, sets cookie on response)
 * - Fallback to 'contributor' on any failure
 */
export async function resolvePersonaForSsr(req: Request, res: Response): Promise<SsrPersonaResult> {
  const cookieHeader = req.headers.cookie || '';
  const hasPersonaCookie = cookieHeader.includes(PERSONA_COOKIE_KEY + '=');

  if (hasPersonaCookie) {
    return resolveFromCookie(req, cookieHeader);
  }

  return resolveFromNats(req, res);
}

/**
 * Parse persona from existing cookie (non-blocking path)
 */
function resolveFromCookie(req: Request, cookieHeader: string): SsrPersonaResult {
  try {
    const cookieMatch = cookieHeader.match(new RegExp(`${PERSONA_COOKIE_KEY}=([^;]+)`));
    if (cookieMatch?.[1]) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(cookieMatch[1]);
      } catch {
        return { persona: DEFAULT_PERSONA, personas: [DEFAULT_PERSONA] };
      }
      const parsed = JSON.parse(decoded) as PersistedPersonaState;
      if (parsed.primary && VALID_PERSONAS.has(parsed.primary) && parsed.all?.length > 0 && parsed.all.every((p) => VALID_PERSONAS.has(p))) {
        return {
          persona: parsed.primary,
          personas: parsed.all,
          organizations: parsed.organizations ?? [],
        };
      }
    }
  } catch {
    logger.debug(req, 'ssr_persona', 'Failed to parse persona cookie, using default');
  }

  return { persona: DEFAULT_PERSONA, personas: [DEFAULT_PERSONA] };
}

/**
 * Fetch persona from NATS persona detection service (blocking path for first-time users)
 * Sets the persona cookie on the response so subsequent requests use the non-blocking path
 */
async function resolveFromNats(req: Request, res: Response): Promise<SsrPersonaResult> {
  try {
    const personaResult = await personaDetectionService.getPersonas(req);

    const persona = personaResult.personas.length > 0 ? personaResult.personas[0] : DEFAULT_PERSONA;
    const personas = personaResult.personas.length > 0 ? personaResult.personas : [DEFAULT_PERSONA];
    const organizations = personaResult.organizations ?? [];

    // Only cache when detection succeeded — don't pin user to contributor on transient NATS failure
    if (!personaResult.error) {
      const cookieState: PersistedPersonaState = {
        primary: persona,
        all: personas,
        multiProject: personaResult.multiProject,
        multiFoundation: personaResult.multiFoundation,
        organizations,
      };
      res.cookie(PERSONA_COOKIE_KEY, JSON.stringify(cookieState), {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: '/',
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production',
        httpOnly: false,
      });
    }

    logger.debug(req, 'ssr_persona', 'Persona resolved via NATS for first-time SSR', {
      persona,
      personas,
    });

    return { persona, personas, organizations };
  } catch (error) {
    logger.warning(req, 'ssr_persona', 'Persona detection failed during SSR, defaulting to contributor', {
      error: error instanceof Error ? error.message : 'Unknown error',
      path: req.path,
    });

    return { persona: DEFAULT_PERSONA, personas: [DEFAULT_PERSONA] };
  }
}
