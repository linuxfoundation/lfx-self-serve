// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_AUDITOR_MEMBER_ORGS_HARD_CAP } from '@lfx-one/shared/constants';
import { B2bOrgIndexedDoc, GetOrgItemsParams, OrgItem, OrgItemsResponse, ResolvedOrgRole } from '@lfx-one/shared/interfaces';
import { appendFoundationAuditorItems } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { getEffectiveUsername } from '../utils/auth-helper';
import { FoundationAuditorOrgsService, isFoundationAuditorOrgSelectorEnabled } from './foundation-auditor-orgs.service';
import { logger } from './logger.service';
import { OrgRoleGrantsService } from './org-role-grants.service';

/** Spec 022 — server-side org-selector data source. Renders the access-aware list per `01-my-orgs-by-access.ipynb` (data-model.md D-001…D-005). Typeahead filters the resolved set in-process: the set is direct grants (≤ ORG_ROLE_GRANTS_HARD_CAP) plus their cascading children (≤ ORG_CASCADING_CHILDREN_PER_PARENT_HARD_CAP per direct parent), so it is finite but not strictly ≤500 — in practice it stays small enough for in-memory filter/sort. */
export class OrgNavigationService {
  private readonly orgRoleGrants: OrgRoleGrantsService;
  private readonly foundationAuditorOrgs: FoundationAuditorOrgsService;

  public constructor() {
    this.orgRoleGrants = new OrgRoleGrantsService();
    this.foundationAuditorOrgs = new FoundationAuditorOrgsService();
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

    const username = getEffectiveUsername(req);
    if (!username) {
      logger.warning(req, 'get_org_items', 'No authenticated username — returning empty access-aware list');
      return { items: [], next_page_token: null, upstream_failed: true };
    }

    const access = await this.orgRoleGrants.getAccessAwareOrgs(req, username);

    // Spec 002: the b2b_org uid IS the 18-char SFID (member-service v0.7.0), so the account id is the
    // uid itself — no NATS UUID→SFID resolution, and no rows dropped for a missing sfid.
    const items = this.buildOrgItems(req, access.resolved, access.orgDocByUid);

    const filteredItems = this.applySearch(items, name);
    const sortedItems = this.applySort(filteredItems, name);
    // LFXV2-2750 — append view-only member orgs of foundations the caller audits that match the search term.
    // Runs after the grants filter/sort so grants-derived rows always rank first; no-ops without a search term.
    const withFoundationAuditors = await this.appendFoundationAuditorMatches(req, username, sortedItems, name);
    const pinnedItems = this.applySelectedUidPin(withFoundationAuditors, items, selectedUid, pageToken);

    logger.debug(req, 'build_org_items', 'Built access-aware org items', {
      item_count: pinnedItems.length,
      direct_count: this.countByPrefix(access.resolved, 'direct-'),
      cascading_count: this.countByPrefix(access.resolved, 'inherited-'),
    });

    return {
      items: pinnedItems,
      next_page_token: null,
      upstream_failed: access.upstreamFailed,
      total: pinnedItems.length,
    };
  }

  /**
   * LFXV2-2750 — append view-only member orgs of foundations the caller audits, matching the typeahead term.
   * Gated by the env kill-switch (default off) and no-ops for a too-short term, so the default dropdown stays
   * exactly today's grants-only list. Fail-soft: any lookup failure returns the grants-only rows unchanged.
   */
  private async appendFoundationAuditorMatches(req: Request, username: string, baseItems: OrgItem[], name: string | undefined): Promise<OrgItem[]> {
    if (!isFoundationAuditorOrgSelectorEnabled()) {
      logger.debug(req, 'append_foundation_auditor_items', 'Skipped — FOUNDATION_AUDITOR_ORG_SELECTOR_ENABLED is not enabled', {
        flag_value: process.env['FOUNDATION_AUDITOR_ORG_SELECTOR_ENABLED'] ?? '<unset>',
      });
      return baseItems;
    }

    try {
      const matches = await this.foundationAuditorOrgs.findAuditedMemberOrgs(req, username, name);
      if (matches.length === 0) {
        return baseItems;
      }

      const appended = appendFoundationAuditorItems(baseItems, matches, FOUNDATION_AUDITOR_MEMBER_ORGS_HARD_CAP);
      if (appended.truncated) {
        logger.warning(req, 'append_foundation_auditor_items', 'Foundation-auditor row cap reached — truncating', {
          cap: FOUNDATION_AUDITOR_MEMBER_ORGS_HARD_CAP,
          added: appended.addedCount,
        });
      }
      logger.debug(req, 'append_foundation_auditor_items', 'Appended foundation-auditor member orgs', {
        added: appended.addedCount,
      });
      return appended.items;
    } catch (error) {
      logger.warning(req, 'append_foundation_auditor_items', 'Foundation-auditor lookup failed — returning grants-only list', { err: error });
      return baseItems;
    }
  }

  /** One omission branch (FR-005 + spec Edge Cases): missing org doc → skip+warn `missing_org_doc`. Spec 002: the uid IS the account id (SFID), so there is no `missing_sfid` omission. */
  private buildOrgItems(req: Request, resolved: Map<string, ResolvedOrgRole>, orgDocByUid: Map<string, B2bOrgIndexedDoc>): OrgItem[] {
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

      // Spec 002: the b2b_org uid is the canonical 18-char SFID; it IS the account id.
      const isInherited = role.roleSource.startsWith('inherited-');
      items.push({
        uid,
        accountId: uid,
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
