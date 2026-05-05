// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectFunding, ProjectStage } from '@lfx-one/shared/enums';
import { GetLensItemsParams, LensItem, LensItemsQuery, LensItemsResponse, NavLens, Project, QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { computeIsFoundation } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/** Stages eligible for the project lens — Active plus supported pre-launch formation stages. */
const PROJECT_LENS_ALLOWED_STAGES = new Set<string>([ProjectStage.Active, ProjectStage.FormationEngaged, ProjectStage.FormationExploratory]);

/** Powers the foundation/project lens dropdown. Access is gated entirely by the user's bearer token via the query service. */
export class NavigationService {
  private readonly microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
  }

  public async getLensItems(req: Request, params: GetLensItemsParams): Promise<LensItemsResponse> {
    const { lens, pageToken, name, selectedUid } = params;

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
        const selectedItem = await this.fetchSelectedItem(req, lens, selectedUid);
        if (selectedItem) {
          items.unshift(selectedItem);
        }
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

  private async fetchSelectedItem(req: Request, lens: NavLens, uid: string): Promise<LensItem | null> {
    try {
      const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Project>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'project',
        filters: [`uid:${uid}`],
      });
      const project = response?.resources?.[0]?.data;
      if (!project) return null;
      // Mirror the main-pipeline contract so an archived selection doesn't get re-injected.
      if (lens === 'foundation') {
        if (!computeIsFoundation(project)) return null;
      } else {
        if (!PROJECT_LENS_ALLOWED_STAGES.has(project.stage)) return null;
      }
      return this.toLensItem(project);
    } catch (error) {
      logger.warning(req, 'fetch_selected_item', 'Failed to fetch selected lens item', { err: error, uid, lens });
      return null;
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
    };
  }
}
