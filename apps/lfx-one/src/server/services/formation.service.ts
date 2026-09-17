// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  FormationChecklistResponse,
  FormationItem,
  FormationItemDetail,
  FormationItemMapContext,
  FormationItemStatus,
  FormationItemWriteState,
  FormationQueueRow,
  FormationsQueueResponse,
  FormationSubStage,
  MyFormationItemRow,
  MyFormationSummary,
  MyFormationWorkResponse,
  MyFormationWorkState,
  Project,
  UpstreamFormationActivityPage,
  UpstreamFormationChecklist,
  UpstreamFormationItem,
  UpstreamFormationItemRow,
  UpstreamFormationQueueRow,
} from '@lfx-one/shared/interfaces';
import { FORMATION_QUEUE_SUB_STAGES } from '@lfx-one/shared/constants';
import { QueryServiceResponse } from '@lfx-one/shared/interfaces';
import {
  deriveFormationEntityType,
  isAssignedItemOpen,
  isFormationLifecycleLive,
  isFormationStageGate,
  isPostFormationStage,
  normalizeFormationLifecycle,
  normalizeFormationSubStage,
  summarizeMyFormationItems,
} from '@lfx-one/shared/utils';
import { Request } from 'express';

import { isMicroserviceError, PreconditionFailedError, ResourceNotFoundError, ServiceValidationError, ConflictError, InvalidRequestError } from '../errors';
import { fetchItemFormationActivity, FORMATION_ACTIVITY_PAGE_LIMIT } from '../helpers/formation-activity.helper';
import {
  deriveItemAction,
  mapUpstreamFormationChecklist,
  mapUpstreamFormationItem,
  resolveActionHref,
  sectionTitlesFromChecklist,
} from '../helpers/formation-mapper.helper';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { collapseRootParentUid, resolveLfFoundationRootUid, resolveRootProjectUid } from '../helpers/root-project.helper';
import { stripAuthPrefix } from '../utils/auth-helper';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { NatsService } from './nats.service';
import { ProjectService } from './project.service';

/**
 * BFF service for the Formation Checklist section and Formations queue (GH-1958/GH-2267/GH-2576).
 * The three real write routes ({@link updateFormationItem}, {@link updateFormationItemAssignment},
 * {@link updateFormationItemStatus} — `PATCH .../items/{item_key}`, `POST .../assignment`,
 * `POST .../status`), the queue read {@link getFormationsQueue}, and
 * {@link getProjectFormation}'s checklist read all call the real `lfx-v2-formation-service`
 * unconditionally. GH-2576 Phase 2 replaced the earlier speculative six-route/`awaiting_acceptance`
 * write model (complete/skip/request/accept/reject/reopen) with these three, matching the contract
 * `lfx-v2-formation-service` actually shipped at tag v0.1.4. {@link getFormationItemDetail} wires
 * the real activity feed (`GET /formations/{project_uid}/activity`, GH-2372) — see
 * {@link fetchItemActivityOrDegrade}.
 */
export class FormationService {
  private readonly projectService = new ProjectService();
  private readonly natsService = new NatsService();
  private readonly microserviceProxy = new MicroserviceProxyService();
  /**
   * The real 5-value status enum (`internal/domain/model/status.go`, `lfx-v2-formation-service`
   * v0.1.4) — used only to validate the shape of an incoming `status` field before forwarding it;
   * the transition graph itself is upstream's to enforce (`invalid_transition`), not duplicated here.
   */
  private static readonly validStatuses: ReadonlySet<FormationItemStatus> = new Set(['not_started', 'in_progress', 'blocked', 'done', 'skipped']);
  // Per-request cache, keyed off the request object itself so it never outlives one HTTP call.
  // {@link mapLiveItem} is invoked at least twice per live mutation (the pre-read via
  // getFormationItemOrThrow, then the mutation result) purely to read project.slug — this avoids
  // fanning that into two-plus NATS project reads for one user action.
  private readonly projectByRequestCache = new WeakMap<Request, Map<string, Project>>();
  // Per-request memoization of each project's section-title map, same rationale as
  // {@link projectByRequestCache}. Populated by {@link fetchLiveChecklistOrDenyNotFound} (every live
  // mutation calls it first, via `getFormationItemOrThrow`'s pre-read) and read by {@link mapLiveItem}
  // so a mutation response resolves `section_title` from the same upstream `sections[]` the checklist
  // read used, instead of silently falling back to the seeded template and disagreeing with it.
  private readonly sectionTitlesByRequestCache = new WeakMap<Request, Map<string, Map<string, string>>>();
  // Per-request memoization of each project's raw checklist, same rationale as
  // {@link sectionTitlesByRequestCache}. Populated by {@link fetchLiveChecklistOrDenyNotFound} so
  // `requireLiveFormation` (the route-level mutation gate, GH-2328) and the mutation's own
  // `getFormationItemOrThrow` pre-read — both of which call `fetchLiveChecklistOrDenyNotFound` for
  // the same `projectUid` within one request — share a single upstream checklist fetch instead of
  // fanning the gate check into a second one.
  private readonly checklistByRequestCache = new WeakMap<Request, Map<string, UpstreamFormationChecklist>>();

  public async getProjectFormation(req: Request, projectSlug: string): Promise<FormationChecklistResponse> {
    logger.debug(req, 'get_project_formation', 'Fetching formation checklist', { projectSlug });

    const { uid, exists } = await this.projectService.getProjectIdBySlug(req, projectSlug);
    if (!exists || !uid) {
      throw new ResourceNotFoundError('Project', projectSlug, { operation: 'get_project_formation', service: 'formation_service', path: req.path });
    }

    // Reuses fetchLiveChecklistOrDenyNotFound — the same GET/mask this service already uses for the
    // mutation pre-read — parameterized to mask as 'Formation' rather than 'FormationItem' so a
    // non-existent or inaccessible formation surfaces the same way either way.
    //
    // Deliberately no isFormationStageGate(project.stage) check here: upstream answers "does a
    // formation exist for this project" directly — a project with no formation record 404s from
    // this GET, which fetchLiveChecklistOrDenyNotFound already masks as not-found.
    const checklist = await this.fetchLiveChecklistOrDenyNotFound(req, uid, projectSlug, {
      resource: 'Formation',
      operation: 'get_project_formation',
    });

    // The checklist read above must stay first — it's the masking read (403/404 → the same
    // not-found), and nothing below should run before that gate is cleared. Everything after it is
    // independent of the others, so they run concurrently rather than as three sequential round
    // trips: the project read, the ROOT-collapse lookup, and the settings read for announcement_date
    // (which degrades to null on its own failure — see its .catch() below — independently of the
    // other two).
    const [project, rootUid, announcementDate] = await Promise.all([
      this.getProjectByIdCached(req, uid),
      resolveRootProjectUid(req, this.natsService),
      // announcement_date has no field on the checklist read itself (upstream's checklist_reader.go
      // reads it from project settings but doesn't return it) — read it from the same source the
      // indexer projection uses for the queue's own announcement_date, so the checklist and
      // /foundation/formations agree by construction. A settings-read failure degrades to null
      // rather than failing the whole checklist (precedent: CommitteeService's inherited-permissions
      // walk). No auditor-vs-writer auth-tier mismatch here: `lfx-v2-helm`'s generated
      // `PERMISSIONS.md` ("View project settings" row) grants Auditor the same unconditional read
      // access as Writer/Executive Director, so a checklist reader who could reach this far can
      // always read settings too — the .catch() below is for genuine failures, not routine 403s.
      this.projectService
        .getProjectSettings(req, uid)
        .then((settings) => settings.announcement_date ?? null)
        .catch((error) => {
          logger.warning(req, 'get_project_formation', 'Failed to read project settings for announcement_date, defaulting to null', {
            projectSlug,
            err: error,
          });
          return null;
        }),
    ]);

    // ROOT collapse (GH-2267 Phase 4).
    const parentUid = collapseRootParentUid(project.parent_uid || null, rootUid) ?? null;

    const sectionTitles = sectionTitlesFromChecklist(checklist);
    const items = checklist.items.map((raw) =>
      mapUpstreamFormationItem(raw, { formationUid: `formation:${uid}`, projectUid: uid, projectSlug: project.slug, sectionTitles })
    );

    const { formation, template } = mapUpstreamFormationChecklist(checklist, { project, parentUid, announcementDate, items });

    logger.debug(req, 'get_project_formation', 'Returning formation checklist', { projectSlug, item_count: items.length });

    return { formation, template, items };
  }

  /**
   * The sole enforcement point for per-item project visibility on the READ side
   * (`getFormationItemDetail`, and the single-item GET route). GH-2576 Phase 2's three write routes
   * deliberately do NOT go through this — a mutation must never re-read the item to manufacture its
   * own `If-Match` version (that race is exactly what If-Match exists to close); they call
   * {@link mutateLiveItemWithEtag} directly with the caller-supplied version, and rely on the
   * `requireLiveFormation` middleware's own checklist read (via {@link fetchLiveChecklistOrDenyNotFound})
   * for the lifecycle gate, with upstream/gateway 403/404 as the item-existence and access check.
   *
   * The contract has no single-item read, only the full checklist (`GET /formations/{project_uid}`),
   * so this fetches the whole thing and finds `itemKey` in it.
   */
  public async getFormationItemOrThrow(req: Request, projectUid: string, itemKey: string): Promise<FormationItem> {
    const itemAddress = `${projectUid}/${itemKey}`;

    const checklist = await this.fetchLiveChecklistOrDenyNotFound(req, projectUid, itemAddress, {
      resource: 'FormationItem',
      operation: 'get_formation_item',
    });
    const raw = checklist.items.find((candidate) => candidate.item_key === itemKey);
    if (!raw) {
      throw new ResourceNotFoundError('FormationItem', itemAddress, { operation: 'get_formation_item', service: 'formation_service', path: req.path });
    }
    return this.mapLiveItem(req, projectUid, raw);
  }

  public async getFormationItemDetail(req: Request, projectUid: string, itemKey: string): Promise<FormationItemDetail> {
    const item = await this.getFormationItemOrThrow(req, projectUid, itemKey);
    const { history, history_state } = await this.fetchItemActivityOrDegrade(req, projectUid, item.uid);
    return { item, history, history_state };
  }

  /**
   * `POST /formations/{project_uid}/items/{item_key}/status` (design.go, `lfx-v2-formation-service`
   * v0.1.4) — GH-2576 Phase 2. Replaces the old complete/skip/request/accept/reject/reopen model:
   * the real contract has one status-write route, a 5-value enum, and no `awaiting_acceptance`
   * two-step. The rule that stops an assignee closing their own item is enforced entirely by the API
   * gateway (`writer_guard` + `member` on `team:formation`, see `ruleset.yaml`) — nothing here
   * re-checks it. `reason` is required by upstream only for specific transitions
   * (`blocked_reason_required`/`skip_reason_required`/`return_reason_required`); that requirement is
   * not duplicated here — an omitted required `reason` surfaces as upstream's own 400
   * `ErrInvalidRequest`, mapped to {@link InvalidRequestError} by {@link mapFormationWriteError}, not
   * a BFF pre-check thrown before the request ever reaches upstream.
   */
  public async updateFormationItemStatus(
    req: Request,
    projectUid: string,
    itemKey: string,
    ifMatch: string,
    patch: { status?: unknown; reason?: unknown; sub_items?: unknown }
  ): Promise<{ item: FormationItem; etag: string | null; item_state: FormationItemWriteState }> {
    if (patch.status !== undefined && (typeof patch.status !== 'string' || !FormationService.validStatuses.has(patch.status as FormationItemStatus))) {
      throw ServiceValidationError.forField('status', 'status must be one of not_started, in_progress, blocked, done, skipped', {
        operation: 'update_formation_item_status',
        service: 'formation_service',
        path: req.path,
      });
    }
    if (patch.reason !== undefined) {
      this.assertOptionalStringField(patch.reason, 'reason', req, 'update_formation_item_status');
    }
    if (patch.sub_items !== undefined && !Array.isArray(patch.sub_items)) {
      throw ServiceValidationError.forField('sub_items', 'sub_items must be an array', {
        operation: 'update_formation_item_status',
        service: 'formation_service',
        path: req.path,
      });
    }
    if (patch.status === undefined && patch.sub_items === undefined) {
      throw ServiceValidationError.forField('status', 'At least one of status or sub_items is required', {
        operation: 'update_formation_item_status',
        service: 'formation_service',
        path: req.path,
      });
    }

    const body: Record<string, unknown> = {};
    if (patch.status !== undefined) body['status'] = patch.status;
    if (patch.reason !== undefined) body['reason'] = patch.reason;
    if (patch.sub_items !== undefined) body['sub_items'] = patch.sub_items;

    const { data: raw, etag } = await this.mutateLiveItemWithEtag(
      req,
      `/formations/${encodeURIComponent(projectUid)}/items/${encodeURIComponent(itemKey)}/status`,
      'POST',
      ifMatch,
      body,
      'update_formation_item_status',
      `${projectUid}/${itemKey}`
    );
    const { item: updated, item_state } = await this.mapLiveItemOrDegrade(req, projectUid, raw, 'update_formation_item_status');
    logger.info(req, 'update_formation_item_status', 'Formation item status changed', { item_uid: updated.uid, status: updated.status, item_state });
    return { item: updated, etag, item_state };
  }

  /**
   * `PATCH /formations/{project_uid}/items/{item_key}` (design.go, `lfx-v2-formation-service`
   * v0.1.4) — GH-2576 Phase 2. `note`/`evidence_link` only; `assignee`/`due_date` moved to
   * {@link updateFormationItemAssignment}'s dedicated route.
   *
   * Deliberately calls no BFF-side write-access check (the old `assertItemProjectWriteAccess` call
   * is gone) — upstream's gateway guards this exact route at `auditor_guard` (read-level), the same
   * tier as both GET routes, specifically so a partner holding only View access can record
   * off-platform work here. A BFF-invented `project.writer` requirement was stricter than upstream
   * and blocked exactly the caller this route exists for. See the PR description for the full
   * guard-tier audit this corrects.
   */
  public async updateFormationItem(
    req: Request,
    projectUid: string,
    itemKey: string,
    ifMatch: string,
    patch: { note?: unknown; evidence_link?: unknown }
  ): Promise<{ item: FormationItem; etag: string | null; item_state: FormationItemWriteState }> {
    if (patch.note !== undefined) {
      this.assertOptionalStringField(patch.note, 'note', req, 'update_formation_item');
    }
    if (patch.evidence_link !== undefined) {
      this.assertOptionalStringField(patch.evidence_link, 'evidence_link', req, 'update_formation_item');
      // BFF-side pre-check for an immediate, specific error — upstream's own `link_scheme_invalid`
      // reason still flows through {@link mapFormationWriteError} as a backstop for anything this
      // regex doesn't catch (e.g. a scheme-relative or malformed URL that still starts with http).
      if (typeof patch.evidence_link === 'string' && patch.evidence_link !== '' && !/^https?:\/\//i.test(patch.evidence_link)) {
        throw ServiceValidationError.forField('evidence_link', 'evidence_link must be an http or https URL', {
          operation: 'update_formation_item',
          service: 'formation_service',
          path: req.path,
        });
      }
    }
    if (patch.note === undefined && patch.evidence_link === undefined) {
      throw ServiceValidationError.forField('note', 'At least one of note or evidence_link is required', {
        operation: 'update_formation_item',
        service: 'formation_service',
        path: req.path,
      });
    }

    const body: Record<string, unknown> = {};
    if (patch.note !== undefined) body['note'] = patch.note;
    if (patch.evidence_link !== undefined) body['evidence_link'] = patch.evidence_link;

    const { data: raw, etag } = await this.mutateLiveItemWithEtag(
      req,
      `/formations/${encodeURIComponent(projectUid)}/items/${encodeURIComponent(itemKey)}`,
      'PATCH',
      ifMatch,
      body,
      'update_formation_item',
      `${projectUid}/${itemKey}`
    );
    const { item: updated, item_state } = await this.mapLiveItemOrDegrade(req, projectUid, raw, 'update_formation_item');
    logger.debug(req, 'update_formation_item', 'Formation item updated', { item_uid: updated.uid, item_state });
    return { item: updated, etag, item_state };
  }

  /**
   * `POST /formations/{project_uid}/items/{item_key}/assignment` (design.go, `lfx-v2-formation-service`
   * v0.1.4) — GH-2576 Phase 2, new route. `assignee`/`due_date`; either may be cleared with `''`.
   * `assignee_not_on_project` (an assignee with no grant on the project) belongs to #2594 and is
   * surfaced as upstream's own 400 `ErrInvalidRequest` via {@link mapFormationWriteError} rather than
   * pre-validated here.
   */
  public async updateFormationItemAssignment(
    req: Request,
    projectUid: string,
    itemKey: string,
    ifMatch: string,
    patch: { assignee?: unknown; due_date?: unknown }
  ): Promise<{ item: FormationItem; etag: string | null; item_state: FormationItemWriteState }> {
    if (patch.assignee !== undefined) {
      this.assertOptionalStringField(patch.assignee, 'assignee', req, 'update_formation_item_assignment');
    }
    // due_date is deliberately NOT format-validated here — an empty string clears the field, and a
    // format check would have to special-case that sentinel; a non-empty malformed value is
    // upstream's `due_date_invalid` to catch, forwarded as-is (see mapFormationWriteError).
    if (patch.due_date !== undefined && typeof patch.due_date !== 'string') {
      throw ServiceValidationError.forField('due_date', 'due_date must be a string', {
        operation: 'update_formation_item_assignment',
        service: 'formation_service',
        path: req.path,
      });
    }
    if (patch.assignee === undefined && patch.due_date === undefined) {
      throw ServiceValidationError.forField('assignee', 'At least one of assignee or due_date is required', {
        operation: 'update_formation_item_assignment',
        service: 'formation_service',
        path: req.path,
      });
    }

    const body: Record<string, unknown> = {};
    if (patch.assignee !== undefined) body['assignee'] = patch.assignee;
    if (patch.due_date !== undefined) body['due_date'] = patch.due_date;

    const { data: raw, etag } = await this.mutateLiveItemWithEtag(
      req,
      `/formations/${encodeURIComponent(projectUid)}/items/${encodeURIComponent(itemKey)}/assignment`,
      'POST',
      ifMatch,
      body,
      'update_formation_item_assignment',
      `${projectUid}/${itemKey}`
    );
    const { item: updated, item_state } = await this.mapLiveItemOrDegrade(req, projectUid, raw, 'update_formation_item_assignment');
    logger.debug(req, 'update_formation_item_assignment', 'Formation item assignment updated', { item_uid: updated.uid, item_state });
    return { item: updated, etag, item_state };
  }

  public async getFormationsQueue(req: Request, subStage?: FormationSubStage, search?: string, foundationUid?: string): Promise<FormationsQueueResponse> {
    logger.debug(req, 'get_formations_queue', 'Fetching Formations queue', { subStage, search, foundationUid });

    return this.getFormationsQueueLive(req, subStage, search, foundationUid);
  }

  /**
   * GH-1956 Me lens: "My formations" = every formation with at least one checklist item assigned to
   * the caller (decision 2 in the ticket's third comment — a direct-grant-only definition can't be
   * satisfied by the permission model, since it can't distinguish a direct grant from one inherited
   * via a parent project or `lf-staff`/`lf-contractor`). Backed by two independent
   * access-filtered `/query/resources` reads (#2334, `lfx-v2-formation-service` v0.1.2):
   * `type=formation_item` for the caller's assigned items (this method's `items` half, and the
   * per-formation bucket math for `formations`), and `type=formation` for the whole-formation
   * aggregates (`items_total`, `blocking_item_title`, `sub_stage`, ...) — the item index has no
   * per-formation rollup of its own, and the checklist document already carries the same
   * `assignee:` tag. Both queries are access-filtered upstream (the caller's own bearer token,
   * carried by `req`); an unauthenticated/unauthorized caller simply gets empty results back, not
   * an error — see {@link MyFormationWorkState}'s doc comment for how failure is distinguished from
   * "the caller has nothing assigned".
   */
  public async getMyFormationWork(req: Request, username: string, options: { includeFormations?: boolean } = {}): Promise<MyFormationWorkResponse> {
    // `getUserPendingActions` (Me-lens Pending Actions) only ever reads `.items` off this method's
    // result and discards `.formations`, while `my-formations-card` issues its own separate
    // `/api/user/formation-work` request that needs `.formations`. Without this flag, every Me-lens
    // page load ran the formation-aggregate query and its lifecycle backstop twice for work one of
    // the two callers throws away — `includeFormations: false` skips that query (and the join loop
    // below) entirely for the Pending Actions path (PR #2444 review).
    const includeFormations = options.includeFormations ?? true;
    // Normalized here rather than trusted from the caller: the `/api/user/formation-work`
    // controller passes the raw `getUsernameFromAuth` value (no prefix stripped), while
    // `getUserPendingActions`'s Me-lens aggregation already strips it before calling this method.
    // For an identity like "auth0|alice" the two callers would otherwise tag different assignee
    // values in the queries below and disagree on which formations/items belong to the same
    // signed-in user. Stripping unconditionally here makes both callers agree regardless of what
    // they pass in.
    const normalizedUsername = stripAuthPrefix(username);
    const assigneeTag = `assignee:${normalizedUsername}`;
    logger.debug(req, 'get_my_formation_work', 'Fetching formation work assigned to caller');

    let rawItems: UpstreamFormationItemRow[];
    try {
      // `lifecycle:live` is pushed upstream as a tag (both document types carry it — confirmed
      // against `indexer_publisher.go`'s `itemTags`/`projectionTags`), not left to the client-side
      // filter alone: an item on a completed/frozen checklist should never come back at all, on
      // either query, so `formations[]` and `items[]` can't independently disagree about it the way
      // an earlier version of this method did. The status half (`done`/`skipped`) stays client-side
      // deliberately — `summarizeMyFormationItems` below needs those counts, so the upstream
      // `cel_filter` exclusion the Pending Actions contract documents isn't applied here.
      // failOnPartial: true — this result drives both `items` and every `formations` bucket count,
      // so a silently-partial page would under-report both with no signal, the same reasoning
      // `getFormationsQueueLive` already applies to its own paged read.
      rawItems = await fetchAllQueryResources<UpstreamFormationItemRow>(
        req,
        (pageToken) =>
          this.microserviceProxy.proxyRequest<QueryServiceResponse<UpstreamFormationItemRow>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
            type: 'formation_item',
            tags_all: [assigneeTag, 'lifecycle:live'],
            page_size: 100,
            ...(pageToken && { page_token: pageToken }),
          }),
        { failOnPartial: true }
      );
    } catch (error) {
      logger.warning(req, 'get_my_formation_work', 'Assigned-item query failed, returning empty', { err: error });
      return { formations: [], items: [], state: 'unavailable' };
    }
    // Client-side backstop, not a substitute for the tag above — a document the tag failed to
    // exclude, for any reason, still can't reach `items[]`/`formations[]`.
    const liveItems = rawItems.filter((row) => isFormationLifecycleLive(normalizeFormationLifecycle(row.lifecycle)));
    if (liveItems.length === 0) {
      // Skip the formation-aggregate query and the can_write fan-out entirely — both are pure
      // dead weight when there's nothing for either to enrich, and this is the overwhelming common
      // case (every caller with zero currently-assigned live items, not just zero ever). Also avoids
      // a dishonest `'partial'`: if that unused query happened to fail, nothing was actually missing.
      logger.debug(req, 'get_my_formation_work', 'No assigned live items; skipping the formation-aggregate query');
      return { formations: [], items: [], state: 'complete' };
    }

    // The formation-aggregate query is independent of the items query above (a different indexed
    // document type) and can fail or lag without invalidating `items` — degrade `formations` alone
    // rather than the whole response. Skipped entirely when the caller only needs `items` (Pending
    // Actions) — see `includeFormations`'s doc comment above.
    let formationRows: FormationQueueRow[] = [];
    let formationsDegraded = false;
    if (includeFormations) {
      try {
        const rawFormationRows = await fetchAllQueryResources<UpstreamFormationQueueRow>(
          req,
          (pageToken) =>
            this.microserviceProxy.proxyRequest<QueryServiceResponse<UpstreamFormationQueueRow>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
              type: 'formation',
              tags_all: [assigneeTag, 'lifecycle:live'],
              page_size: 100,
              ...(pageToken && { page_token: pageToken }),
            }),
          { failOnPartial: true }
        );
        // Same client-side lifecycle backstop `liveItems` applies above (PR #2444 review) — without
        // it, a stale/mismatched non-live aggregate document that the upstream tag failed to
        // exclude could still join a live item row below and render as an active "My formation".
        // `rootUid` is `null`, not resolved: `MyFormationSummary` never exposes `parent_uid`, so
        // the ROOT-ancestry NATS lookup `normalizeQueueRow` otherwise does for the queue's own
        // `parent_uid` field would be pure waste on this path (PR #2444 review).
        formationRows = rawFormationRows
          .filter((row) => isFormationLifecycleLive(normalizeFormationLifecycle(row.lifecycle)))
          .map((row) => this.normalizeQueueRow(row, null));
      } catch (error) {
        logger.warning(req, 'get_my_formation_work', 'Formation-aggregate query failed; formations will be incomplete', { err: error });
        formationsDegraded = true;
      }
    }

    // items[] (Pending Actions rows) — the open subset of the (already lifecycle-live) items.
    const openItems = liveItems.filter((row) => isAssignedItemOpen(row.status));

    // can_write is resolved once per DISTINCT project_uid behind an open item, not per item — only
    // `items[]` rows ever thread this into the formation-item-drawer's Mark complete/Skip gate (GH-2613
    // review removed Claim/Block from this surface entirely — see `formationCanWrite`'s doc comment in
    // components.interface.ts for why), so a project reachable only through a done/skipped item costs
    // no lookup. Via the single-project getProjectById (the same `project.writer` flag `/assignment` is
    // gated on alone upstream — `/status` additionally requires `team:formation` membership, which no
    // client-visible signal covers), not a batch getProjects call (this codebase has a known class of bug where a batch access-check's
    // per-item writer flags are unreliable — see LFXV2-2823). Bounded at 10 concurrent, mirroring
    // `document.service.ts`'s `fetchProjectNames` — each lookup is two upstream round trips (the
    // project GET plus its FGA access check), so an assignee spread across dozens of formations
    // must not turn one dashboard load into an unbounded burst against the project service.
    const distinctProjectUids = [...new Set(openItems.map((item) => item.project_uid))];
    const writerByProject = new Map<string, boolean>();
    const CAN_WRITE_LOOKUP_CONCURRENCY = 10;
    for (let i = 0; i < distinctProjectUids.length; i += CAN_WRITE_LOOKUP_CONCURRENCY) {
      const batch = distinctProjectUids.slice(i, i + CAN_WRITE_LOOKUP_CONCURRENCY);
      await Promise.all(
        batch.map(async (projectUid) => {
          try {
            const project = await this.projectService.getProjectById(req, projectUid, true);
            writerByProject.set(projectUid, project.writer === true);
          } catch (error) {
            // Fail-closed: an item whose write access can't be confirmed never renders an
            // actionable Claim/Block button. Does not itself degrade `state` — nothing here is
            // wrong data, just conservatively hidden.
            logger.warning(req, 'get_my_formation_work', 'Per-project write-access lookup failed; item stays read-only', { projectUid, err: error });
          }
        })
      );
    }

    const items = openItems.map((row) => this.mapMyFormationItemRow(row, writerByProject.get(row.project_uid) === true));

    // formations[] — one row per formation_uid seen in the (lifecycle-live) items query, every
    // status rather than just the open subset above (summarizeMyFormationItems needs the
    // done/skipped counts too), joined against the formation-aggregate row for the whole-formation
    // totals. A formation missing its aggregate row (independent-query lag, or that query having
    // failed above) is dropped rather than fabricated, and flips `state` to `'partial'`. Skipped
    // entirely when `!includeFormations` — every formation_uid would otherwise look "missing its
    // aggregate row" (nothing populates `formationRows` in that branch) and dishonestly report
    // `'partial'` for a caller that never asked for `formations` in the first place.
    const formations: MyFormationSummary[] = [];
    let anyFormationDropped = false;
    if (includeFormations) {
      const itemsByFormation = new Map<string, UpstreamFormationItemRow[]>();
      for (const row of liveItems) {
        const bucket = itemsByFormation.get(row.formation_uid) ?? [];
        bucket.push(row);
        itemsByFormation.set(row.formation_uid, bucket);
      }
      const formationRowByUid = new Map(formationRows.map((row) => [row.formation_uid, row]));

      for (const [formationUid, assignedItems] of itemsByFormation) {
        const aggregateRow = formationRowByUid.get(formationUid);
        if (!aggregateRow) {
          anyFormationDropped = true;
          logger.warning(req, 'get_my_formation_work', 'No formation-aggregate row for an assigned formation; dropping from formations', { formationUid });
          continue;
        }
        // `lifecycle:live` alone doesn't gate this the way the card's own doc comment promises
        // ("an Active project drops out of the response entirely") — GH-2328 found every production
        // formation's checklist `lifecycle` is `'live'` regardless of the project's stage, since
        // nothing yet flips it on an Active/Disengaged transition. `isFormationStageGate` is the
        // actual stage-based gate the pre-live fixture path used for this same exclusion (matches any
        // `Formation - *` stage except the terminal `Disengaged` one, so Confidential still shows to
        // an assignee who holds access to it — only Active/Archived/Prospect/Disengaged drop out).
        // Deliberately not applied to `items[]`: Pending Actions gates purely on checklist lifecycle
        // (#2334), not project stage.
        if (!isFormationStageGate(aggregateRow.sub_stage_raw)) {
          continue;
        }
        const itemsTotal = Object.values(aggregateRow.progress).reduce((sum: number, count) => sum + (count ?? 0), 0);
        formations.push({
          formation_uid: aggregateRow.formation_uid,
          project_uid: aggregateRow.project_uid,
          project_slug: aggregateRow.project_slug,
          project_name: aggregateRow.project_name,
          sub_stage: aggregateRow.sub_stage,
          sub_stage_raw: aggregateRow.sub_stage_raw,
          announcement_date: aggregateRow.announcement_date,
          ...summarizeMyFormationItems(assignedItems),
          // Folds `skipped` in alongside `done` (PR #2444 review) — mirrors the queue's own
          // `doneCount` convention (`formations-table.component.ts`): skipping is a resolved state
          // for the checklist as a whole, so a fully-skipped formation reads "3 of 3", not "0 of 3".
          items_done: (aggregateRow.progress.done ?? 0) + (aggregateRow.progress.skipped ?? 0),
          items_total: itemsTotal,
          // The `formation` projection has no per-gating-item breakdown today, only the boolean
          // gates_cleared (#1957/GH-2267 gap 2, raised upstream) — zeroed, not fabricated, until
          // upstream adds one. The card guards this line on gating_total > 0.
          gating_done: 0,
          gating_total: 0,
          blocking_item_title: aggregateRow.blocked_item_titles[0] ?? null,
        });
      }
    }

    const state: MyFormationWorkState = formationsDegraded || anyFormationDropped ? 'partial' : 'complete';
    logger.debug(req, 'get_my_formation_work', 'Returning live formation work', { formation_count: formations.length, item_count: items.length, state });
    return { formations, items, state };
  }

  /**
   * The one fail-closed "may this project's formation be mutated right now" check (GH-2328),
   * called by the `requireLiveFormation` route middleware before any of the three write-route
   * controllers run. This is now the ONLY checklist read a write request performs (GH-2576 Phase 2
   * removed every mutation method's own pre-read of the item, since the version for `If-Match` comes
   * from the caller, not a fetch the BFF does on its own behalf) — but it still populates
   * {@link sectionTitlesByRequestCache} via {@link fetchLiveChecklistOrDenyNotFound} as a side
   * effect, which is what lets the mutation's own response mapping ({@link mapLiveItem}) resolve
   * `section_title` without a second upstream fetch. 403/404 masking (project visibility) is
   * therefore already enforced by the time the lifecycle check below runs.
   *
   * Throws `ConflictError('CHECKLIST_READ_ONLY')` (409) — deliberately distinct from a 412/409
   * upstream write-route error — for anything but `'live'`, including an unrecognized upstream value
   * (`normalizeFormationLifecycle` returns `null`, and `isFormationLifecycleLive(null)` is `false`):
   * this is a backstop in front of upstream's own `409 checklist_read_only` rejection, not a
   * replacement for it.
   */
  public async assertFormationMutable(req: Request, projectUid: string): Promise<void> {
    const checklist = await this.fetchLiveChecklistOrDenyNotFound(req, projectUid, projectUid, {
      resource: 'Formation',
      operation: 'require_live_formation',
    });
    const lifecycle = normalizeFormationLifecycle(checklist.lifecycle);
    if (!isFormationLifecycleLive(lifecycle)) {
      throw new ConflictError('This formation is read-only and cannot be modified', 'CHECKLIST_READ_ONLY', {
        operation: 'require_live_formation',
        service: 'formation_service',
        path: req.path,
      });
    }
  }

  /**
   * Backs {@link getFormationsQueue}. The indexer's `formation` projection matches
   * `FormationQueueRow`'s shape verbatim (GH-2267 plan gap 2) for every field except `sub_stage`:
   * upstream publishes the full `ProjectStage` string (`"Formation - Engaged"`), not this repo's
   * short {@link FormationSubStage} key, so that one field needs the `normalizeFormationSubStage`
   * mapping below (GH-2366) — everything else is ROOT collapse and the subStage/search filters.
   * `search` matches on `project_name`. Rows the caller can't read are simply absent from
   * `/query/resources` (per-row `auditor` enforcement upstream), so no additional access filtering
   * is needed here.
   *
   * `foundationUid`, when present, is sent as `parent: project:<uid>` — the documented query-service
   * navigation filter that matches a formation's *immediate* `parent_refs` (GH-2367). No foundation
   * selected sends no `parent` key at all, returning every formation, same as before this change.
   *
   * GH-2378: the UI always sends a `foundationUid` on the default landing — `NavigationService`'s
   * persona-priority default selection seeds the LF umbrella foundation there (`tlf`, resolved via
   * `resolveLfFoundationRootUid` — *not* the hidden NATS ROOT sentinel `resolveRootProjectUid`
   * resolves; see `LF_FOUNDATION_ROOT_SLUG`'s doc comment for why these are different projects),
   * since root scope is meant to mean "every formation" (GH-2367's decision). But `tlf`'s
   * *immediate* children are BUILD Foundation, C4SB Fund and Open Data Consortium only; the other
   * 123 of 126 formations sit under one of 33 intermediate parents. So a bare
   * `parent: project:<tlf uid>` silently narrowed the "everything" view to 3 rows. The fix below
   * resolves `tlf`'s uid up front and skips the `parent` filter when `foundationUid` *is* `tlf`,
   * restoring the decided behaviour rather than changing it. This becomes a deletion once #2368's
   * ancestry key lands and root scope can be expressed as a normal (correct-at-any-depth) filter.
   * `subStage`/`search` stay client-side below even though a server-side `sub_stage:` tag does exist
   * upstream (indexer_publisher.go's `projectionTags()`): `buildQueueTilesFromRows` needs every
   * sub_stage present in `normalizedRows` to count them, so pushing the filter into the query would
   * break the tiles it's computed from. `search`'s `project_name` substring match has no upstream
   * equivalent (only a `name` typeahead param) and stays client-side for the same pre-tile reason.
   * failOnPartial: true — buildQueueTilesFromRows below is pure counting over rawRows, and a
   * silently-partial page set would render wrong tile totals with no indication anything failed.
   */
  private async getFormationsQueueLive(req: Request, subStage?: FormationSubStage, search?: string, foundationUid?: string): Promise<FormationsQueueResponse> {
    // Resolved up front (not after the query, as before GH-2378) so the tlf-scope comparison below
    // can gate the `parent` param itself. Two independent NATS lookups, each process-wide TTL-cached
    // (root-project.helper.ts), so both are cache hits on a warm cache; `rootUid` is still needed
    // separately below for `collapseRootParentUid`'s ROOT→null parent collapse — that is unrelated
    // to this scoping fix and must keep using the hidden NATS sentinel, not `tlf`.
    const [rootUid, lfFoundationRootUid] = await Promise.all([resolveRootProjectUid(req, this.natsService), resolveLfFoundationRootUid(req, this.natsService)]);
    // Drop the `parent` filter when the caller selected the LF umbrella foundation (`tlf`): its
    // *immediate* children are not "every formation" — see the doc comment above (GH-2378). If
    // `lfFoundationRootUid` couldn't be resolved (null), fall back to sending `parent` as given
    // rather than guessing: a missed match keeps today's (narrower, already-live) behaviour, while a
    // wrong match would silently widen a filter the caller asked to narrow — same fail-safe
    // direction as `collapseRootParentUid` below.
    const effectiveFoundationUid = foundationUid && foundationUid !== lfFoundationRootUid ? foundationUid : undefined;
    if (foundationUid && lfFoundationRootUid === null) {
      // Can't tell whether `foundationUid` was `tlf` (the common case, since NavigationService's
      // default selection seeds `tlf` on every unscoped landing) — if it was, this request silently
      // under-reports the same way #2378 did, with no other signal since `resolveLfFoundationRootUid`
      // only logs the slug lookup, not this caller. Surfacing it here, not just there, makes a
      // repeat diagnosable. This also fires for an ordinary (non-root) foundation during the same
      // NATS outage, where the fallback is correct — the message below is phrased conditionally so
      // it doesn't assert an under-report that may not be happening.
      logger.warning(
        req,
        'get_formations_queue',
        'LF foundation root uid unresolved — sending `parent` as given; if this foundation is the LF root, the queue under-reports',
        {
          foundationUid,
        }
      );
    }
    const rawRows = await fetchAllQueryResources<UpstreamFormationQueueRow>(
      req,
      (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<UpstreamFormationQueueRow>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'formation',
          ...(effectiveFoundationUid && { parent: `project:${effectiveFoundationUid}` }),
          ...(pageToken && { page_token: pageToken }),
        }),
      { failOnPartial: true }
    );

    // The projection's key set is confirmed (indexer_publisher.go's projectionData always emits all
    // six FormationItemStatus keys) — these defaults guard against a malformed document only, not an
    // open contract question, so a row missing one doesn't throw downstream (queue tiles,
    // formations-table.component.ts's progress/blocked-title rendering).
    const normalizedRows = rawRows.map((row) => this.normalizeQueueRow(row, rootUid));

    // The queue is "formations between Prospect and Active" — a project that completed (or was
    // retired from) Formation is noise for the formation team, so post-Formation rows are dropped
    // from BOTH the rows and every tile below (LFXV2-3386). A named deny-list (Active/Archived),
    // not `!isFormationStageGate`: GH-2366's fail-open rule keeps unrecognized/malformed stages
    // visible, and `Formation - Disengaged` deliberately stays in the queue. `gates_cleared`/
    // `is_activating` rows keep their `Formation - *` stage until the formation team flips the
    // project Active, so "Ready to activate" rows survive this filter by construction.
    const inFormationRows = normalizedRows.filter((row) => !isPostFormationStage(row.sub_stage_raw));

    // DEBUG, not WARN — `Formation - Disengaged` (and any unrecognized stage) is a modeled,
    // expected shape with no queue-taxonomy equivalent (see normalizeFormationSubStage), not an
    // anomaly: it recurs on every request against current production data, so a WARN here would
    // repeat every time for a case the system already knows about and models on purpose, not a
    // genuine data-quality problem worth an operator's attention. Still logged (not silent) since
    // it's worth finding while debugging why a row is missing from every stage tile and every
    // stage filter (GH-2366). `Active`/`Archived` rows no longer reach this log — they are dropped
    // from the queue entirely above (LFXV2-3386).
    const unmappedRows = inFormationRows.filter((row) => row.sub_stage === null);
    if (unmappedRows.length > 0) {
      logger.debug(req, 'get_formations_queue', 'Upstream sub_stage has no queue-taxonomy equivalent', {
        unmapped_count: unmappedRows.length,
        raw_sub_stages: unmappedRows.map((row) => row.sub_stage_raw),
      });
    }

    let rows = inFormationRows;
    if (subStage) {
      rows = rows.filter((row) => row.sub_stage === subStage);
    }
    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      rows = rows.filter((row) => row.project_name.toLowerCase().includes(term));
    }

    // Tiles are counted over inFormationRows (pre subStage/search, post the post-Formation drop
    // above — tiles and rows must agree on which projects are in the queue at all), not the
    // filtered `rows` below, so they describe the whole queue rather than the filtered view. With
    // a non-root foundation selected, inFormationRows is already narrowed to that foundation's
    // rows by the `parent` query param above, so "the whole queue" here correctly means "the whole
    // queue within that foundation". With ROOT selected (GH-2378), no `parent` param is sent at
    // all, so inFormationRows is the global set and tiles correctly count every formation — no
    // separate foundation-aware tile computation is needed either way.
    const tiles = this.buildQueueTilesFromRows(inFormationRows);

    return { tiles, rows };
  }

  /**
   * Normalizes one raw `formation` indexed document onto {@link FormationQueueRow} — ROOT-collapse
   * plus the `sub_stage`/`sub_stage_raw` split (GH-2366) and the defensive defaults the projection's
   * optional fields need. Shared by {@link getFormationsQueueLive} and `getMyFormationWork`'s
   * formations-aggregate query (GH-1956) — both read the same `type=formation` document shape.
   */
  private normalizeQueueRow(row: UpstreamFormationQueueRow, rootUid: string | null): FormationQueueRow {
    return {
      ...row,
      parent_uid: collapseRootParentUid(row.parent_uid || null, rootUid) ?? null,
      sub_stage: normalizeFormationSubStage(row.sub_stage),
      // `?? ''` guards the same malformed-document case as the other defaults in this pass — the
      // contract says `sub_stage` is always present (indexer_publisher.go), but a row that omits it
      // must not leave `sub_stage_raw` as `undefined` against its `string`-typed contract.
      sub_stage_raw: row.sub_stage ?? '',
      announcement_date: row.announcement_date ?? null,
      progress: row.progress ?? {},
      blocked_item_titles: row.blocked_item_titles ?? [],
      assignees: row.assignees ?? [],
    };
  }

  /** Maps one `formation_item` index row onto the wire shape (GH-1956). */
  private mapMyFormationItemRow(row: UpstreamFormationItemRow, canWrite: boolean): MyFormationItemRow {
    return {
      item_uid: row.object_id,
      template_item_key: row.item_key,
      project_uid: row.project_uid,
      project_slug: row.project_slug,
      project_name: row.project_name,
      title: row.title,
      status: row.status,
      is_gating: row.gate,
      due_date: row.due_date ?? null,
      action: deriveItemAction(row),
      action_href: resolveActionHref(row.action_link, row.project_slug),
      can_write: canWrite,
    };
  }

  /**
   * Live-mode GET of the full checklist, shared by two callers: a mutation's pre-read (project-
   * visibility + item-existence check, and the source of the item's current `version` for
   * `If-Match`) and {@link getProjectFormation}'s own checklist read. Mirrors
   * `assertItemProjectAccess`'s masking invariant: a 403/404 from the auditor-gated
   * `GET /formations/{project_uid}` is indistinguishable from "no such formation"/"no such item" to
   * the caller — this doubles as that access check for the live path, so mutation methods don't call
   * `assertItemProjectAccess` separately. `deny` lets each caller mask as the resource type it
   * actually addresses (`FormationItem` for the item-scoped callers, `Formation` for the checklist
   * read itself) while sharing one transport and one masking rule.
   */
  private async fetchLiveChecklistOrDenyNotFound(
    req: Request,
    projectUid: string,
    address: string,
    deny: { resource: 'Formation' | 'FormationItem'; operation: string }
  ): Promise<UpstreamFormationChecklist> {
    // GH-2328: serve from `checklistByRequestCache` when this exact `projectUid` was already fetched
    // earlier in the same request — lets `requireLiveFormation`'s pre-mutation lifecycle check and
    // this method's own caller (e.g. `getFormationItemOrThrow`'s pre-read) share one upstream fetch
    // instead of the gate doubling the request count for every mutation.
    const cachedByProject = this.checklistByRequestCache.get(req);
    const cached = cachedByProject?.get(projectUid);
    if (cached) {
      return cached;
    }
    try {
      const checklist = await this.microserviceProxy.proxyRequest<UpstreamFormationChecklist>(
        req,
        'LFX_V2_FORMATION_SERVICE',
        `/formations/${encodeURIComponent(projectUid)}`,
        'GET'
      );
      let byProject = this.sectionTitlesByRequestCache.get(req);
      if (!byProject) {
        byProject = new Map<string, Map<string, string>>();
        this.sectionTitlesByRequestCache.set(req, byProject);
      }
      byProject.set(projectUid, sectionTitlesFromChecklist(checklist));

      let checklistByProject = this.checklistByRequestCache.get(req);
      if (!checklistByProject) {
        checklistByProject = new Map<string, UpstreamFormationChecklist>();
        this.checklistByRequestCache.set(req, checklistByProject);
      }
      checklistByProject.set(projectUid, checklist);

      return checklist;
    } catch (error) {
      if (isMicroserviceError(error) && (error.statusCode === 403 || error.statusCode === 404)) {
        logger.debug(req, deny.operation, `Denying ${deny.resource.toLowerCase()} access`, { address, err: error });
        throw new ResourceNotFoundError(deny.resource, address, { operation: deny.operation, service: 'formation_service', path: req.path });
      }
      throw error;
    }
  }

  /**
   * Maps one live checklist item onto `FormationItem`. `formation_uid` has no upstream source on
   * this path (gap 3) — synthesized deterministically from `projectUid` as `formation:<project_uid>`.
   * `sectionTitles` comes from {@link sectionTitlesByRequestCache} rather than a fresh checklist
   * fetch — every caller of this method reaches it only after `getFormationItemOrThrow`'s pre-read
   * already populated the cache for this `projectUid` via `fetchLiveChecklistOrDenyNotFound` — so a
   * mutation response resolves the same `section_title` the checklist read would, instead of the
   * seeded template's stale one.
   */
  private async mapLiveItem(req: Request, projectUid: string, raw: UpstreamFormationItem): Promise<FormationItem> {
    const project = await this.getProjectByIdCached(req, projectUid);
    const sectionTitles = this.sectionTitlesByRequestCache.get(req)?.get(projectUid);
    if (!sectionTitles) {
      // Should be unreachable — every caller reaches this only after getFormationItemOrThrow's
      // pre-read populates the cache for this projectUid. Warn rather than silently falling back
      // to FORMATION_TEMPLATE's generic section titles, so a future call site that skips the
      // pre-read is observable in logs instead of just reading as a stale section title.
      logger.warning(req, 'map_live_item', 'No cached section titles for project; falling back to template defaults', { projectUid });
    }
    const ctx: FormationItemMapContext = { formationUid: `formation:${projectUid}`, projectUid, projectSlug: project.slug, sectionTitles };
    return mapUpstreamFormationItem(raw, ctx);
  }

  /**
   * Wraps {@link mapLiveItem} for the post-write response in the three write methods above — by the
   * time this runs, the upstream write has already succeeded and persisted, so a failure here (in
   * practice: {@link mapLiveItem}'s own project fetch) must not turn the response into an error, which
   * would make the caller retry with a now-stale `If-Match` and 412 even though nothing was actually
   * lost (Cursor Bugbot, PR #2613). Mirrors {@link fetchItemActivityOrDegrade}'s degrade-rather-than-fail
   * shape (#2578): falls back to a minimal context built from `raw`/`projectUid` alone — no project
   * slug, so `action_href` degrades to whatever `resolveActionHref` does with an empty one — rather
   * than throwing. `version`, the field a caller's next `If-Match` actually depends on, is sourced from
   * `raw` either way and is unaffected by which path runs; only cosmetic fields degrade.
   */
  private async mapLiveItemOrDegrade(
    req: Request,
    projectUid: string,
    raw: UpstreamFormationItem,
    operation: string
  ): Promise<{ item: FormationItem; item_state: FormationItemWriteState }> {
    try {
      const item = await this.mapLiveItem(req, projectUid, raw);
      return { item, item_state: 'complete' };
    } catch (error) {
      logger.warning(req, operation, 'Post-write response mapping failed; returning a degraded item rather than failing an already-persisted write', {
        projectUid,
        item_key: raw.item_key,
        err: error,
      });
      const sectionTitles = this.sectionTitlesByRequestCache.get(req)?.get(projectUid);
      const item = mapUpstreamFormationItem(raw, { formationUid: `formation:${projectUid}`, projectUid, projectSlug: '', sectionTitles });
      return { item, item_state: 'stale' };
    }
  }

  /** Request-scoped memoization of {@link ProjectService.getProjectById} — see {@link projectByRequestCache}. */
  private async getProjectByIdCached(req: Request, projectUid: string): Promise<Project> {
    let byUid = this.projectByRequestCache.get(req);
    if (!byUid) {
      byUid = new Map<string, Project>();
      this.projectByRequestCache.set(req, byUid);
    }
    let project = byUid.get(projectUid);
    if (!project) {
      project = await this.projectService.getProjectById(req, projectUid, false);
      byUid.set(projectUid, project);
    }
    return project;
  }

  /**
   * Shared transport for all three write routes (design.go items 3-5, `lfx-v2-formation-service`
   * v0.1.4: `PATCH .../items/{item_key}`, `POST .../assignment`, `POST .../status`) — GH-2576
   * Phase 2. `ifMatch` is the caller-supplied bare-digit string from {@link parseIfMatch}, forwarded
   * unquoted (`if_match` is a Goa `Int64`; a quoted value is refused at upstream decode). Uses
   * `proxyRequestWithResponse` rather than the body-only `proxyRequest` so the upstream `ETag`
   * response header can be captured and handed back to the caller — "a caller holding the result
   * already holds the If-Match for its next write."
   */
  private async mutateLiveItemWithEtag(
    req: Request,
    path: string,
    method: 'PATCH' | 'POST',
    ifMatch: string,
    body: Record<string, unknown>,
    operation: string,
    itemAddress: string
  ): Promise<{ data: UpstreamFormationItem; etag: string | null }> {
    try {
      const response = await this.microserviceProxy.proxyRequestWithResponse<UpstreamFormationItem>(
        req,
        'LFX_V2_FORMATION_SERVICE',
        path,
        method,
        undefined,
        body,
        {
          'If-Match': ifMatch,
        }
      );
      const etag = response.headers['etag'] ?? response.headers['ETag'] ?? null;
      return { data: response.data, etag };
    } catch (error) {
      throw this.mapFormationWriteError(error, req, operation, itemAddress);
    }
  }

  /**
   * Maps an upstream write-route error onto a BFF error class, switching on the machine-readable
   * `reason` field — never on the separate `name`/`ErrorName` field, which is transport dispatch
   * only — and never validated against a closed union: an unrecognized reason degrades to a generic
   * message rather than throwing. 412 (`version_mismatch`) is surfaced distinctly via
   * {@link PreconditionFailedError}. `lfx-v2-formation-service` classifies most of its reason enum as
   * `ErrInvalidRequest` (400) rather than `ErrConflict` (409) — only `checklist_read_only`/
   * `invalid_transition` are genuinely 409 — so this switches on `reason` for BOTH statuses and
   * constructs the class matching whichever status upstream actually sent
   * ({@link InvalidRequestError} for 400, {@link ConflictError} for 409), rather than assuming 409
   * for every reason.
   */
  private mapFormationWriteError(error: unknown, req: Request, operation: string, itemAddress: string): unknown {
    if (!isMicroserviceError(error)) {
      return error;
    }
    if (error.statusCode === 412) {
      return new PreconditionFailedError(error.errorBody?.message, { operation, service: 'formation_service', path: req.path });
    }
    if (error.statusCode === 404) {
      return new ResourceNotFoundError('FormationItem', itemAddress, { operation, service: 'formation_service', path: req.path });
    }
    if (error.statusCode === 400 || error.statusCode === 409) {
      const reason = typeof error.errorBody?.reason === 'string' ? error.errorBody.reason : 'conflict';
      const message = error.errorBody?.message ?? "The requested change conflicts with the item's current state";
      const code = reason.toUpperCase();
      const options = { operation, service: 'formation_service', path: req.path };
      return error.statusCode === 400 ? new InvalidRequestError(message, code, options) : new ConflictError(message, code, options);
    }
    return error;
  }

  /**
   * Tiles are computed from the full unfiltered
   * `FormationQueueRow[]` (pre-ROOT-collapse, since `deriveFormationEntityType` only needs
   * `is_foundation`/whether `parent_uid` is set, and collapsing null→null is a no-op either way) —
   * tiles reflect the whole queue, not the filtered/searched view.
   *
   * `unmapped` (GH-2366) counts rows whose normalized `sub_stage` is `null` — an upstream stage
   * with no {@link FormationSubStage} equivalent. Those rows are never dropped from `total`, so
   * `total` can legitimately exceed `exploratory + engaged + on_hold`; `unmapped` is that gap made
   * explicit rather than a silently-created extra key (the bug this replaces).
   */
  private buildQueueTilesFromRows(rows: FormationQueueRow[]): FormationsQueueResponse['tiles'] {
    const bySubStage = Object.fromEntries(FORMATION_QUEUE_SUB_STAGES.map((stage) => [stage, 0])) as Record<FormationSubStage, number>;
    let unmapped = 0;
    for (const row of rows) {
      if (row.sub_stage === null) {
        unmapped += 1;
        continue;
      }
      bySubStage[row.sub_stage] = (bySubStage[row.sub_stage] ?? 0) + 1;
    }

    return {
      ...bySubStage,
      total: rows.length,
      foundations: rows.filter((row) => deriveFormationEntityType(row) === 'foundation').length,
      projects: rows.filter((row) => deriveFormationEntityType(row) !== 'foundation').length,
      unmapped,
    };
  }

  /**
   * Shared boundary check for every optional string field on the three write routes (`note`,
   * `reason`, `evidence_link`, `assignee`) — the controller passes `req.body?.<field>` straight
   * through as `unknown`, so the type guard has to actually run here, not just appear in a param
   * type the caller's `any` body bypasses. An empty string is valid (it's the clear sentinel for
   * `assignee`/`due_date`/`evidence_link`), so this only rejects a non-string or an overlong one.
   */
  private assertOptionalStringField(value: unknown, field: string, req: Request, operation: string): asserts value is string {
    if (typeof value !== 'string') {
      throw ServiceValidationError.forField(field, `${field} must be a string`, { operation, service: 'formation_service', path: req.path });
    }
    if (value.length > 2000) {
      throw ServiceValidationError.forField(field, `${field} must be 2000 characters or fewer`, { operation, service: 'formation_service', path: req.path });
    }
  }

  /**
   * `getFormationItemDetail`'s activity fetch (GH-2372, filtered by `item_uid` since GH-2572).
   * `getFormationItemOrThrow` has already run the item's pre-read through
   * `fetchLiveChecklistOrDenyNotFound`, proving `project:<projectUid>#auditor` access on the
   * identical Heimdall relation this route is gated on and that this item's UID is real — so
   * a 403 here cannot mean "no access" that read didn't already catch, and a 404 cannot mean
   * "no such item" either: upstream's own design names that as this route's other NotFound case,
   * but it's unreachable with a UID the checklist just vouched for, so it degrades to an empty,
   * `complete` history rather than the `unavailable` error state — a filtered read finding
   * nothing for a since-quiet item is unremarkable. 403 still logs at `DEBUG` (matching
   * `fetchLiveChecklistOrDenyNotFound`'s own level for the equivalent case); anything else logs at
   * `WARN` per the graceful-degradation convention.
   *
   * Guards `itemUid` itself before ever calling out: upstream treats an absent or empty
   * `item_uid` as "no filter" and returns the whole formation's feed, which would render as this
   * item's history now that the client-side filter that used to catch that is gone. The single
   * caller (`getFormationItemDetail`) always resolves a real UID first, so this is a defensive
   * backstop, not an expected path.
   */
  private async fetchItemActivityOrDegrade(req: Request, projectUid: string, itemUid: string): Promise<Pick<FormationItemDetail, 'history' | 'history_state'>> {
    if (!itemUid) {
      logger.warning(req, 'get_formation_item_detail', 'Refusing an unfiltered activity fetch: item has no uid', { projectUid });
      return { history: [], history_state: 'unavailable' };
    }

    try {
      const { entries } = await fetchItemFormationActivity(
        req,
        (cursor) =>
          this.microserviceProxy.proxyRequest<UpstreamFormationActivityPage>(
            req,
            'LFX_V2_FORMATION_SERVICE',
            `/formations/${encodeURIComponent(projectUid)}/activity`,
            'GET',
            { limit: FORMATION_ACTIVITY_PAGE_LIMIT, item_uid: itemUid, ...(cursor ? { cursor } : {}) }
          ),
        itemUid
      );
      return { history: entries, history_state: 'complete' };
    } catch (error) {
      if (isMicroserviceError(error) && error.statusCode === 404) {
        logger.debug(req, 'get_formation_item_detail', 'Activity fetch 404 on a checklist-vouched item; treating as empty history', { projectUid, itemUid });
        return { history: [], history_state: 'complete' };
      }
      if (isMicroserviceError(error) && error.statusCode === 403) {
        logger.debug(req, 'get_formation_item_detail', 'Activity fetch denied; degrading history to unavailable', { projectUid, itemUid, err: error });
      } else {
        logger.warning(req, 'get_formation_item_detail', 'Activity fetch failed; degrading history to unavailable', { projectUid, itemUid, err: error });
      }
      return { history: [], history_state: 'unavailable' };
    }
  }
}

export const formationService = new FormationService();
