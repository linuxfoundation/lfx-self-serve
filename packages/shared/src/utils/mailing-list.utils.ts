// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { GroupsIOMailingList, MailingListCommitteeSync, MailingListGroupLink } from '../interfaces/mailing-list.interface';

import { getEntityCommands } from './entity-route.utils';

/**
 * Strips trailing hyphens from a stored service prefix. Some services are stored with a trailing
 * hyphen (e.g. `example-project-`) and some without; the group name is always built as
 * `${prefix}-${name}`, so a trailing hyphen would produce `--`, which Groups.io rejects.
 */
export function normalizeServicePrefix(prefix: string | null | undefined): string {
  if (!prefix) {
    return '';
  }

  // Trim from the end with a loop rather than `/-+$/`, which backtracks quadratically on long runs of hyphens.
  let end = prefix.length;
  while (end > 0 && prefix[end - 1] === '-') {
    end--;
  }

  return prefix.slice(0, end);
}

/** Address from the mailing list's indexed domain; never depend on a readable parent service. */
export function getMailingListEmail(list: Pick<GroupsIOMailingList, 'group_name' | 'domain'> | null | undefined): string {
  const groupName = list?.group_name?.trim();
  const domain = list?.domain?.trim();
  return groupName && domain ? `${groupName}@${domain}` : '';
}

/** Public Groups.io page for the list, built from its indexed domain; falls back to the parent service URL. */
export function getMailingListGroupsIoUrl(
  list: (Pick<GroupsIOMailingList, 'group_name' | 'domain'> & { service?: { url?: string | null } | null }) | null | undefined
): string | null {
  const groupName = list?.group_name?.trim();
  const domain = list?.domain?.trim();
  if (groupName && domain) {
    return `https://${domain}/g/${encodeURIComponent(groupName)}`;
  }
  return toHttpUrl(list?.service?.url);
}

/** Returns the URL only when it parses with an http(s) scheme — guards `[href]` bindings against `javascript:` values. */
function toHttpUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

/** Canonical tier-prefixed mailing-list link with the flat `/mailing-lists/...` fallback baked in (GH-1567). */
export function getMailingListCommands(list: Pick<GroupsIOMailingList, 'uid' | 'is_foundation'>, leaf?: 'edit'): string[] {
  const flatFallback = leaf ? ['/mailing-lists', list.uid, leaf] : ['/mailing-lists', list.uid];
  return getEntityCommands('mailing-lists', list.uid, list.is_foundation, leaf) ?? flatFallback;
}

/**
 * The groups linked to a mailing list, each with its canonical group-details link from the list's own tier.
 * A group with no uid has `commands: null` so callers show it as plain text instead of dropping it.
 * `limit` keeps only the first few, so a table can summarise the rest as "+N more".
 */
export function getMailingListGroupLinks(list: Pick<GroupsIOMailingList, 'committees' | 'is_foundation'>, limit?: number): MailingListGroupLink[] {
  return (list.committees ?? []).slice(0, limit).map((committee) => {
    const uid = committee.uid?.trim();
    return {
      uid: committee.uid,
      name: committee.name?.trim() || null,
      commands: uid ? (getEntityCommands('groups', uid, list.is_foundation) ?? ['/groups', uid]) : null,
    };
  });
}

/** `?project=` for mailing-list links — present only when the list carries a slug (GH-1567). */
export function getMailingListLinkQueryParams(list: { project_slug?: string | null } | null | undefined): { project: string } | null {
  return list?.project_slug ? { project: list.project_slug } : null;
}

/**
 * Resolves a mailing list's sync direction and committee/role filters for `committeeUid` from the
 * matching entry in `list.committees[]` — the backend (linuxfoundation/lfx-v2-mailing-list-service,
 * `model.Committee`) stores `sync_mode`, `allowed_voting_statuses` and `committee_role_filters`
 * per-committee-entry there, not as top-level fields on the mailing list resource itself, so a list
 * linked to multiple committees can carry a different direction/filter set for each one. Reading
 * `list.sync_mode` / `list.committee_filters` / `list.committee_role_filters` directly only works
 * for the write-payload shape (`CreateMailingListRequest`) — on the indexed read model those
 * top-level fields are not populated and silently resolve to defaults.
 */
export function getMailingListCommitteeSync(
  list: Pick<GroupsIOMailingList, 'committees'> | null | undefined,
  committeeUid: string | null | undefined
): MailingListCommitteeSync {
  const committee = committeeUid ? list?.committees?.find((c) => c.uid === committeeUid) : undefined;
  return {
    syncMode: committee?.sync_mode,
    committeeFilters: committee?.allowed_voting_statuses ?? [],
    committeeRoleFilters: committee?.committee_role_filters ?? [],
  };
}
