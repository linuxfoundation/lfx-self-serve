// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import { FormationItem } from '@lfx-one/shared/interfaces';
import { maskIdentifierForLogs } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { logger } from '../services/logger.service';
import { ProjectService } from '../services/project.service';
import { withUserCache } from '../services/valkey.service';

const projectService = new ProjectService();

interface FormationOwnerIdentity {
  name: string;
  email: string;
}

function isFormationOwnerIdentity(value: unknown): value is FormationOwnerIdentity {
  const candidate = value as FormationOwnerIdentity;
  return !!candidate && typeof candidate.name === 'string' && typeof candidate.email === 'string';
}

/**
 * Resolves a real display name + contact email for each distinct formation-item owner (GH-2616)
 * via `ProjectService.getUserInfo` — not `UserService.getUserInfo`, whose `UserMetadata` response
 * carries no email. Cached per-username for `FORMATION_OWNER_IDENTITY_TTL_SECONDS`. Dedupes by
 * username before making any lookup: a formation checklist has at most 17 items with far fewer
 * distinct assignees, so this is at most one NATS round trip per unique assignee per cache window,
 * never one per item.
 *
 * Never throws: a lookup failure for one owner (unknown username, directory miss, transport error)
 * degrades that owner back to today's behavior — `name` stays the raw username, `email` stays
 * absent — without affecting any other item or failing the checklist read.
 *
 * `withUserCache`'s per-username key is deliberately keyed by the *subject* (the owner being
 * looked up), not the requesting principal — unlike its other callers, which key by the caller's
 * own username for "mine semantics" data. Safe here because a resolved `{name, email}` is the same
 * for every viewer (it's the subject's own public directory identity, not access-scoped), so
 * sharing one cache entry across all callers is correct, not a cross-principal leak.
 */
export async function enrichFormationItemsWithOwnerIdentity<T extends Pick<FormationItem, 'owner'>>(req: Request, items: T[]): Promise<T[]> {
  const usernames = [...new Set(items.map((item) => item.owner?.username).filter((username): username is string => !!username))];
  if (usernames.length === 0) {
    return items;
  }

  const identityMap = new Map<string, FormationOwnerIdentity>();

  await Promise.allSettled(
    usernames.map(async (username) => {
      try {
        const identity = await withUserCache(
          VALKEY_CACHE.FORMATION_OWNER_IDENTITY_NAMESPACE,
          username,
          VALKEY_CACHE.FORMATION_OWNER_IDENTITY_TTL_SECONDS,
          async () => {
            const info = await projectService.getUserInfo(req, username);
            return { name: info.name, email: info.email };
          },
          isFormationOwnerIdentity
        );
        identityMap.set(username, identity);
      } catch (error) {
        logger.warning(req, 'enrich_formation_owner_identity', 'Failed to resolve owner identity — leaving username as display name', {
          username: maskIdentifierForLogs(username),
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    })
  );

  if (identityMap.size === 0) {
    return items;
  }

  return items.map((item) => {
    const username = item.owner?.username;
    const identity = username ? identityMap.get(username) : undefined;
    if (!identity) {
      return item;
    }
    return { ...item, owner: { ...item.owner!, name: identity.name, email: identity.email } };
  });
}
