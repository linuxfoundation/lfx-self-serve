// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FORMATION_PIPELINE_MAX_ANCESTRY_DEPTH,
  FORMATION_PIPELINE_STAGE_UPSTREAM,
  FORMATION_PIPELINE_STAGES,
  FORMATION_TEAM_REQUIRED_CODE,
  LF_FOUNDATION_ROOT_SLUG,
  QUERY_SERVICE_FILTERS_OR_BATCH_SIZE,
  QUERY_SERVICE_MAX_PAGE_SIZE,
} from '@lfx-one/shared/constants';
import type {
  FormationPipelineFoundationKind,
  FormationPipelineParent,
  FormationPipelinePerson,
  FormationPipelineQuery,
  FormationPipelineResponse,
  FormationPipelineRow,
  QueryServiceResponse,
  UpstreamFormationQueueRow,
  UpstreamPipelineProject,
  UpstreamPipelineSettings,
  UserInfo,
} from '@lfx-one/shared/interfaces';
import {
  chunkArray,
  comparePipelineText,
  computeIsFoundation,
  countPipelineRows,
  getPipelineStageKey,
  isTestProjectName,
  matchesPipelineSearch,
  normalizePipelineClassification,
} from '@lfx-one/shared/utils';
import { Request } from 'express';

import { AuthorizationError } from '../errors';
import { checkFormationTeamMembership } from '../helpers/formation-team.helper';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { collapseRootParentUid, resolveRootProjectUid } from '../helpers/root-project.helper';
import { AccessCheckService } from './access-check.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { NatsService } from './nats.service';

/**
 * The formation team's project pipeline (#5475): every non-Active project by stage, read through
 * query-service. Guarded by `team:formation` membership, checked before any upstream read.
 */
export class FormationPipelineService {
  private readonly microserviceProxy = new MicroserviceProxyService();
  private readonly accessCheckService = new AccessCheckService();
  private readonly natsService = new NatsService();

  /**
   * `GET /api/formations/pipeline`. Reads, in order: `type=project` for every pipeline stage (counts need them all,
   * whatever `stages` selects) → parent projects (names, and the ancestor chain for `foundationUid`) →
   * `type=project_settings` for the returned uids → `type=formation` for `has_checklist`. Every read is
   * `failOnPartial`, so a failed page or batch fails the request instead of rendering a short table.
   */
  public async getPipeline(req: Request, query: FormationPipelineQuery): Promise<FormationPipelineResponse> {
    const operation = 'get_formation_pipeline';

    // The guard runs before any upstream read. checkSingleAccess fails closed.
    if (!(await checkFormationTeamMembership(this.accessCheckService, req))) {
      throw new AuthorizationError('Only the formation team can see the pipeline.', {
        operation,
        service: 'formation_pipeline',
        code: FORMATION_TEAM_REQUIRED_CODE,
      });
    }

    const rootUid = await resolveRootProjectUid(req, this.natsService);
    const projects = await this.fetchPipelineProjects(req);
    const parents = await this.resolveParents(req, projects, rootUid, query.foundationUid);

    // Test projects and everything under them never reach rows, counts or the CSV (#5619).
    const scoped = projects.filter(
      (project) =>
        this.inScope(project, parents, rootUid, query) && !this.isTestProject(project, parents, rootUid) && matchesPipelineSearch(project.name, query.search)
    );
    const baseRows = scoped.map((project) => this.toRow(project, parents, rootUid));

    // Counts ignore the stage selection, so they come before it is applied; the UI derives its own counts from the rows after its client-side search.
    const counts = countPipelineRows(baseRows);
    const selected = baseRows.filter((row) => query.stages.includes(row.stage));
    const selectedUids = selected.map((row) => row.uid);

    const [settingsByUid, checklistUids] = await Promise.all([this.fetchSettings(req, selectedUids), this.fetchChecklistUids(req, selectedUids)]);

    const rows = selected
      .map((row) => {
        const settings = settingsByUid.get(row.uid);
        return {
          ...row,
          announcement_date: settings?.announcement_date || null,
          executive_director: this.toPerson(settings?.executive_director),
          program_manager: this.toPerson(settings?.program_manager),
          opportunity_owner: this.toPerson(settings?.opportunity_owner),
          formation_lead: this.toPerson(settings?.formation_lead),
          has_checklist: checklistUids.has(row.uid),
        };
      })
      .sort((a, b) => comparePipelineText(a.name, b.name));

    logger.debug(req, operation, 'Built formation pipeline', { row_count: rows.length, total: counts.total, foundation_scoped: !!query.foundationUid });
    return { rows, counts };
  }

  /** The three fields of a settings person the table shows; anything else query-service returned is dropped. */
  private toPerson(user: UserInfo | null | undefined): FormationPipelinePerson | null {
    if (!user || (!user.name && !user.email && !user.username)) {
      return null;
    }
    return { name: user.name ?? '', email: user.email ?? '', ...(user.username && { username: user.username }) };
  }

  /** Every `type=project` document in a pipeline stage (Active is never requested). */
  private async fetchPipelineProjects(req: Request): Promise<UpstreamPipelineProject[]> {
    const stageFilters = FORMATION_PIPELINE_STAGES.map((stage) => `stage:${FORMATION_PIPELINE_STAGE_UPSTREAM[stage]}`);
    return fetchAllQueryResources<UpstreamPipelineProject>(
      req,
      (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<UpstreamPipelineProject>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'project',
          filters_or: stageFilters,
          page_size: QUERY_SERVICE_MAX_PAGE_SIZE,
          ...(pageToken && { page_token: pageToken }),
        }),
      { failOnPartial: true }
    );
  }

  /**
   * The ancestors the rows need, one level of the hierarchy per round, each round batched (`filters_or=uid:…`, up to 100
   * uids per read) rather than read per row. A row's foundation is its nearest ancestor that `computeIsFoundation` classifies as a foundation, which is often
   * not its direct parent (a pipeline project under an Active project under a foundation), so the walk climbs until
   * every row has met one. With `foundationUid` it climbs until each row reaches that foundation (or the chain ends), so
   * the subtree filter can see through intermediate projects. The `project` document carries only its direct parent, so
   * there is no ancestor array to read instead. The depth cap bounds it.
   *
   * A failed read fails the request. An ancestor query-service returns no document for is logged (a formation-team
   * member holds `global_owner` on every project, so a missing one is a data problem); its rows stay in "All
   * foundations" with no foundation and drop out only when a foundation filter is on. Reaching the depth cap is logged.
   */
  private async resolveParents(
    req: Request,
    projects: readonly UpstreamPipelineProject[],
    rootUid: string | null,
    foundationUid?: string
  ): Promise<Map<string, UpstreamPipelineProject>> {
    // Pipeline rows that are themselves ancestors are already in hand.
    const known = new Map<string, UpstreamPipelineProject>(projects.map((project) => [project.uid, project]));
    const missing = new Set<string>();
    let needed = this.unresolvedAncestors(projects, known, missing, rootUid, foundationUid);

    for (let depth = 0; needed.size > 0 && depth < FORMATION_PIPELINE_MAX_ANCESTRY_DEPTH; depth++) {
      const fetched = await this.fetchProjectsByUids(req, [...needed]);
      for (const uid of needed) {
        const ancestor = fetched.get(uid);
        if (ancestor) {
          known.set(uid, ancestor);
        } else {
          missing.add(uid);
        }
      }
      needed = this.unresolvedAncestors(projects, known, missing, rootUid, foundationUid);
    }

    if (needed.size > 0) {
      logger.warning(req, 'get_formation_pipeline', 'Parent walk stopped at the depth cap', {
        parent_uids: [...needed],
        max_depth: FORMATION_PIPELINE_MAX_ANCESTRY_DEPTH,
      });
    }
    for (const uid of missing) {
      logger.warning(req, 'get_formation_pipeline', 'Parent project not returned by query-service', { parent_uid: uid, foundation_scoped: !!foundationUid });
    }
    return known;
  }

  /** Ancestor uids still to fetch: each row's chain is followed until a stop (a foundation, or `foundationUid` when set) and the first unknown uid on it is collected. */
  private unresolvedAncestors(
    projects: readonly UpstreamPipelineProject[],
    known: ReadonlyMap<string, UpstreamPipelineProject>,
    missing: ReadonlySet<string>,
    rootUid: string | null,
    foundationUid?: string
  ): Set<string> {
    const needed = new Set<string>();
    for (const project of projects) {
      const seen = new Set<string>();
      let uid = collapseRootParentUid(project.parent_uid || null, rootUid);
      while (uid && !seen.has(uid)) {
        seen.add(uid);
        const node = known.get(uid);
        if (!node) {
          if (!missing.has(uid)) {
            needed.add(uid);
          }
          break;
        }
        if (foundationUid ? uid === foundationUid : this.isFoundation(node)) {
          break;
        }
        uid = collapseRootParentUid(node.parent_uid || null, rootUid);
      }
    }
    return needed;
  }

  /**
   * Whether a project document is a foundation. `is_foundation` is not stored on the index document: the BFF derives it
   * everywhere with `computeIsFoundation` from the stage, legal entity type, funding and funding model, all of which the
   * `type=project` read returns (indexer-contract: `stage`, `legal_entity_type`, `funding`, `funding_model`).
   */
  private isFoundation(project: UpstreamPipelineProject): boolean {
    return computeIsFoundation({
      name: project.name,
      stage: project.stage ?? '',
      legal_entity_type: project.legal_entity_type ?? '',
      funding: project.funding,
      funding_model: project.funding_model ?? [],
    });
  }

  /**
   * Whether a project is a PCC test project or sits under one: its own name, or the name of any ancestor in the chain `resolveParents` loaded.
   * That chain stops at the first foundation (the test projects are foundations by name, so a descendant of one reaches it), so a project
   * separated from a test project by another real foundation is not recognised. The test group's children are the test projects themselves,
   * so that shape does not occur; climbing past every foundation would cost extra reads on every row for it.
   */
  private isTestProject(project: UpstreamPipelineProject, known: ReadonlyMap<string, UpstreamPipelineProject>, rootUid: string | null): boolean {
    if (isTestProjectName(project.name)) {
      return true;
    }
    const seen = new Set<string>();
    let uid = collapseRootParentUid(project.parent_uid || null, rootUid);
    while (uid && !seen.has(uid)) {
      seen.add(uid);
      const node = known.get(uid);
      if (!node) {
        return false;
      }
      if (isTestProjectName(node.name)) {
        return true;
      }
      uid = collapseRootParentUid(node.parent_uid || null, rootUid);
    }
    return false;
  }

  /** The nearest foundation ancestor of a project (never the project itself), or `null` when its chain holds none. */
  private nearestFoundation(
    project: UpstreamPipelineProject,
    known: ReadonlyMap<string, UpstreamPipelineProject>,
    rootUid: string | null
  ): FormationPipelineParent | null {
    const seen = new Set<string>();
    let uid = collapseRootParentUid(project.parent_uid || null, rootUid);
    while (uid && !seen.has(uid)) {
      seen.add(uid);
      const node = known.get(uid);
      if (!node) {
        return null;
      }
      if (this.isFoundation(node)) {
        return { uid, name: node.name };
      }
      uid = collapseRootParentUid(node.parent_uid || null, rootUid);
    }
    return null;
  }

  /** `type=project` documents for the uids, in batches of the filters_or limit. Any failed read throws. */
  private async fetchProjectsByUids(req: Request, uids: readonly string[]): Promise<Map<string, UpstreamPipelineProject>> {
    const batches = await Promise.all(
      chunkArray(uids, QUERY_SERVICE_FILTERS_OR_BATCH_SIZE).map((batch) =>
        fetchAllQueryResources<UpstreamPipelineProject>(
          req,
          (pageToken) =>
            this.microserviceProxy.proxyRequest<QueryServiceResponse<UpstreamPipelineProject>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
              type: 'project',
              filters_or: batch.map((uid) => `uid:${uid}`),
              // page_size must exceed the batch: query-service emits a page_token whenever hits == page_size.
              page_size: batch.length + 1,
              ...(pageToken && { page_token: pageToken }),
            }),
          { failOnPartial: true }
        )
      )
    );
    return new Map(batches.flat().map((project) => [project.uid, project]));
  }

  /** Whether a project is a known pipeline stage and, when `foundationUid` is set, is that foundation or sits under it. */
  private inScope(
    project: UpstreamPipelineProject,
    parents: ReadonlyMap<string, UpstreamPipelineProject>,
    rootUid: string | null,
    query: FormationPipelineQuery
  ): boolean {
    if (!getPipelineStageKey(project.stage)) {
      return false;
    }
    if (!query.foundationUid || project.uid === query.foundationUid) {
      return true;
    }
    const seen = new Set<string>();
    let parentUid = collapseRootParentUid(project.parent_uid || null, rootUid);
    while (parentUid && !seen.has(parentUid)) {
      if (parentUid === query.foundationUid) {
        return true;
      }
      seen.add(parentUid);
      parentUid = collapseRootParentUid(parents.get(parentUid)?.parent_uid || null, rootUid);
    }
    return false;
  }

  /**
   * Where the project sits by its DIRECT parent (#5619), not by `computeIsFoundation`, which formation-stage projects almost never pass:
   * `under_lf` when the parent is The Linux Foundation, `under_foundation` for any other parent, `no_parent` when there is none (a
   * parent that is the hidden ROOT counts as none). The parent's document comes from the chain `resolveParents` already loaded; one
   * query-service did not return cannot be identified as The Linux Foundation, so it reads as another parent.
   */
  private foundationKind(
    project: UpstreamPipelineProject,
    known: ReadonlyMap<string, UpstreamPipelineProject>,
    rootUid: string | null
  ): FormationPipelineFoundationKind {
    const parentUid = collapseRootParentUid(project.parent_uid || null, rootUid);
    if (!parentUid) {
      return 'no_parent';
    }
    return known.get(parentUid)?.slug === LF_FOUNDATION_ROOT_SLUG ? 'under_lf' : 'under_foundation';
  }

  private toRow(project: UpstreamPipelineProject, parents: ReadonlyMap<string, UpstreamPipelineProject>, rootUid: string | null): FormationPipelineRow {
    const parent = this.nearestFoundation(project, parents, rootUid);
    return {
      uid: project.uid,
      slug: project.slug,
      name: project.name,
      stage: getPipelineStageKey(project.stage) as FormationPipelineRow['stage'],
      parent,
      foundation_kind: this.foundationKind(project, parents, rootUid),
      announcement_date: null,
      formation_date: project.formation_date || null,
      legal_entity_name: project.legal_entity_name || null,
      legal_entity_type: project.legal_entity_type || null,
      executive_director: null,
      program_manager: null,
      opportunity_owner: null,
      formation_lead: null,
      technical_activity_type: normalizePipelineClassification(project.technical_activity_type),
      technology: normalizePipelineClassification(project.technology),
      industry: normalizePipelineClassification(project.industry),
      created_at: project.created_at || null,
      updated_at: project.updated_at || null,
      has_checklist: false,
    };
  }

  /** `type=project_settings` for the uids, in chunks, joined by uid. A project with no settings document is simply absent from the map. */
  private async fetchSettings(req: Request, uids: readonly string[]): Promise<Map<string, UpstreamPipelineSettings>> {
    const batches = await Promise.all(
      chunkArray(uids, QUERY_SERVICE_FILTERS_OR_BATCH_SIZE).map((batch) =>
        fetchAllQueryResources<UpstreamPipelineSettings>(
          req,
          (pageToken) =>
            this.microserviceProxy.proxyRequest<QueryServiceResponse<UpstreamPipelineSettings>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
              type: 'project_settings',
              filters_or: batch.map((uid) => `uid:${uid}`),
              // page_size must exceed the batch: query-service emits a page_token whenever hits == page_size.
              page_size: batch.length + 1,
              ...(pageToken && { page_token: pageToken }),
            }),
          { failOnPartial: true }
        )
      )
    );
    return new Map(batches.flat().map((settings) => [settings.uid, settings]));
  }

  /** Uids that have a `formation` checklist document, whatever its lifecycle. */
  private async fetchChecklistUids(req: Request, uids: readonly string[]): Promise<Set<string>> {
    const batches = await Promise.all(
      chunkArray(uids, QUERY_SERVICE_FILTERS_OR_BATCH_SIZE).map((batch) =>
        fetchAllQueryResources<UpstreamFormationQueueRow>(
          req,
          (pageToken) =>
            this.microserviceProxy.proxyRequest<QueryServiceResponse<UpstreamFormationQueueRow>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
              type: 'formation',
              // Any lifecycle counts (live, completed or frozen): a Disengaged project's checklist is frozen but still readable.
              tags: batch.map((uid) => `project_uid:${uid}`),
              page_size: batch.length + 1,
              ...(pageToken && { page_token: pageToken }),
            }),
          { failOnPartial: true }
        )
      )
    );
    return new Set(batches.flat().map((row) => row.project_uid));
  }
}

export const formationPipelineService = new FormationPipelineService();
