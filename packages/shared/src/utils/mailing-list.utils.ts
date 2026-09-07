// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { GroupsIOMailingList } from '../interfaces/mailing-list.interface';

import { getEntityCommands } from './entity-route.utils';

/** Canonical tier-prefixed mailing-list link with the flat `/mailing-lists/...` fallback baked in (GH-1567). */
export function getMailingListCommands(list: Pick<GroupsIOMailingList, 'uid' | 'is_foundation'>, leaf?: 'edit'): string[] {
  const flatFallback = leaf ? ['/mailing-lists', list.uid, leaf] : ['/mailing-lists', list.uid];
  return getEntityCommands('mailing-lists', list.uid, list.is_foundation, leaf) ?? flatFallback;
}

/** `?project=` for mailing-list links — present only when the list carries a slug (GH-1567). */
export function getMailingListLinkQueryParams(list: { project_slug?: string | null } | null | undefined): { project: string } | null {
  return list?.project_slug ? { project: list.project_slug } : null;
}
