// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PersonaType } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { CommitteeService } from '../services/committee.service';
import { logger } from '../services/logger.service';
import { getUsernameFromAuth } from './auth-helper';

/**
 * Result of user persona and organization determination
 */
export interface UserPersonaResult {
  /** User's determined persona type */
  persona: PersonaType | null;
  /** Organization names from committee memberships */
  organizationNames: string[];
}

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
 * Fetches and determines user's persona and organizations based on committee membership
 * Checks all configured committee categories and returns the highest priority persona
 * along with all unique organization names from the user's committee memberships
 */
export async function fetchUserPersonaAndOrganizations(req: Request): Promise<UserPersonaResult> {
  const startTime = logger.startOperation(req, 'fetch_user_persona_and_organizations');

  const result: UserPersonaResult = {
    persona: null,
    organizationNames: [],
  };

  try {
    // Get username from auth context
    const username = await getUsernameFromAuth(req);
    if (!username) {
      logger.success(req, 'fetch_user_persona_and_organizations', startTime, {
        result: 'no_username_no_persona',
      });
      return result;
    }

    const committeeService = new CommitteeService();
    const userEmail = req.oidc?.user?.['email'];
    const matchedPersonas: PersonaType[] = [];
    const organizationNamesSet = new Set<string>();

    // Check each committee category mapping
    for (const [category, persona] of Object.entries(COMMITTEE_CATEGORY_TO_PERSONA)) {
      logger.debug(req, 'check_committee_category', 'Checking committee category', { category });
      const memberships = await committeeService.getCommitteeMembersByCategory(req, username, userEmail || '', category);

      logger.debug(req, 'found_committee_memberships', 'Committee memberships retrieved', {
        category,
        memberships_count: memberships.length,
      });

      if (memberships.length > 0) {
        logger.debug(req, 'matched_persona', 'Persona matched for user', {
          username,
          category,
          persona,
          memberships_count: memberships.length,
        });
        matchedPersonas.push(persona);

        // Collect unique organization names from memberships
        for (const membership of memberships) {
          if (membership.organization?.name) {
            organizationNamesSet.add(membership.organization.name);
          }
        }
      } else {
        logger.debug(req, 'no_memberships_found', 'No memberships found for category', { category });
      }
    }

    // Convert Set to array
    result.organizationNames = Array.from(organizationNamesSet);

    // No committee memberships found
    if (matchedPersonas.length === 0) {
      logger.success(req, 'fetch_user_persona_and_organizations', startTime, {
        username,
        result: 'no_committee_memberships',
      });
      return result;
    }

    // Return highest priority persona if user belongs to multiple categories
    result.persona = matchedPersonas.reduce((highest, current) => {
      const currentPriority = PERSONA_PRIORITY.indexOf(current);
      const highestPriority = PERSONA_PRIORITY.indexOf(highest);
      return currentPriority > highestPriority ? current : highest;
    }, matchedPersonas[0]);

    logger.success(req, 'fetch_user_persona_and_organizations', startTime, {
      username,
      matched_personas: matchedPersonas,
      selected_persona: result.persona,
      organization_count: result.organizationNames.length,
    });

    return result;
  } catch (error) {
    // Log error but don't fail SSR - persona determination is non-critical
    logger.error(req, 'fetch_user_persona_and_organizations', startTime, error, {
      failure_reason: 'committee_lookup_failed',
    });
    return result;
  }
}

/**
 * @deprecated Use fetchUserPersonaAndOrganizations instead
 * Fetches and determines user's persona based on committee membership
 */
export async function fetchUserPersona(req: Request): Promise<PersonaType | null> {
  const result = await fetchUserPersonaAndOrganizations(req);
  return result.persona;
}
