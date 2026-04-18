// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LENS_PERSONA_MAP, NAV_MAX_UPSTREAM_ITERATIONS, NAV_MIN_ITEMS_PER_RESPONSE } from '@lfx-one/shared/constants';
import {
  EnrichedPersonaProject,
  GetLensItemsParams,
  LensItem,
  LensItemsQuery,
  LensItemsResponse,
  NavLens,
  PersonaApiResponse,
  PersonaType,
  Project,
  QueryServiceResponse,
} from '@lfx-one/shared/interfaces';
import { computeIsFoundation } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { personaDetectionService } from '../utils/persona-helper';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/** Powers the foundation/project lens dropdown. Root writers bypass the persona filter. */
export class NavigationService {
  private readonly microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
  }

  public async getLensItems(req: Request, params: GetLensItemsParams): Promise<LensItemsResponse> {
    const { lens, pageToken, name } = params;

    // Parallel: root-writer check + first upstream page. Deferring persona fetch saves the
    // NATS roundtrip for admins (the hot path).
    const [bypassActive, firstPage] = await Promise.all([personaDetectionService.checkRootWriter(req), this.fetchUpstreamPage(req, lens, pageToken, name)]);

    let persona: PersonaApiResponse | null = null;
    let personaFetchFailed = false;
    if (!bypassActive) {
      const personaResult = await this.fetchPersona(req);
      persona = personaResult.persona;
      personaFetchFailed = personaResult.failed;
    }

    // Fail closed: a persona-fetch failure must not fall through to unfiltered lens items.
    // The frontend surfaces the "Unable to load" toast when items is empty + persona_fetch_failed.
    if (!bypassActive && personaFetchFailed) {
      logger.warning(req, 'build_lens_items', 'Persona fetch failed, returning empty lens items to fail closed', { lens });
      return {
        items: [],
        next_page_token: null,
        bypass_active: false,
        persona_fetch_failed: true,
        upstream_failed: firstPage.failed,
        lens,
      };
    }

    const shouldFilter = !bypassActive && !!persona;
    const eligibleUids = shouldFilter && persona ? this.collectEligibleProjectUids(persona.projects, LENS_PERSONA_MAP[lens]) : null;

    // targetCount=0 when filtering with no eligible projects skips the loop body entirely.
    const targetCount = eligibleUids ? eligibleUids.size : NAV_MIN_ITEMS_PER_RESPONSE;

    const accumulated: LensItem[] = [];
    let iterations = 0;
    let lastToken: string | null = null;
    let upstreamFailed = firstPage.failed;
    let currentResponse: QueryServiceResponse<Project> | null = firstPage.response;

    while (currentResponse && accumulated.length < targetCount && iterations < NAV_MAX_UPSTREAM_ITERATIONS) {
      iterations += 1;
      const pageItems = this.filterPageResources(currentResponse.resources, lens, eligibleUids);
      accumulated.push(...pageItems.map((p) => this.toLensItem(p)));
      lastToken = currentResponse.page_token ?? null;

      if (!lastToken || accumulated.length >= targetCount) break;

      const next = await this.fetchUpstreamPage(req, lens, lastToken, name);
      if (next.failed) {
        upstreamFailed = true;
        lastToken = null;
        break;
      }
      currentResponse = next.response;
    }

    // With persona filtering, only suppress next-page token when we've proven completeness.
    // If the loop exited due to the iteration cap, keep the token so the client can continue.
    if (eligibleUids) {
      const fullyCollected = accumulated.length >= eligibleUids.size;
      if (fullyCollected || upstreamFailed) {
        lastToken = null;
      }
    }

    logger.debug(req, 'build_lens_items', 'Built lens items', {
      lens,
      item_count: accumulated.length,
      upstream_iterations: iterations,
      bypass_active: bypassActive,
      persona_fetch_failed: personaFetchFailed,
      upstream_failed: upstreamFailed,
      has_next_page: !!lastToken,
    });

    return {
      items: accumulated,
      next_page_token: lastToken,
      bypass_active: bypassActive,
      persona_fetch_failed: personaFetchFailed,
      upstream_failed: upstreamFailed,
      lens,
    };
  }

  private async fetchPersona(req: Request): Promise<{ persona: PersonaApiResponse | null; failed: boolean }> {
    try {
      const persona = await personaDetectionService.getPersonas(req);
      if (persona.error) {
        logger.warning(req, 'fetch_persona', 'Persona fetch returned error, falling back to lens-scoped results only', { error: persona.error });
        return { persona: null, failed: true };
      }
      return { persona, failed: false };
    } catch (error) {
      logger.warning(req, 'fetch_persona', 'Persona fetch failed, falling back to lens-scoped results only', { err: error });
      return { persona: null, failed: true };
    }
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

  private filterPageResources(resources: QueryServiceResponse<Project>['resources'], lens: NavLens, eligibleUids: Set<string> | null): Project[] {
    let projects = resources.map((r) => r.data);
    // legal_entity_type negation isn't supported by the filter grammar — re-check locally.
    if (lens === 'foundation') {
      projects = projects.filter((p) => computeIsFoundation(p));
    }
    if (eligibleUids) {
      projects = projects.filter((p) => eligibleUids.has(p.uid));
    }
    return projects;
  }

  private buildQuery(lens: NavLens, pageToken: string | undefined, name: string | undefined): LensItemsQuery {
    // legal_entity_type negation is post-filtered (filter grammar has no exclusions).
    const filters = lens === 'foundation' ? ['stage:Active', 'funding_model:Membership'] : ['stage:Active'];
    const base: LensItemsQuery = { type: 'project', filters, sort: 'name_asc' };

    if (pageToken) base.page_token = pageToken;
    if (name) base.name = name;

    return base;
  }

  private collectEligibleProjectUids(projects: EnrichedPersonaProject[], allowedPersonas: readonly PersonaType[]): Set<string> {
    const uids = new Set<string>();
    for (const project of projects) {
      if (project.personas.some((p) => allowedPersonas.includes(p))) {
        uids.add(project.projectUid);
      }
    }
    return uids;
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
