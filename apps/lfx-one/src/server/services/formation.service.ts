// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  FormationChecklistResponse,
  FormationItem,
  FormationItemDetail,
  FormationItemMapContext,
  FormationItemStatus,
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
  normalizeFormationLifecycle,
  normalizeFormationSubStage,
  summarizeMyFormationItems,
} from '@lfx-one/shared/utils';
import { Request } from 'express';

import { isMicroserviceError, PreconditionFailedError, ResourceNotFoundError, AuthorizationError, ServiceValidationError, ConflictError } from '../errors';
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
import { formationItemAccessService } from './formation-item-access.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { NatsService } from './nats.service';
import { ProjectService } from './project.service';

/**
 * BFF service for the Formation Checklist section and Formations queue (GH-1958/GH-2267). All eight
 * item mutations (complete/skip/request/status/update/accept/reject/reopen), the queue read
 * {@link getFormationsQueue}, and {@link getProjectFormation}'s checklist read all call the real
 * `lfx-v2-formation-service` unconditionally (GH-2267 Phase 7 deleted the fixture/live switch and
 * the fixture layer it gated). {@link getFormationItemDetail} wires the real activity feed
 * (`GET /formations/{project_uid}/activity`, GH-2372) — see {@link fetchItemActivityOrDegrade}.
 */
export class FormationService {
  private readonly projectService = new ProjectService();
  private readonly natsService = new NatsService();
  private readonly microserviceProxy = new MicroserviceProxyService();
  private static readonly plainStatusTransitions: ReadonlySet<FormationItemStatus> = new Set(['not_started', 'in_progress', 'blocked']);
  /**
   * Upstream's exact status-edge graph for the generic PATCH item-mutator route
   * (`item_mutator.go`'s `allowedItemTransitions`). `done` is deliberately absent as a target
   * anywhere in this map — it is reachable only via the dedicated `accept` route (see
   * {@link acceptFormationItem}), which is how upstream keeps the formation-team-only,
   * self-acceptance-forbidden guard from being bypassed by a plain writer PATCH.
   */
  private static readonly allowedPlainTransitions: ReadonlyMap<FormationItemStatus, ReadonlySet<FormationItemStatus>> = new Map([
    ['not_started', new Set<FormationItemStatus>(['in_progress', 'skipped'])],
    ['in_progress', new Set<FormationItemStatus>(['blocked', 'awaiting_acceptance'])],
    ['blocked', new Set<FormationItemStatus>(['in_progress'])],
    ['skipped', new Set<FormationItemStatus>(['not_started'])],
  ]);
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
   * Every `/formations/:projectUid/items/:itemKey` caller goes through this, which is the sole
   * enforcement point for per-item project visibility. Do not add a new item code path that
   * resolves an item any other way.
   *
   * The contract has no single-item read, only the full checklist (`GET /formations/{project_uid}`),
   * so this fetches the whole thing and finds `itemKey` in it — every mutation method pays this cost
   * on its pre-read too.
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
   * Upstream's PATCH route can never write `done` directly (see {@link allowedPlainTransitions}) —
   * `done` exists only behind the dedicated accept route, so completion is always at least a
   * submit step. A gating item without gate-writer access stops there: it moves to
   * `awaiting_acceptance` and sits with the formation team until a `can_complete` caller accepts it.
   * Non-gating items and gate-writer callers on a gating item submit and then immediately call
   * accept on their own behalf — which upstream's `self_acceptance_forbidden` guard on the accept
   * route (`acceptance.go`) will itself refuse with a 409 if the caller is the item's own assignee.
   * That is deliberate: nothing in the BFF's `is_gating`/`can_complete` split maps to upstream's
   * acceptance identity check, so a caller completing their own assigned item — gating or not — now
   * genuinely needs a second person to accept it, same as upstream enforces everywhere else.
   */
  public async completeFormationItem(req: Request, projectUid: string, itemKey: string, notes?: unknown): Promise<FormationItem> {
    this.assertValidNotes(notes, req, 'complete_formation_item');
    const item = await this.getFormationItemOrThrow(req, projectUid, itemKey);
    if (item.action === 'status_only') {
      throw ServiceValidationError.forField('action', 'status_only items are updated by external tooling and cannot be completed manually', {
        operation: 'complete_formation_item',
        service: 'formation_service',
        path: req.path,
      });
    }
    await this.assertItemProjectWriteAccess(req, projectUid);
    this.assertPlainTransitionAllowed(req, item, 'awaiting_acceptance', 'complete_formation_item');
    const canComplete = await formationItemAccessService.canComplete(req, item);
    const nextNotes = notes ?? item.notes;

    const submittedRaw = await this.mutateLiveItem(
      req,
      projectUid,
      itemKey,
      item.version,
      { status: 'awaiting_acceptance', note: nextNotes ?? undefined },
      'complete_formation_item'
    );
    const submitted = await this.mapLiveItem(req, projectUid, submittedRaw);

    if (item.is_gating && !canComplete) {
      logger.info(req, 'complete_formation_item', 'Formation item submitted for acceptance', { item_uid: submitted.uid });
      return submitted;
    }

    const acceptedRaw = await this.actLiveItem(req, projectUid, itemKey, 'accept', submitted.version, { note: nextNotes ?? '' }, 'complete_formation_item');
    const accepted = await this.mapLiveItem(req, projectUid, acceptedRaw);
    logger.info(req, 'complete_formation_item', 'Formation item completion recorded', {
      item_uid: accepted.uid,
      is_gating: accepted.is_gating,
      status: accepted.status,
    });
    return accepted;
  }

  public async skipFormationItem(req: Request, projectUid: string, itemKey: string, reason: unknown): Promise<FormationItem> {
    this.assertValidReason(reason, 'A reason is required to skip a gating item', req, 'skip_formation_item');

    const item = await this.getFormationItemOrThrow(req, projectUid, itemKey);
    if (item.action === 'status_only') {
      throw ServiceValidationError.forField('action', 'status_only items are updated by external tooling and cannot be skipped manually', {
        operation: 'skip_formation_item',
        service: 'formation_service',
        path: req.path,
      });
    }
    await this.assertItemProjectWriteAccess(req, projectUid);
    await this.assertCanComplete(req, item, 'skip_formation_item');
    this.assertPlainTransitionAllowed(req, item, 'skipped', 'skip_formation_item');

    const raw = await this.mutateLiveItem(req, projectUid, itemKey, item.version, { status: 'skipped', skip_reason: reason }, 'skip_formation_item');
    const updated = await this.mapLiveItem(req, projectUid, raw);
    logger.info(req, 'skip_formation_item', 'Formation item skipped', { item_uid: updated.uid });
    return updated;
  }

  /**
   * Files the lightweight Epic-1 `request` action (GH-1958 finding #1) — flips the item to
   * `blocked`, the canonical status's direct successor to the old `waiting_on_partner` (dropped
   * from `FormationItemStatus`; a requested item is, by definition, blocked on someone else). No
   * SLA/target-team object; that richer `request` type is #1957/Epic 2.
   */
  public async requestFormationItem(req: Request, projectUid: string, itemKey: string): Promise<FormationItem> {
    const item = await this.getFormationItemOrThrow(req, projectUid, itemKey);
    if (item.action !== 'request') {
      throw ServiceValidationError.forField('action', 'This item does not support the request action', {
        operation: 'request_formation_item',
        service: 'formation_service',
        path: req.path,
      });
    }
    await this.assertItemProjectWriteAccess(req, projectUid);
    // Same gate as complete/skip: `request` also changes `status`, so a gating item's status must
    // not be movable through this action by a caller `complete`/`skip` would deny.
    await this.assertCanComplete(req, item, 'request_formation_item');
    this.assertPlainTransitionAllowed(req, item, 'blocked', 'request_formation_item');

    const raw = await this.mutateLiveItem(req, projectUid, itemKey, item.version, { status: 'blocked' }, 'request_formation_item');
    const updated = await this.mapLiveItem(req, projectUid, raw);
    logger.info(req, 'request_formation_item', 'Formation item request filed', { item_uid: updated.uid });
    return updated;
  }

  /**
   * The three "plain" status transitions a row's status-chip menu can trigger directly
   * (in_progress / blocked+note / not_started) — completion and skip keep their own dedicated
   * endpoints/methods above since their semantics genuinely differ (gate_writer/`awaiting_acceptance`
   * branching, required skip reason). No `assertCanComplete` gate for the general case, matching
   * `updateFormationItem`'s existing pattern — these are reversible, non-gating-status-of-record
   * moves, not a gate decision. The one exception: reversing a gating item off `done`/
   * `awaiting_acceptance` undoes a gate decision, so that specific transition reuses the same
   * `assertCanComplete` gate as `completeFormationItem`.
   */
  public async updateFormationItemStatus(req: Request, projectUid: string, itemKey: string, status: unknown, note?: unknown): Promise<FormationItem> {
    if (typeof status !== 'string' || !FormationService.plainStatusTransitions.has(status as FormationItemStatus)) {
      throw ServiceValidationError.forField('status', 'status must be one of not_started, in_progress, blocked', {
        operation: 'update_formation_item_status',
        service: 'formation_service',
        path: req.path,
      });
    }
    if (note !== undefined) {
      this.assertValidNotes(note, req, 'update_formation_item_status');
    }

    const item = await this.getFormationItemOrThrow(req, projectUid, itemKey);
    if (item.action === 'status_only') {
      throw ServiceValidationError.forField('action', 'status_only items are updated by external tooling and cannot have their status changed manually', {
        operation: 'update_formation_item_status',
        service: 'formation_service',
        path: req.path,
      });
    }
    await this.assertItemProjectWriteAccess(req, projectUid);
    const nextStatus = status as FormationItemStatus;

    if (item.status === 'done' || item.status === 'awaiting_acceptance') {
      // Reversing off done/awaiting_acceptance is not a plain PATCH upstream regardless of gating —
      // both statuses are only reachable via the dedicated accept/reject/reopen routes, and
      // `reject`/`reopen` are the only ones that move a row back to `in_progress` (see acceptance.go).
      // Route through the same actions `reopenFormationItem`/`rejectFormationItem` already use instead
      // of PATCHing directly. The gate_writer gate itself still only applies to a gating item, same as
      // `reopenFormationItem`/`rejectFormationItem` — `assertCanComplete` auto-passes non-gating items.
      if (nextStatus !== 'in_progress') {
        throw ServiceValidationError.forField('status', 'A done or awaiting-acceptance item can only be reversed to in_progress', {
          operation: 'update_formation_item_status',
          service: 'formation_service',
          path: req.path,
        });
      }
      if (item.is_gating) {
        await this.assertCanComplete(req, item, 'update_formation_item_status');
      }

      let raw;
      if (item.status === 'done') {
        raw = await this.actLiveItem(
          req,
          projectUid,
          itemKey,
          'reopen',
          item.version,
          { note: note !== undefined ? note : (item.notes ?? '') },
          'update_formation_item_status'
        );
      } else {
        // Upstream requires a non-empty note to reject an awaiting-acceptance item (reasonNoteRequired).
        this.assertValidReason(note, 'A note is required to reverse an item awaiting acceptance', req, 'update_formation_item_status');
        raw = await this.actLiveItem(req, projectUid, itemKey, 'reject', item.version, { note }, 'update_formation_item_status');
      }
      const updated = await this.mapLiveItem(req, projectUid, raw);
      logger.info(req, 'update_formation_item_status', 'Formation item status reversed', { item_uid: updated.uid, status: updated.status });
      return updated;
    }

    this.assertPlainTransitionAllowed(req, item, nextStatus, 'update_formation_item_status');

    // Deliberately omits `note` from the body — the drawer's free-text `notes` field must survive a
    // plain status change untouched, and a block reason (`note` here) is metadata about the
    // transition, not an item-note update.
    const raw = await this.mutateLiveItem(req, projectUid, itemKey, item.version, { status: nextStatus }, 'update_formation_item_status');
    const updated = await this.mapLiveItem(req, projectUid, raw);
    logger.info(req, 'update_formation_item_status', 'Formation item status changed', { item_uid: updated.uid, status: updated.status });
    return updated;
  }

  /**
   * Notes/assignee/due-date are general drawer editors, not gate_writer-restricted — the ticket
   * scopes `gate_writer` to completing/skipping a *gating* item specifically, not to editing its
   * metadata. No `assertCanComplete` call here by design; ordinary project `writer` (via
   * `assertItemProjectWriteAccess`) is still required, same as every other mutating method.
   */
  public async updateFormationItem(
    req: Request,
    projectUid: string,
    itemKey: string,
    patch: { notes?: unknown; owner_username?: string; due_date?: string | null }
  ): Promise<FormationItem> {
    this.assertValidNotes(patch.notes, req, 'update_formation_item');
    if (patch.owner_username !== undefined && patch.owner_username !== null && typeof patch.owner_username !== 'string') {
      throw ServiceValidationError.forField('owner_username', 'owner_username must be a string', {
        operation: 'update_formation_item',
        service: 'formation_service',
        path: req.path,
      });
    }
    if (typeof patch.owner_username === 'string' && patch.owner_username.length > 200) {
      throw ServiceValidationError.forField('owner_username', 'owner_username must be 200 characters or fewer', {
        operation: 'update_formation_item',
        service: 'formation_service',
        path: req.path,
      });
    }
    if (
      patch.due_date !== undefined &&
      patch.due_date !== null &&
      (typeof patch.due_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(patch.due_date) || Number.isNaN(Date.parse(patch.due_date)))
    ) {
      throw ServiceValidationError.forField('due_date', 'due_date must be a YYYY-MM-DD date string or null', {
        operation: 'update_formation_item',
        service: 'formation_service',
        path: req.path,
      });
    }

    const item = await this.getFormationItemOrThrow(req, projectUid, itemKey);
    await this.assertItemProjectWriteAccess(req, projectUid);

    // Normalized so the drawer's always-'' empty textarea (formation-item-drawer.component.ts)
    // doesn't spuriously diff against a freshly generated item's notes: null on every first save.
    const nextNotes = patch.notes || null;
    const nextOwnerUsername = patch.owner_username || null;
    const notesChanged = patch.notes !== undefined && nextNotes !== (item.notes ?? null);
    const ownerChanged = patch.owner_username !== undefined && nextOwnerUsername !== (item.owner?.username ?? null);
    const dueDateChanged = patch.due_date !== undefined && patch.due_date !== item.due_date;

    // Upstream's `note`/`assignee`/`due_date` are all plain (non-nullable) `string` fields whose
    // clear sentinel is `''`, not `null` — `item_mutator.go` decodes them as `*string` and treats
    // a wholly-omitted key as "leave unchanged", so a clear must still send the key, just with an
    // empty string rather than `null` (a JSON `null` unmarshals into a nil `*string`, indistinguishable
    // from omission, and a clear-only PATCH would then 409 `no_fields_to_update` instead of clearing).
    // `due_date` additionally must be `YYYY-MM-DD` — upstream parses with that exact layout and
    // 400s `due_date_invalid` on a full ISO datetime. The validation above already rejects
    // anything but that shape (or `null`), so `patch.due_date` is safe to send as-is — no `slice`
    // needed, and no risk of the calendar day shifting a UTC-instant truncation would introduce.
    const body: Record<string, unknown> = {};
    if (notesChanged) body['note'] = nextNotes ?? '';
    if (ownerChanged) body['assignee'] = nextOwnerUsername ?? '';
    if (dueDateChanged) body['due_date'] = patch.due_date ?? '';
    if (Object.keys(body).length === 0) {
      // Upstream 409s an empty PATCH body (`no_fields_to_update`) — a no-op save is a reachable
      // path (open the drawer, hit Save without editing), so return the item unchanged rather than
      // issuing a request upstream can only reject.
      logger.debug(req, 'update_formation_item', 'No-op update, skipping upstream call', { item_uid: item.uid });
      return item;
    }
    const raw = await this.mutateLiveItem(req, projectUid, itemKey, item.version, body, 'update_formation_item');
    const updated = await this.mapLiveItem(req, projectUid, raw);
    logger.debug(req, 'update_formation_item', 'Formation item updated', { item_uid: updated.uid });
    return updated;
  }

  /**
   * New in GH-2267 Phase 2 — mirrors the upstream `accept` action (design.go item 4), gated there on
   * `team:formation` membership; Epic 1 has no such team, so this reuses the existing `gate_writer`
   * (`assertCanComplete`) gate instead. Only meaningful on an item already sitting in
   * `awaiting_acceptance` (i.e. a non-gate-writer already submitted it via `completeFormationItem`)
   * — accepting anything else is a state-precondition error, not an access one.
   */
  public async acceptFormationItem(req: Request, projectUid: string, itemKey: string, note?: unknown): Promise<FormationItem> {
    if (note !== undefined) this.assertValidNotes(note, req, 'accept_formation_item');
    const item = await this.getFormationItemOrThrow(req, projectUid, itemKey);
    if (item.status !== 'awaiting_acceptance') {
      throw ServiceValidationError.forField('status', 'Only an item awaiting acceptance can be accepted', {
        operation: 'accept_formation_item',
        service: 'formation_service',
        path: req.path,
      });
    }
    await this.assertItemProjectWriteAccess(req, projectUid);
    await this.assertCanComplete(req, item, 'accept_formation_item');

    // Unlike PATCH, upstream's accept/reject/reopen always overwrite the note column — omitting it
    // means "the note is now empty", not "leave unchanged" (`acceptance.go`: "Written whether or not
    // one was supplied, so the column means 'the note on this row now'"). Pass the item's current
    // note through when the caller didn't supply one.
    const raw = await this.actLiveItem(
      req,
      projectUid,
      itemKey,
      'accept',
      item.version,
      { note: note !== undefined ? note : (item.notes ?? '') },
      'accept_formation_item'
    );
    const updated = await this.mapLiveItem(req, projectUid, raw);
    logger.info(req, 'accept_formation_item', 'Formation item accepted', { item_uid: updated.uid });
    return updated;
  }

  /**
   * New in GH-2267 Phase 2 — mirrors the upstream `reject` action (design.go item 5), which requires
   * a non-empty note upstream; sends an `awaiting_acceptance` item back to the submitter as
   * `in_progress` rather than closing it. Same `gate_writer` substitution as {@link acceptFormationItem}.
   */
  public async rejectFormationItem(req: Request, projectUid: string, itemKey: string, note: unknown): Promise<FormationItem> {
    this.assertValidReason(note, 'A note is required to reject an item', req, 'reject_formation_item');
    const item = await this.getFormationItemOrThrow(req, projectUid, itemKey);
    if (item.status !== 'awaiting_acceptance') {
      throw ServiceValidationError.forField('status', 'Only an item awaiting acceptance can be rejected', {
        operation: 'reject_formation_item',
        service: 'formation_service',
        path: req.path,
      });
    }
    await this.assertItemProjectWriteAccess(req, projectUid);
    await this.assertCanComplete(req, item, 'reject_formation_item');

    const raw = await this.actLiveItem(req, projectUid, itemKey, 'reject', item.version, { note }, 'reject_formation_item');
    const updated = await this.mapLiveItem(req, projectUid, raw);
    logger.info(req, 'reject_formation_item', 'Formation item rejected', { item_uid: updated.uid });
    return updated;
  }

  /**
   * New in GH-2267 Phase 2 — mirrors the upstream `reopen` action (design.go item 6). Reversing a
   * `done`/`skipped`/`awaiting_acceptance` item undoes a prior gate decision, so this reuses
   * `assertCanComplete` the same way `updateFormationItemStatus` does for the equivalent reversal.
   */
  public async reopenFormationItem(req: Request, projectUid: string, itemKey: string, note?: unknown): Promise<FormationItem> {
    if (note !== undefined) this.assertValidNotes(note, req, 'reopen_formation_item');
    const item = await this.getFormationItemOrThrow(req, projectUid, itemKey);
    if (item.status !== 'done' && item.status !== 'skipped' && item.status !== 'awaiting_acceptance') {
      throw ServiceValidationError.forField('status', 'Only a done, skipped, or awaiting-acceptance item can be reopened', {
        operation: 'reopen_formation_item',
        service: 'formation_service',
        path: req.path,
      });
    }
    await this.assertItemProjectWriteAccess(req, projectUid);
    await this.assertCanComplete(req, item, 'reopen_formation_item');

    // Same note-preservation contract as acceptFormationItem — see its comment.
    const raw = await this.actLiveItem(
      req,
      projectUid,
      itemKey,
      'reopen',
      item.version,
      { note: note !== undefined ? note : (item.notes ?? '') },
      'reopen_formation_item'
    );
    const updated = await this.mapLiveItem(req, projectUid, raw);
    logger.info(req, 'reopen_formation_item', 'Formation item reopened', { item_uid: updated.uid });
    return updated;
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
    // `items[]` rows ever render a Claim/Block button, so a project reachable only through a
    // done/skipped item costs no lookup. Via the single-project getProjectById, the same
    // authoritative per-resource check `assertItemProjectWriteAccess` uses for every mutation, not a
    // batch getProjects call (this codebase has a known class of bug where a batch access-check's
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
   * called by the `requireLiveFormation` route middleware before any of the eight item-mutation
   * controllers run. Reuses {@link fetchLiveChecklistOrDenyNotFound} — the same pre-read
   * `getFormationItemOrThrow` performs — via {@link checklistByRequestCache}, so gating a mutation
   * costs no second upstream fetch: whichever of this call or `getFormationItemOrThrow` runs first
   * populates the cache for the other. 403/404 masking (project visibility) is therefore already
   * enforced by the time the lifecycle check below runs.
   *
   * Throws `ConflictError('CHECKLIST_READ_ONLY')` (409) — deliberately distinct from the `403`
   * `PROJECT_WRITE_REQUIRED` `assertItemProjectWriteAccess` raises — for anything but `'live'`,
   * including an unrecognized upstream value (`normalizeFormationLifecycle` returns `null`, and
   * `isFormationLifecycleLive(null)` is `false`): this is a backstop in front of upstream's own
   * `409 checklist_read_only` rejection, not a replacement for it.
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

    // DEBUG, not WARN — `Active` and `Formation - Disengaged` are modeled, expected shapes with no
    // queue-taxonomy equivalent (see normalizeFormationSubStage), not an anomaly: they recur on
    // every request against current production data, so a WARN here would repeat every time for a
    // case the system already knows about and models on purpose, not a genuine data-quality problem
    // worth an operator's attention. Still logged (not silent) since it's worth finding while
    // debugging why a row is missing from every stage tile and every stage filter (GH-2366).
    const unmappedRows = normalizedRows.filter((row) => row.sub_stage === null);
    if (unmappedRows.length > 0) {
      logger.debug(req, 'get_formations_queue', 'Upstream sub_stage has no queue-taxonomy equivalent', {
        unmapped_count: unmappedRows.length,
        raw_sub_stages: unmappedRows.map((row) => row.sub_stage_raw),
      });
    }

    let rows = normalizedRows;
    if (subStage) {
      rows = rows.filter((row) => row.sub_stage === subStage);
    }
    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      rows = rows.filter((row) => row.project_name.toLowerCase().includes(term));
    }

    // Tiles are counted over normalizedRows (pre subStage/search), not the filtered `rows` below,
    // so they describe the whole queue rather than the filtered view. With a non-root foundation
    // selected, normalizedRows is already narrowed to that foundation's rows by the `parent` query
    // param above, so "the whole queue" here correctly means "the whole queue within that
    // foundation". With ROOT selected (GH-2378), no `parent` param is sent at all, so
    // normalizedRows is the global set and tiles correctly count every formation — no separate
    // foundation-aware tile computation is needed either way.
    const tiles = this.buildQueueTilesFromRows(normalizedRows);

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
   * Shared PATCH transport for complete/skip/request/status/update (design.go item 3) — `If-Match:
   * <version>` enforces the optimistic lock. Only the 412 case is mapped to a dedicated error class
   * here; the fuller 409/400 `reason`-based mapping is deferred (GH-2267 plan's Phase 3 scope note) —
   * everything else passes through as the generic `MicroserviceError`.
   */
  private async mutateLiveItem(
    req: Request,
    projectUid: string,
    itemKey: string,
    version: number,
    body: Record<string, unknown>,
    operation: string
  ): Promise<UpstreamFormationItem> {
    try {
      return await this.microserviceProxy.proxyRequest<UpstreamFormationItem>(
        req,
        'LFX_V2_FORMATION_SERVICE',
        `/formations/${encodeURIComponent(projectUid)}/items/${encodeURIComponent(itemKey)}`,
        'PATCH',
        undefined,
        body,
        { 'If-Match': String(version) }
      );
    } catch (error) {
      throw this.mapLivePreconditionError(error, req, operation);
    }
  }

  /** Shared POST transport for accept/reject/reopen (design.go items 4-6) — same `If-Match`/412 handling as {@link mutateLiveItem}. */
  private async actLiveItem(
    req: Request,
    projectUid: string,
    itemKey: string,
    action: 'accept' | 'reject' | 'reopen',
    version: number,
    body: Record<string, unknown>,
    operation: string
  ): Promise<UpstreamFormationItem> {
    try {
      return await this.microserviceProxy.proxyRequest<UpstreamFormationItem>(
        req,
        'LFX_V2_FORMATION_SERVICE',
        `/formations/${encodeURIComponent(projectUid)}/items/${encodeURIComponent(itemKey)}/${action}`,
        'POST',
        undefined,
        body,
        { 'If-Match': String(version) }
      );
    } catch (error) {
      throw this.mapLivePreconditionError(error, req, operation);
    }
  }

  /**
   * `acceptFormationItem`/`rejectFormationItem`/`reopenFormationItem`'s local status guards
   * intentionally permit a superset of upstream's own preconditions (e.g. reopen allows
   * `skipped`/`awaiting_acceptance` in addition to `done`, documented on {@link reopenFormationItem})
   * — so this must still be prepared for upstream's own 409 `Conflict`
   * (`internal/service/acceptance.go`'s `wrongStatusReason`) on a status this BFF's guard let
   * through. Mapped onto {@link ConflictError} rather than left as a raw `MicroserviceError`.
   */
  private mapLivePreconditionError(error: unknown, req: Request, operation: string): unknown {
    if (isMicroserviceError(error) && error.statusCode === 412) {
      return new PreconditionFailedError(error.errorBody?.message, { operation, service: 'formation_service', path: req.path });
    }
    if (isMicroserviceError(error) && error.statusCode === 409) {
      const reason = typeof error.errorBody?.reason === 'string' ? error.errorBody.reason : 'conflict';
      return new ConflictError(error.errorBody?.message ?? "The requested change conflicts with the item's current state", reason.toUpperCase(), {
        operation,
        service: 'formation_service',
        path: req.path,
      });
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
   * Required before any mutation (complete/skip/request/update) — the project-access check that
   * happens first, via `getFormationItemOrThrow`'s live checklist fetch, only requires the
   * `viewer` relation, which is enough to read the checklist but not enough to change it. Callers
   * here have already passed that read gate, so a denial is a plain `AuthorizationError` (403)
   * rather than a "not found" mask — the caller already legitimately knows this item exists, so
   * there is no existence-oracle risk in saying so.
   */
  private async assertItemProjectWriteAccess(req: Request, projectUid: string): Promise<void> {
    const project = await this.projectService.getProjectById(req, projectUid, true);
    if (!project.writer) {
      throw new AuthorizationError('Write access required for this project', {
        operation: 'assert_item_project_write_access',
        service: 'authorization',
        path: req.path,
        code: 'PROJECT_WRITE_REQUIRED',
      });
    }
  }

  /** Shared gate for every action that changes a gating item's status (complete/skip/request) — see `FormationItemAccessService.canComplete`. */
  private async assertCanComplete(req: Request, item: FormationItem, operation: string): Promise<void> {
    const canComplete = await formationItemAccessService.canComplete(req, item);
    if (!canComplete) {
      throw new AuthorizationError('gate_writer access required for this item', {
        operation,
        service: 'authorization',
        path: req.path,
        code: 'GATE_WRITER_REQUIRED',
      });
    }
  }

  /**
   * Guards every plain-status PATCH (complete's submit step, skip, request, and the status-chip
   * menu) against upstream's real transition graph ({@link allowedPlainTransitions}) before issuing
   * the request, so an invalid menu action 400s with a clear message instead of surfacing upstream's
   * opaque `invalid_transition` 409 (via {@link mapLivePreconditionError}).
   */
  private assertPlainTransitionAllowed(req: Request, item: FormationItem, to: FormationItemStatus, operation: string): void {
    const allowed = FormationService.allowedPlainTransitions.get(item.status);
    if (!allowed?.has(to)) {
      throw ServiceValidationError.forField('status', `Cannot move a ${item.status} item to ${to}`, {
        operation,
        service: 'formation_service',
        path: req.path,
      });
    }
  }

  /**
   * Shared by `completeFormationItem`/`updateFormationItem` — the controller passes `req.body?.notes`
   * straight through as `unknown`, so the type guard has to actually run at the service boundary,
   * not just appear in a param type the caller's `any` body bypasses.
   */
  private assertValidNotes(notes: unknown, req: Request, operation: string): asserts notes is string | undefined {
    if (notes === undefined) return;
    if (typeof notes !== 'string') {
      throw ServiceValidationError.forField('notes', 'Notes must be a string', { operation, service: 'formation_service', path: req.path });
    }
    if (notes.length > 2000) {
      throw ServiceValidationError.forField('notes', 'Notes must be 2000 characters or fewer', { operation, service: 'formation_service', path: req.path });
    }
  }

  /**
   * Used by `skipFormationItem`. Same `unknown`-at-the-boundary rationale as
   * {@link assertValidNotes} — a non-string `reason` must 400 here, not throw a raw `TypeError` from
   * `.trim()` further down. Caps length the same way `notes` is capped, so a skip/decline reason
   * can't push unbounded text into the upstream request body or log line.
   */
  private assertValidReason(reason: unknown, message: string, req: Request, operation: string): asserts reason is string {
    if (typeof reason !== 'string' || !reason.trim()) {
      throw ServiceValidationError.forField('reason', message, { operation, service: 'formation_service', path: req.path });
    }
    if (reason.length > 2000) {
      throw ServiceValidationError.forField('reason', 'Reason must be 2000 characters or fewer', { operation, service: 'formation_service', path: req.path });
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
