// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  FormationActivity,
  FormationChecklistResponse,
  FormationItem,
  FormationItemMapContext,
  FormationItemStatus,
  FormationQueueRow,
  FormationsQueueResponse,
  FormationSubStage,
  MyFormationWorkResponse,
  Project,
  UpstreamFormationChecklist,
  UpstreamFormationItem,
} from '@lfx-one/shared/interfaces';
import { FORMATION_QUEUE_SUB_STAGES } from '@lfx-one/shared/constants';
import { QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { deriveFormationEntityType } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { isMicroserviceError, PreconditionFailedError, ResourceNotFoundError, AuthorizationError, ServiceValidationError, ConflictError } from '../errors';
import { mapUpstreamFormationChecklist, mapUpstreamFormationItem, sectionTitlesFromChecklist } from '../helpers/formation-mapper.helper';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { collapseRootParentUid, resolveRootProjectUid } from '../helpers/root-project.helper';
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
 * the fixture layer it gated). History (`getFormationItemDetail`) still returns an empty array —
 * wiring the real activity feed is Phase 5.
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

    // Mapped before enrichment, and kept around for mapUpstreamFormationChecklist's gating rollup
    // below — enrichItems can drop an item on a per-item access-check failure (a real possibility,
    // not merely defensive), and the rollup must reflect the checklist's actual gating state
    // regardless of that outcome, not a state that lost whichever gating item failed enrichment.
    const sectionTitles = sectionTitlesFromChecklist(checklist);
    const mappedItems = checklist.items.map((raw) =>
      mapUpstreamFormationItem(raw, { formationUid: `formation:${uid}`, projectUid: uid, projectSlug: project.slug, sectionTitles })
    );
    const items = await this.enrichItems(req, mappedItems);

    const { formation, template } = mapUpstreamFormationChecklist(checklist, { project, parentUid, announcementDate, items: mappedItems });

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

  public async getFormationItemDetail(req: Request, projectUid: string, itemKey: string): Promise<{ item: FormationItem; history: FormationActivity[] }> {
    const item = await this.getFormationItemOrThrow(req, projectUid, itemKey);
    const enriched = await this.enrichSingle(req, item);
    // No history yet — the real activity feed (`GET /formations/{project_uid}/activity`) is Phase 5.
    return { item: enriched, history: [] };
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
      return this.enrichSingle(req, submitted);
    }

    const acceptedRaw = await this.actLiveItem(req, projectUid, itemKey, 'accept', submitted.version, { note: nextNotes ?? '' }, 'complete_formation_item');
    const accepted = await this.mapLiveItem(req, projectUid, acceptedRaw);
    logger.info(req, 'complete_formation_item', 'Formation item completion recorded', {
      item_uid: accepted.uid,
      is_gating: accepted.is_gating,
      status: accepted.status,
    });
    return this.enrichSingle(req, accepted);
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
    return this.enrichSingle(req, updated);
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
    return this.enrichSingle(req, updated);
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
      return this.enrichSingle(req, updated);
    }

    this.assertPlainTransitionAllowed(req, item, nextStatus, 'update_formation_item_status');

    // Deliberately omits `note` from the body — the drawer's free-text `notes` field must survive a
    // plain status change untouched, and a block reason (`note` here) is metadata about the
    // transition, not an item-note update.
    const raw = await this.mutateLiveItem(req, projectUid, itemKey, item.version, { status: nextStatus }, 'update_formation_item_status');
    const updated = await this.mapLiveItem(req, projectUid, raw);
    logger.info(req, 'update_formation_item_status', 'Formation item status changed', { item_uid: updated.uid, status: updated.status });
    return this.enrichSingle(req, updated);
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
      return this.enrichSingle(req, item);
    }
    const raw = await this.mutateLiveItem(req, projectUid, itemKey, item.version, body, 'update_formation_item');
    const updated = await this.mapLiveItem(req, projectUid, raw);
    logger.debug(req, 'update_formation_item', 'Formation item updated', { item_uid: updated.uid });
    return this.enrichSingle(req, updated);
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
    return this.enrichSingle(req, updated);
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
    return this.enrichSingle(req, updated);
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
    return this.enrichSingle(req, updated);
  }

  public async getFormationsQueue(req: Request, subStage?: FormationSubStage, search?: string, foundationUid?: string): Promise<FormationsQueueResponse> {
    logger.debug(req, 'get_formations_queue', 'Fetching Formations queue', { subStage, search, foundationUid });

    return this.getFormationsQueueLive(req, subStage, search, foundationUid);
  }

  /**
   * GH-1956 Me lens: "My formations" = every formation with at least one checklist item assigned to
   * the caller (decision 2 in the ticket's third comment — a direct-grant-only definition can't be
   * satisfied by the permission model, since it can't distinguish a direct grant from one inherited
   * via a parent project or `lf-staff`/`lf-contractor`). The item index this needs ("which items are
   * assigned to me", one access-filtered query with an assignee filter) doesn't exist upstream yet —
   * see {@link MyFormationItemRow}'s doc comment.
   */
  public async getMyFormationWork(req: Request): Promise<MyFormationWorkResponse> {
    logger.debug(req, 'get_my_formation_work', 'Fetching formation work assigned to caller');

    // The formation-level read (this method's `formations` half) is buildable today: the
    // checklist document already carries its assignees and publishes a searchable `assignee:`
    // tag upstream, so the "My formations" card's formation-level rule can be answered directly
    // once that read is wired here. The item-level `items` half (Pending Actions rows) needs
    // formation items indexed as their own type, queryable by assignee — that index doesn't
    // exist upstream yet, tracked on #2334. Returning empty rather than fabricating rows is the
    // honest degradation until then — the card/tile simply don't render.
    logger.debug(req, 'get_my_formation_work', 'Live formation-work read not supported upstream yet, returning empty');
    return { formations: [], items: [] };
  }

  /**
   * Backs {@link getFormationsQueue} — the indexer's `formation` projection already matches
   * `FormationQueueRow`'s shape verbatim (GH-2267 plan gap 2), so no per-row mapper is needed,
   * only ROOT collapse and the subStage/search filters below. `search` matches on `project_name`.
   * Rows the caller can't read are simply absent from `/query/resources` (per-row `auditor`
   * enforcement upstream), so no additional access filtering is needed here.
   *
   * `foundationUid`, when present, is sent as `parent: project:<uid>` — the documented query-service
   * navigation filter that matches a formation's *immediate* `parent_refs` (GH-2367). No foundation
   * selected sends no `parent` key at all, returning every formation, same as before this change.
   * Never resolve the LF root uid and pass it here: root scope means "every formation", not
   * "formations whose immediate parent is the root" — those are different sets. `subStage`/`search`
   * stay client-side below even though a server-side `sub_stage:` tag does exist upstream
   * (indexer_publisher.go's `projectionTags()`): `buildQueueTilesFromRows` needs every sub_stage
   * present in `normalizedRows` to count them, so pushing the filter into the query would break the
   * tiles it's computed from. `search`'s `project_name` substring match has no upstream equivalent
   * (only a `name` typeahead param) and stays client-side for the same pre-tile reason.
   * failOnPartial: true — buildQueueTilesFromRows below is pure counting over rawRows, and a
   * silently-partial page set would render wrong tile totals with no indication anything failed.
   */
  private async getFormationsQueueLive(req: Request, subStage?: FormationSubStage, search?: string, foundationUid?: string): Promise<FormationsQueueResponse> {
    const rawRows = await fetchAllQueryResources<FormationQueueRow>(
      req,
      (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<FormationQueueRow>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'formation',
          ...(foundationUid && { parent: `project:${foundationUid}` }),
          ...(pageToken && { page_token: pageToken }),
        }),
      { failOnPartial: true }
    );

    const rootUid = await resolveRootProjectUid(req, this.natsService);
    // The projection's key set is confirmed (indexer_publisher.go's projectionData always emits all
    // six FormationItemStatus keys) — these defaults guard against a malformed document only, not an
    // open contract question, so a row missing one doesn't throw downstream (queue tiles,
    // formations-table.component.ts's progress/blocked-title rendering).
    const normalizedRows = rawRows.map((row) => ({
      ...row,
      parent_uid: collapseRootParentUid(row.parent_uid || null, rootUid) ?? null,
      announcement_date: row.announcement_date ?? null,
      progress: row.progress ?? {},
      blocked_item_titles: row.blocked_item_titles ?? [],
      assignees: row.assignees ?? [],
    }));

    let rows = normalizedRows;
    if (subStage) {
      rows = rows.filter((row) => row.sub_stage === subStage);
    }
    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      rows = rows.filter((row) => row.project_name.toLowerCase().includes(term));
    }

    // Tiles are counted over normalizedRows (pre subStage/search), not the filtered `rows` below,
    // so they describe the whole queue rather than the filtered view. With a foundation selected,
    // normalizedRows is already narrowed to that foundation's rows by the `parent` query param
    // above, so "the whole queue" here correctly means "the whole queue within that foundation" —
    // no separate foundation-aware tile computation is needed.
    const tiles = this.buildQueueTilesFromRows(normalizedRows);

    return { tiles, rows };
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
   */
  private buildQueueTilesFromRows(rows: FormationQueueRow[]): FormationsQueueResponse['tiles'] {
    const bySubStage = Object.fromEntries(FORMATION_QUEUE_SUB_STAGES.map((stage) => [stage, 0])) as Record<FormationSubStage, number>;
    for (const row of rows) {
      bySubStage[row.sub_stage] = (bySubStage[row.sub_stage] ?? 0) + 1;
    }

    return {
      ...bySubStage,
      total: rows.length,
      foundations: rows.filter((row) => deriveFormationEntityType(row) === 'foundation').length,
      projects: rows.filter((row) => deriveFormationEntityType(row) !== 'foundation').length,
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
   * `allSettled`, not `all` — a transient failure enriching one item (e.g. the `checkLFStaff` call
   * behind `canComplete`) must not blank the entire checklist response for items that resolved fine;
   * a rejected item is logged and dropped rather than failing the whole read. Only {@link getProjectFormation}
   * calls this today — {@link getFormationsQueue} doesn't attach `can_complete` to queue rows at all.
   */
  private async enrichItems(req: Request, items: FormationItem[]): Promise<FormationItem[]> {
    const results = await Promise.allSettled(items.map((item) => this.enrichSingle(req, item)));
    const enriched: FormationItem[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        enriched.push(result.value);
        return;
      }
      logger.warning(req, 'enrich_formation_item', 'Failed to enrich formation item with can_complete, dropping from response', {
        item_uid: items[index].uid,
        err: result.reason,
      });
    });
    return enriched;
  }

  private async enrichSingle(req: Request, item: FormationItem): Promise<FormationItem> {
    const canComplete = await formationItemAccessService.canComplete(req, item);
    return { ...item, can_complete: canComplete };
  }
}

export const formationService = new FormationService();
