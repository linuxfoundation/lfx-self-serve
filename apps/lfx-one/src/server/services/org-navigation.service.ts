// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { B2bOrgIndexedDoc, GetOrgItemsParams, OrgItem, OrgItemsResponse, ResolvedOrgRole } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { getEffectiveSub } from '../utils/auth-helper';
import { logger } from './logger.service';
import { OrgRoleGrantsService } from './org-role-grants.service';
import { SfidResolverService } from './sfid-resolver.service';

/** Spec 022 — server-side org-selector data source. Renders the access-aware list per `01-my-orgs-by-access.ipynb` (data-model.md D-001…D-005). Typeahead filters the resolved set in-process: the set is direct grants (≤ ORG_ROLE_GRANTS_HARD_CAP) plus their cascading children (≤ ORG_CASCADING_CHILDREN_PER_PARENT_HARD_CAP per direct parent), so it is finite but not strictly ≤500 — in practice it stays small enough for in-memory filter/sort. */
export class OrgNavigationService {
  private readonly orgRoleGrants: OrgRoleGrantsService;
  private readonly sfidResolver: SfidResolverService;

  public constructor() {
    this.orgRoleGrants = new OrgRoleGrantsService();
    this.sfidResolver = new SfidResolverService();
  }

  public async getOrgItems(req: Request, params: GetOrgItemsParams): Promise<OrgItemsResponse> {
    const { pageToken, name } = params;
    let { selectedUid } = params;

    // Defense-in-depth: the navigation controller already rejects this combination at the
    // HTTP layer (selected_uid + page_token are mutually exclusive per FR-013). Direct
    // service callers — present and future — get the same safe behaviour by silently
    // dropping the selected_uid hint on continuation pages.
    if (pageToken && selectedUid) {
      logger.warning(req, 'get_org_items', 'page_token and selected_uid both set — ignoring selected_uid', {
        has_page_token: true,
        has_selected_uid: true,
      });
      selectedUid = undefined;
    }

    // Spec 022 — use the auth0 sub form (matches indexed `member:auth0|<id>` tags + stored `data.writers[].username`).
    const username = getEffectiveSub(req);
    if (!username) {
      logger.warning(req, 'get_org_items', 'No authenticated username — returning empty access-aware list');
      return { items: [], next_page_token: null, upstream_failed: true };
    }

    const access = await this.orgRoleGrants.getAccessAwareOrgs(req, username);

    if (access.resolved.size === 0 && access.orgDocByUid.size === 0) {
      return { items: [], next_page_token: null, upstream_failed: access.upstreamFailed, total: 0 };
    }

    // Batch-resolve sfids via NATS RPC (lfx.member.uuid-to-sfid.lookup) for uids whose indexed doc lacks one.
    const uidsNeedingSfid = Array.from(access.resolved.keys()).filter((uid) => !access.orgDocByUid.get(uid)?.sfid);
    const resolvedSfids = await this.sfidResolver.resolveBatch(uidsNeedingSfid);

    const items = this.buildOrgItems(req, access.resolved, access.orgDocByUid, resolvedSfids);

    const filteredItems = this.applySearch(items, name);
    const sortedItems = this.applySort(filteredItems, name);
    const pinnedItems = this.applySelectedUidPin(sortedItems, items, selectedUid, pageToken);

    logger.debug(req, 'build_org_items', 'Built access-aware org items', {
      item_count: pinnedItems.length,
      direct_count: this.countByPrefix(access.resolved, 'direct-'),
      cascading_count: this.countByPrefix(access.resolved, 'inherited-'),
    });

    return {
      items: pinnedItems,
      next_page_token: null,
      upstream_failed: false,
      total: pinnedItems.length,
    };
  }

  /** Two omission branches (FR-005 + spec Edge Cases): (a) missing org doc → skip+warn `missing_org_doc`; (b) null/missing sfid → skip+warn `missing_sfid`. */
  private buildOrgItems(
    req: Request,
    resolved: Map<string, ResolvedOrgRole>,
    orgDocByUid: Map<string, B2bOrgIndexedDoc>,
    resolvedSfids: Map<string, string>
  ): OrgItem[] {
    const items: OrgItem[] = [];

    for (const [uid, role] of resolved) {
      const doc = orgDocByUid.get(uid);
      if (!doc) {
        logger.warning(req, 'build_org_items', 'omitting row', {
          uid,
          source: role.roleSource,
          reason: 'missing_org_doc',
        });
        continue;
      }

      // Prefer the indexed sfid (future: indexer will emit it). Fall back to the batch-resolved
      // value from NATS RPC `lfx.member.uuid-to-sfid.lookup` (null when the RPC can't resolve it).
      const sfid = doc.sfid || resolvedSfids.get(uid);
      if (!sfid) {
        logger.warning(req, 'build_org_items', 'omitting row', {
          uid,
          source: role.roleSource,
          reason: 'missing_sfid',
        });
        continue;
      }

      const isInherited = role.roleSource.startsWith('inherited-');
      items.push({
        uid,
        accountId: sfid,
        name: doc.name ?? '',
        logoUrl: doc.logo_url ?? null,
        primaryDomain: doc.primary_domain ?? null,
        isMember: doc.is_member ?? false,
        parentName: isInherited ? (role.parentName ?? null) : null,
      });
    }

    return items;
  }

  private applySearch(items: OrgItem[], name: string | undefined): OrgItem[] {
    const trimmed = name?.trim().toLowerCase();
    if (!trimmed) return items;
    return items.filter((item) => item.name.toLowerCase().includes(trimmed));
  }

  /** `best_match` when searching (prefix-rank first), alphabetical otherwise. */
  private applySort(items: OrgItem[], name: string | undefined): OrgItem[] {
    const trimmed = name?.trim().toLowerCase();
    if (trimmed) {
      return [...items].sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(trimmed) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(trimmed) ? 0 : 1;
        return aStarts - bStarts || a.name.localeCompare(b.name);
      });
    }
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** FR-013 — pin a previously-selected row at the top when it falls outside the natural list. Skipped on continuation pages. */
  private applySelectedUidPin(sortedItems: OrgItem[], allItems: OrgItem[], selectedUid: string | undefined, pageToken: string | undefined): OrgItem[] {
    if (!selectedUid || pageToken) return sortedItems;
    if (sortedItems.some((item) => item.uid === selectedUid)) return sortedItems;
    const pinned = allItems.find((item) => item.uid === selectedUid);
    if (!pinned) return sortedItems;
    return [pinned, ...sortedItems];
  }

  private countByPrefix(resolved: Map<string, ResolvedOrgRole>, prefix: string): number {
    let count = 0;
    for (const [, role] of resolved) {
      if (role.roleSource.startsWith(prefix)) count += 1;
    }
    return count;
  }
}
