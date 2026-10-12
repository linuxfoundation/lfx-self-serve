// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { QUERY_SERVICE_FILTERS_OR_BATCH_SIZE } from '@lfx-one/shared/constants';
import { ProjectFunding, ProjectStage } from '@lfx-one/shared/enums';
import { GetLensItemsParams, LensItem, LensItemsQuery, LensItemsResponse, NavLens, Project, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { computeIsFoundation, getFormationSubStageLabel } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { fetchAllQueryResources } from '../helpers/query-service.helper';

import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Stages eligible for the project lens **listing** — Active plus supported pre-launch formation
 * stages. `FormationConfidential` is intentionally excluded from this listing set (GH-1955): the
 * name implies pre-announcement secrecy, so a Confidential project should not be listed by name
 * in the shared project picker's general (unfiltered) results.
 *
 * This set gates `buildQuery`'s listing/search results only. `fetchSelectedItem` — which exists
 * to preserve an *already-selected* item that didn't come back on the first listing page, e.g. a
 * deep link — deliberately also admits `FormationConfidential` alongside this set: a Confidential
 * project must not be evicted from an explicit prior selection just because it's hidden from the
 * general listing. Its own dashboard page renders normally for anyone already authorized to view
 * it, so the selection must survive too.
 *
 * `FormationOnHold`/`FormationDisengaged` are an accepted rollout trade-off: this set is server-side
 * and un-flagged (unlike `FORMATION_ENABLED_FLAG`, which only gates client-rendered UI), so these two
 * stages become picker-visible for every user immediately, before any Formation-specific labeling
 * ships to a given user. This doesn't widen data access — the picker is a UX convenience list over
 * projects the caller can already reach by direct link, not an authorization boundary — but it does
 * mean an On Hold/Disengaged project can appear in the picker unlabeled ahead of the flagged UI. A
 * server-side kill switch (mirroring `ServerFeatureFlag.WeeklyBriefSlack`) would close that gap but
 * is out of this ticket's scope.
 */
const PROJECT_LENS_ALLOWED_STAGES = new Set<string>([
  ProjectStage.Active,
  ProjectStage.FormationEngaged,
  ProjectStage.FormationExploratory,
  ProjectStage.FormationOnHold,
  ProjectStage.FormationDisengaged,
]);

/** Powers the foundation/project lens dropdown. Access is gated entirely by the user's bearer token via the query service. */
export class NavigationService {
  private readonly microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
  }

  public async getLensItems(req: Request, params: GetLensItemsParams): Promise<LensItemsResponse> {
    const { lens, pageToken, name, selectedUid, favoritedUids } = params;

    const firstPage = await this.fetchUpstreamPage(req, lens, pageToken, name);

    if (firstPage.failed || !firstPage.response) {
      return {
        items: [],
        next_page_token: null,
        upstream_failed: true,
        lens,
      };
    }

    const projects = this.filterPageResources(firstPage.response.resources, lens);
    const items: LensItem[] = projects.map((p) => this.toLensItem(p));
    const nextPageToken: string | null = firstPage.response.page_token ?? null;

    // Ensure the selected project is in the first-page response so navigation from
    // other lenses (e.g., Me → Open) doesn't get overridden by the default picker.
    if (selectedUid && !pageToken) {
      const alreadyIncluded = items.some((item) => item.uid === selectedUid);
      if (!alreadyIncluded) {
        const [selectedItem] = await this.fetchItemsByUids(req, lens, [selectedUid], { allowConfidential: true });
        if (selectedItem) {
          items.unshift(selectedItem);
        }
      }
    }

    // Ensure favorited items are in the first-page (browse) response, even on a page they haven't
    // loaded into yet, so the client's favorite-floats-to-top sort (GH-2995) has something to float.
    // Scoped to the browse list only — during search, a non-matching favorite would just be noise.
    if (favoritedUids?.length && !pageToken && !name?.trim()) {
      const missingUids = favoritedUids.filter((uid) => uid !== selectedUid && !items.some((item) => item.uid === uid));
      if (missingUids.length) {
        // allowConfidential: false — unlike an explicit selectedUid pin, a favorite shouldn't
        // resurrect a confidential-stage project into the general browse list (GH-3456 review).
        const favoriteItems = await this.fetchItemsByUids(req, lens, missingUids, { allowConfidential: false });
        items.push(...favoriteItems);
      }
    }

    logger.debug(req, 'build_lens_items', 'Built lens items', {
      lens,
      item_count: items.length,
      has_next_page: !!nextPageToken,
    });

    return {
      items,
      next_page_token: nextPageToken,
      upstream_failed: false,
      lens,
    };
  }

  private async fetchUpstreamPage(
    req: Request,
    lens: NavLens,
    pageToken: string | undefined,
    name: string | undefined
  ): Promise<{ response: QueryServiceResponse<Project> | null; failed: boolean }> {
    const query = this.buildQuery(lens, pageToken, name);
    try {
      const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Project>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', query);
      return { response, failed: false };
    } catch (error) {
      logger.warning(req, 'fetch_upstream_page', 'Upstream query failed', { err: error, lens, has_page_token: !!pageToken });
      return { response: null, failed: true };
    }
  }

  /**
   * Fetches specific projects by uid (a prior selection, or favorites not yet loaded into the
   * current page). Chunks at `QUERY_SERVICE_FILTERS_OR_BATCH_SIZE` and follows pagination within
   * each batch via `fetchAllQueryResources` — mirrors `ProjectService.getProjectsByIds` — so a
   * caller passing more than query-service's default page size (50) isn't silently truncated.
   *
   * `allowConfidential` keeps the FormationConfidential exception scoped to an explicit
   * `selectedUid` pin: the listing hides that stage, but a caller's own current selection must
   * survive it. A favorite must not get the same pass — otherwise a stored favorite uid can
   * resurrect a confidential-stage project into the general browse list (GH-3456 review).
   */
  private async fetchItemsByUids(req: Request, lens: NavLens, uids: string[], options: { allowConfidential: boolean }): Promise<LensItem[]> {
    const batches: string[][] = [];
    for (let i = 0; i < uids.length; i += QUERY_SERVICE_FILTERS_OR_BATCH_SIZE) {
      batches.push(uids.slice(i, i + QUERY_SERVICE_FILTERS_OR_BATCH_SIZE));
    }

    const batchResults = await Promise.all(batches.map((batch) => this.fetchItemsByUidsBatch(req, lens, batch)));
    const projects = batchResults.flat();

    // Mirror the main-pipeline contract so an archived item doesn't get re-injected.
    return projects
      .filter((project) =>
        lens === 'foundation'
          ? computeIsFoundation(project)
          : PROJECT_LENS_ALLOWED_STAGES.has(project.stage) || (options.allowConfidential && project.stage === ProjectStage.FormationConfidential)
      )
      .map((project) => this.toLensItem(project));
  }

  private async fetchItemsByUidsBatch(req: Request, lens: NavLens, batch: string[]): Promise<Project[]> {
    try {
      return await fetchAllQueryResources<Project>(
        req,
        (pageToken) =>
          this.microserviceProxy.proxyRequest<QueryServiceResponse<Project>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
            type: 'project',
            filters: [],
            filters_or: batch.map((uid) => `uid:${uid}`),
            // One call per batch — see ProjectService.fetchProjectBatchByIds for why page_size must exceed the batch size.
            page_size: String(batch.length + 1),
            ...(pageToken && { page_token: pageToken }),
          }),
        { failOnPartial: false }
      );
    } catch (error) {
      logger.warning(req, 'fetch_items_by_uids', 'Failed to fetch a batch of pinned lens items', { err: error, batch_size: batch.length, lens });
      return [];
    }
  }

  private filterPageResources(resources: QueryServiceResponse<Project>['resources'], lens: NavLens): Project[] {
    let projects = resources.map((r) => r.data);
    // legal_entity_type negation isn't supported by the filter grammar — re-check locally.
    if (lens === 'foundation') {
      projects = projects.filter((p) => computeIsFoundation(p));
    }
    return projects;
  }

  private buildQuery(lens: NavLens, pageToken: string | undefined, name: string | undefined): LensItemsQuery {
    // Normalize once: whitespace-only `name` (e.g. ?name=%20) shouldn't flip sort to best_match
    // or forward a meaningless query upstream. Treat empty-after-trim as no search.
    const trimmedName = name?.trim();
    // legal_entity_type negation is post-filtered (filter grammar has no exclusions).
    // Switch to relevance ordering whenever the user is searching — alphabetical sort would bury
    // an exact match (e.g. "LF Products") under every other prefix-matching project.
    const base: LensItemsQuery = { type: 'project', filters: [], sort: trimmedName ? 'best_match' : 'name_asc' };
    if (lens === 'foundation') {
      // Funding + membership required (AND); Active or Formation - Engaged accepted (OR).
      // This ensures pre-launch foundations appear in the dropdown before they go Active.
      base.filters = [`funding:${ProjectFunding.Funded}`, 'funding_model:Membership'];
      base.filters_or = [`stage:${ProjectStage.Active}`, `stage:${ProjectStage.FormationEngaged}`];
    } else {
      // Include active projects plus supported pre-launch formation stages so
      // pre-launch projects appear in the project dropdown.
      base.filters_or = [...PROJECT_LENS_ALLOWED_STAGES].map((stage) => `stage:${stage}`);
    }

    if (pageToken) base.page_token = pageToken;
    if (trimmedName) base.name = trimmedName;

    return base;
  }

  private toLensItem(project: Project): LensItem {
    return {
      uid: project.uid,
      slug: project.slug,
      name: project.name,
      logoUrl: project.logo_url || null,
      isFoundation: computeIsFoundation(project),
      formationSubStage: getFormationSubStageLabel(project.stage),
    };
  }
}
