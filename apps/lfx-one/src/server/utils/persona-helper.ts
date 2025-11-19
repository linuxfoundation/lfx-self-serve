// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PersonaType } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { CommitteeService } from '../services/committee.service';
import { getUsernameFromAuth } from './auth-helper';

/**
 * Mapping of committee categories to their corresponding personas
 * Add new mappings here to support additional persona types
 */
const COMMITTEE_CATEGORY_TO_PERSONA: Record<string, PersonaType> = {
  Board: 'board-member',
  Maintainers: 'maintainer',
  Committers: 'core-developer',
};

/**
 * Priority order for personas when user belongs to multiple committee categories
 * Higher index = higher priority (board-member is highest, core-developer is fallback)
 */
const PERSONA_PRIORITY: PersonaType[] = ['core-developer', 'maintainer', 'board-member'];

/**
 * Fetches and determines user's persona based on committee membership
 * Checks all configured committee categories and returns the highest priority persona
 */
export async function fetchUserPersona(req: Request): Promise<PersonaType | null> {
  try {
    // Get username from auth context
    const username = await getUsernameFromAuth(req);
    if (!username) {
      req.log.warn('No username found in auth context for persona determination');
      return null;
    }

    const committeeService = new CommitteeService();
    const userEmail = req.oidc?.user?.['email'];
    const matchedPersonas: PersonaType[] = [];

    // Check each committee category mapping
    for (const [category, persona] of Object.entries(COMMITTEE_CATEGORY_TO_PERSONA)) {
      const memberships = await committeeService.getCommitteeMembersByCategory(req, username, userEmail || '', category);

      if (memberships.length > 0) {
        req.log.info(
          {
            username,
            category,
            persona,
            memberships_count: memberships.length,
          },
          `User has ${category} committee membership - matched persona ${persona}`
        );
        matchedPersonas.push(persona);
      }
    }

    // No committee memberships found
    if (matchedPersonas.length === 0) {
      return null;
    }

    // Return highest priority persona if user belongs to multiple categories
    const selectedPersona = matchedPersonas.reduce((highest, current) => {
      const currentPriority = PERSONA_PRIORITY.indexOf(current);
      const highestPriority = PERSONA_PRIORITY.indexOf(highest);
      return currentPriority > highestPriority ? current : highest;
    }, matchedPersonas[0]);

    req.log.info(
      {
        username,
        matched_personas: matchedPersonas,
        selected_persona: selectedPersona,
      },
      'Determined user persona from committee memberships'
    );

    return selectedPersona;
  } catch (error) {
    // Log error but don't fail SSR - persona determination is non-critical
    req.log.warn(
      {
        error: error instanceof Error ? error.message : error,
      },
      'Failed to determine user persona from committee membership'
    );
    return null;
  }
}
