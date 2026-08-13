// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_CATALOGUE_FILTERED_PAGE_SKIP_CAP, ORG_CATALOGUE_SEARCH_MIN_CHARS } from '@lfx-one/shared/constants';
import {
  B2bOrgIndexedDoc,
  GetOrgItemsParams,
  OrgItem,
  OrgItemsQuery,
  OrgItemsResponse,
  QueryServiceResponse,
  ResolvedOrgRole,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { getEffectiveUsername } from '../utils/auth-helper';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { OrgRoleGrantsService } from './org-role-grants.service';

/** Spec 022 — server-side org-selector data source. Renders the access-aware list per `01-my-orgs-by-access.ipynb` (data-model.md D-001…D-005). Typeahead filters the resolved set in-process: the set is direct grants (≤ ORG_ROLE_GRANTS_HARD_CAP) plus their cascading children (≤ ORG_CASCADING_CHILDREN_PER_PARENT_HARD_CAP per direct parent), so it is finite but not strictly ≤500 — in practice it stays small enough for in-memory filter/sort. */
export class OrgNavigationService {
  private readonly orgRoleGrants: OrgRoleGrantsService;
  private readonly microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.orgRoleGrants = new OrgRoleGrantsService();
    this.microserviceProxy = new MicroserviceProxyService();
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

    // A staff caller typically has nothing assigned, so "nothing resolved" can no longer
    // stand in for "nothing to return": the catalogue is still reachable by name.
    const catalogueTerm = this.catalogueSearchTerm(access.isStaff, name);

    // Spec 002: the b2b_org uid IS the 18-char SFID (member-service v0.7.0), so the account id is the
    // uid itself — no NATS UUID→SFID resolution, and no rows dropped for a missing sfid.
    const items = this.buildOrgItems(req, access.resolved, access.orgDocByUid);

    // A staff caller's restored selection is normally an org they hold no grant on, so the
    // assigned-row pin below cannot find it and the selection would silently reset to "Select
    // Organization" on every page load. Resolve that one org from the catalogue instead.
    const pinnedDiscovered =
      access.isStaff && selectedUid && !pageToken && !items.some((item) => item.uid === selectedUid)
        ? await this.fetchDiscoveredOrgByUid(req, selectedUid)
        : null;

    if (access.resolved.size === 0 && access.orgDocByUid.size === 0 && !catalogueTerm && !pinnedDiscovered) {
      return { items: [], next_page_token: null, upstream_failed: access.upstreamFailed, total: 0 };
    }

    // The assigned population is complete on page one and never repeats on a continuation page,
    // which only exists for catalogue paging.
    const assignedItems = pageToken ? [] : this.applySelectedUidPin(this.applySort(this.applySearch(items, name), name), items, selectedUid, pageToken);

    const catalogueResult = catalogueTerm
      ? await this.fetchCatalogueMatches(req, catalogueTerm, pageToken, items)
      : { items: [] as OrgItem[], nextPageToken: null, failed: false };
    const nextPageToken = catalogueResult.nextPageToken;
    const discoveredItems = pinnedDiscovered
      ? [pinnedDiscovered, ...catalogueResult.items.filter((item) => item.uid !== pinnedDiscovered.uid)]
      : catalogueResult.items;

    logger.debug(req, 'build_org_items', 'Built access-aware org items', {
      item_count: assignedItems.length + discoveredItems.length,
      discovered_count: discoveredItems.length,
      direct_count: this.countByPrefix(access.resolved, 'direct-'),
      cascading_count: this.countByPrefix(access.resolved, 'inherited-'),
    });

    return {
      items: [...assignedItems, ...discoveredItems],
      next_page_token: nextPageToken,
      // A failed catalogue search is reported rather than folded into an empty result: for a staff
      // caller with nothing assigned the two are indistinguishable in the list, and "no organizations
      // found" would blame the search term for an outage.
      upstream_failed: catalogueResult.failed,
      // No count is claimed for the catalogue — the caller sees what it has loaded so far.
      total: catalogueTerm ? null : assignedItems.length,
    };
  }

  /**
   * The trimmed term to search the catalogue with, or null when no catalogue query should run.
   *
   * Two conditions, both deliberate: staff only, and at least
   * `ORG_CATALOGUE_SEARCH_MIN_CHARS` characters, so a single keystroke doesn't ask the platform for
   * everything beginning with one letter. Below the minimum the assigned-row filter still applies, so
   * a one-character search behaves exactly as it does today.
   */
  private catalogueSearchTerm(isStaff: boolean, name: string | undefined): string | null {
    if (!isStaff) return null;
    const trimmed = name?.trim() ?? '';
    return trimmed.length >= ORG_CATALOGUE_SEARCH_MIN_CHARS ? trimmed : null;
  }

  /**
   * Catalogue half of a staff search: organizations the caller holds no role of their own on.
   *
   * Carries no membership filter — non-members are returned deliberately and marked in the UI, since
   * renewal and win-back lookups are a primary staff use case — and no analytics-coverage filter, so
   * an org with no Org Lens data is offered and its views render their existing empty states. No
   * caller-supplied filter of any kind: query-service
   * authorizes every result individually, so a caller without the staff grant would see only their
   * own organizations even if this query were issued for them.
   *
   * Fails soft on the rows but not on the fact: the caller keeps their assigned rows rather than
   * losing the whole switcher to a catalogue outage, and `failed` is reported so the caller can say
   * the search broke instead of presenting an outage as "no matches".
   *
   * Skips ahead through pages whose every row is already an assigned row. Upstream builds its cursor
   * before this dedupe, so such a page can arrive with a live token; handing that token back with no
   * rows would append nothing, and the client's viewport sentinel only re-arms when the row it sits
   * near is recreated. Paging would stop for good with matches still unread. Bounded by
   * `ORG_CATALOGUE_FILTERED_PAGE_SKIP_CAP` so a pathological term cannot walk the whole catalogue.
   */
  private async fetchCatalogueMatches(
    req: Request,
    term: string,
    pageToken: string | undefined,
    assignedItems: OrgItem[]
  ): Promise<{ items: OrgItem[]; nextPageToken: string | null; failed: boolean }> {
    // Deduped against the caller's whole assigned universe, not just the rows on this page, so a
    // catalogue hit can never mask the role they hold — including on continuation pages, where the
    // assigned rows are absent from the response but still theirs.
    const assignedUids = new Set(assignedItems.map((item) => item.uid));
    let token = pageToken;

    for (let attempt = 0; attempt < ORG_CATALOGUE_FILTERED_PAGE_SKIP_CAP; attempt += 1) {
      const query: OrgItemsQuery = { type: 'b2b_org', name: term, sort: 'best_match', filters: [] };
      if (token) query.page_token = token;

      let response: QueryServiceResponse<B2bOrgIndexedDoc>;
      try {
        response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<B2bOrgIndexedDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', query);
      } catch (error) {
        logger.warning(req, 'get_org_items', 'Catalogue search failed; returning assigned rows only', { err: error });
        return { items: [], nextPageToken: null, failed: true };
      }

      const discovered: OrgItem[] = [];
      for (const resource of response?.resources ?? []) {
        const uid = this.extractUid(resource.id);
        if (!uid || !resource.data || assignedUids.has(uid)) continue;
        discovered.push(this.toDiscoveredItem(uid, resource.data));
      }

      const next = response?.page_token ?? null;
      if (discovered.length > 0 || next === null) {
        return { items: this.applyPrefixRank(discovered, term), nextPageToken: next, failed: false };
      }

      token = next;
    }

    // Cap reached: every page so far held only the caller's own organizations. The token is still
    // handed back so nothing is silently truncated, at the cost of the client needing another
    // sentinel hit to continue.
    logger.warning(req, 'get_org_items', 'Catalogue skip-ahead cap reached; all pages held only assigned rows', {
      skipped_pages: ORG_CATALOGUE_FILTERED_PAGE_SKIP_CAP,
    });
    return { items: [], nextPageToken: token ?? null, failed: false };
  }

  /**
   * Float rows whose name starts with the search term, the same rank the assigned half already gets
   * from `applySort`. Upstream `best_match` scores over more than the visible name, so an exact
   * typeahead target can land below rows with no visible relation to what was typed.
   *
   * Ties keep upstream order rather than falling back to alphabetical: within a rank band the
   * relevance score is the better signal, and discarding it would defeat asking for `best_match` at
   * all. Sorting is stable (ES2019), so a `0` comparison preserves the response order.
   *
   * Scope: one page. A stronger match on a later page still arrives later — acceptable for typeahead,
   * where the first page is what the caller reads.
   */
  private applyPrefixRank(items: OrgItem[], term: string): OrgItem[] {
    const trimmed = term.trim().toLowerCase();
    if (!trimmed) return items;
    return [...items].sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(trimmed) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(trimmed) ? 0 : 1;
      return aStarts - bStarts;
    });
  }

  /**
   * Resolve a single catalogue org by uid, for a staff caller's restored selection.
   *
   * Keyed on the `b2b_org_uid` tag rather than the name search, because the caller's cookie carries a
   * uid and nothing else. `selectedUid` reaches here already checked against the filter-safe
   * allowlist by the controller, so it is safe to interpolate into the tag. Fails soft: a caller who
   * cannot be shown their previous selection still gets a working switcher.
   */
  private async fetchDiscoveredOrgByUid(req: Request, uid: string): Promise<OrgItem | null> {
    try {
      const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<B2bOrgIndexedDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'b2b_org',
        tags: [`b2b_org_uid:${uid}`],
        per_page: 1,
      });

      for (const resource of response?.resources ?? []) {
        const resolvedUid = this.extractUid(resource.id);
        if (resolvedUid === uid && resource.data) {
          return this.toDiscoveredItem(resolvedUid, resource.data);
        }
      }
    } catch (error) {
      logger.warning(req, 'get_org_items', 'Could not resolve the restored selection from the catalogue', { err: error });
    }
    return null;
  }

  private toDiscoveredItem(uid: string, doc: B2bOrgIndexedDoc): OrgItem {
    return {
      uid,
      accountId: uid,
      name: doc.name ?? '',
      logoUrl: doc.logo_url ?? null,
      primaryDomain: doc.primary_domain ?? null,
      isMember: doc.is_member ?? false,
      parentName: null,
      status: doc.status ?? null,
      isAssigned: false,
    };
  }

  /** Strip the `<type>:` prefix query-service prepends on `resource.id`; account ids (SFIDs) contain no colon. */
  private extractUid(resourceId: string | undefined | null): string {
    if (!resourceId) return '';
    const colonIdx = resourceId.indexOf(':');
    return colonIdx === -1 ? resourceId : resourceId.substring(colonIdx + 1);
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
        status: doc.status ?? null,
        // Set explicitly rather than left to be inferred: grants and items load
        // independently on the client, so inference would flip rows between sections mid-render.
        isAssigned: true,
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
