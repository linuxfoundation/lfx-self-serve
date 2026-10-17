// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EXECUTIVE_DIRECTOR_PERSONA as ED } from '@lfx-one/shared/constants';
import type { PersonaApiResponse, SocialListeningAccessReason } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { personaDetectionService } from '../utils/persona-helper';

/**
 * Who the executive-dashboard policy admits for `requestedSlug`: EDs and LF Staff, from server-verified
 * personas (never the spoofable cookie). ED scope is per-foundation, and a root writer passes it only
 * when it also holds `writer_guard` on the named foundation. A request without a slug has nothing to
 * scope against — the handler is responsible for rejecting a missing required parameter.
 */
export async function getDashboardAccessReason(req: Request, result: PersonaApiResponse, requestedSlug: string): Promise<SocialListeningAccessReason> {
  const isED = result.personas.includes(ED);

  if (result.isLFStaff) {
    return 'lf-staff';
  }

  if (!isED) {
    return 'none';
  }

  if (!requestedSlug) {
    return 'executive-director';
  }

  // Upstream project slugs are verbatim — normalize case on both sides so mixed-case data can't 403 a scoped ED.
  const edSlugs = (result.personaProjects?.[ED] ?? []).map((project) => project.projectSlug.toLowerCase());
  if (edSlugs.includes(requestedSlug.toLowerCase())) {
    return 'executive-director';
  }

  // A root writer is trusted per foundation, not across the board: the ROOT check admits
  // `global_writer`, which is withheld on some projects, so the named foundation must agree.
  if (result.isRootWriter && (await personaDetectionService.checkProjectWriter(req, requestedSlug))) {
    return 'executive-director';
  }

  return 'none';
}
