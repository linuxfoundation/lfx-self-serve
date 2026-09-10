// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  Formation,
  FormationActivity,
  FormationChecklistResponse,
  FormationItem,
  FormationItemMapContext,
  FormationItemStatus,
  FormationQueueRow,
  FormationsQueueResponse,
  FormationSubStage,
  MyFormationItemRow,
  MyFormationSummary,
  MyFormationWorkResponse,
  Project,
  UpstreamFormationChecklist,
  UpstreamFormationItem,
} from '@lfx-one/shared/interfaces';
import { FORMATION_QUEUE_SUB_STAGES } from '@lfx-one/shared/constants';
import { QueryServiceResponse } from '@lfx-one/shared/interfaces';
import { deriveFormationEntityType, isAssignedItemOpen, isFormationStageGate, summarizeMyFormationItems } from '@lfx-one/shared/utils';
import crypto from 'crypto';
import { Request } from 'express';

import { isMicroserviceError, PreconditionFailedError, ResourceNotFoundError, AuthorizationError, ServiceValidationError, ConflictError } from '../errors';
import { isFormationServiceLive } from '../helpers/formation-backend.helper';
import { generateMockFormation, SEEDED_FORMATION_TEMPLATE, STATIC_QUEUE_FORMATIONS } from '../helpers/formation-fixture.helper';
import { mapUpstreamFormationChecklist, mapUpstreamFormationItem } from '../helpers/formation-mapper.helper';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { collapseRootParentUid, resolveRootProjectUid } from '../helpers/root-project.helper';
import { getEffectiveUsername, stripAuthPrefix } from '../utils/auth-helper';
import { formationItemAccessService } from './formation-item-access.service';
import {
  appendActivity,
  getActivityForItem,
  getStoredFormation,
  getStoredItem,
  getStoredItemsForFormation,
  nextActivityUid,
  putStoredFormation,
  putStoredItem,
  seedFormation,
} from './formation-store.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { NatsService } from './nats.service';
import { ProjectService } from './project.service';

/**
 * BFF service for the Formation Checklist section and Formations queue (GH-1958/GH-2267). All eight
 * item mutations (complete/skip/request/status/update/accept/reject/reopen), the queue read
 * {@link getFormationsQueue}, and now {@link getProjectFormation}'s checklist read branch on
 * {@link isFormationServiceLive} and call the real `lfx-v2-formation-service` when it is live.
 * {@link getFormationItemOrThrow}/{@link getFormationItemDetail} resolve against whatever the store
 * already holds (fixture) or the live checklist (real) and need no swap marker of their own. The
 * fixture generator's return shape already matches `Formation`/`FormationItem[]`, so downstream
 * code (controllers, Angular services) needed no change when this swap happened. Remaining fixture
 * surface (activity/history, the fixture item store itself) is deleted in GH-2267 Phase 7, not here.
 */
export class FormationService {
  private readonly projectService = new ProjectService();
  private readonly natsService = new NatsService();
  private readonly microserviceProxy = new MicroserviceProxyService();
  private static readonly plainStatusTransitions: ReadonlySet<FormationItemStatus> = new Set(['not_started', 'in_progress', 'blocked']);
  // Per-request cache, keyed off the request object itself so it never outlives one HTTP call.
  // {@link mapLiveItem} is invoked at least twice per live mutation (the pre-read via
  // getFormationItemOrThrow, then the mutation result) purely to read project.slug — this avoids
  // fanning that into two-plus NATS project reads for one user action.
  private readonly projectByRequestCache = new WeakMap<Request, Map<string, Project>>();

  public async getProjectFormation(req: Request, projectSlug: string): Promise<FormationChecklistResponse> {
    logger.debug(req, 'get_project_formation', 'Fetching formation checklist', { projectSlug });

    const { uid, exists } = await this.projectService.getProjectIdBySlug(req, projectSlug);
    if (!exists || !uid) {
      throw new ResourceNotFoundError('Project', projectSlug, { operation: 'get_project_formation', service: 'formation_service', path: req.path });
    }

    // Fixture fallback — used only when isFormationServiceLive() is false. The fixture generator's
    // return shape already matches Formation/FormationItem[], so nothing downstream of this branch
    // needs to change when it's eventually deleted (GH-2267 Phase 7).
    if (!isFormationServiceLive()) {
      const project = await this.projectService.getProjectById(req, uid, false);
      if (!isFormationStageGate(project.stage)) {
        throw new ResourceNotFoundError('Formation', projectSlug, { operation: 'get_project_formation', service: 'formation_service', path: req.path });
      }
      // ROOT collapse (GH-2267 Phase 4): a top-level project's own parent_uid is upstream's hidden
      // ROOT project, never null — see root-project.helper.ts's doc comment for why the BFF is the
      // producer that has to collapse it before it reaches Formation.parent_uid.
      const rootUid = await resolveRootProjectUid(req, this.natsService);
      const collapsedParentUid = collapseRootParentUid(project.parent_uid || null, rootUid) ?? null;
      const { formation, items } = generateMockFormation({
        projectUid: uid,
        projectSlug: project.slug,
        projectName: project.name,
        parentProjectUid: collapsedParentUid,
        stage: project.stage,
      });
      seedFormation(formation, items);

      const storedFormation = getStoredFormation(formation.uid) ?? formation;
      const storedItems = getStoredItemsForFormation(formation.uid);
      const enrichedItems = await this.enrichItems(req, storedItems.length > 0 ? storedItems : items);

      logger.debug(req, 'get_project_formation', 'Returning fixture formation checklist', { projectSlug, item_count: enrichedItems.length });

      return {
        formation: storedFormation,
        template: SEEDED_FORMATION_TEMPLATE,
        items: enrichedItems,
        data_source: 'fixture',
      };
    }

    // Live path (GH-2267 Phase 1 remainder). Reuses fetchLiveChecklistOrDenyNotFound — the same
    // GET/mask this service already uses for the mutation pre-read — parameterized to mask as
    // 'Formation' rather than 'FormationItem' so a non-existent or inaccessible formation surfaces
    // the same way the fixture branch's stage-gate throw above does.
    const checklist = await this.fetchLiveChecklistOrDenyNotFound(req, uid, projectSlug, {
      resource: 'Formation',
      operation: 'get_project_formation',
    });
    const project = await this.getProjectByIdCached(req, uid);

    // ROOT collapse (GH-2267 Phase 4) — same rationale as the fixture branch above.
    const rootUid = await resolveRootProjectUid(req, this.natsService);
    const parentUid = collapseRootParentUid(project.parent_uid || null, rootUid) ?? null;

    // announcement_date has no field on the checklist read itself (upstream's checklist_reader.go
    // reads it from project settings but doesn't return it) — read it from the same source the
    // indexer projection uses for the queue's own announcement_date, so the checklist and
    // /foundation/formations agree by construction. A settings-read failure degrades to null
    // rather than failing the whole checklist (precedent: CommitteeService's inherited-permissions
    // walk).
    const announcementDate = await this.projectService
      .getProjectSettings(req, uid)
      .then((settings) => settings.announcement_date ?? null)
      .catch((error) => {
        logger.warning(req, 'get_project_formation', 'Failed to read project settings for announcement_date, defaulting to null', {
          projectSlug,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });

    const items = await this.enrichItems(
      req,
      checklist.items.map((raw) => mapUpstreamFormationItem(raw, { formationUid: `formation:${uid}`, projectUid: uid, projectSlug: project.slug }))
    );

    const { formation, template } = mapUpstreamFormationChecklist(checklist, { project, parentUid, announcementDate, items });

    logger.debug(req, 'get_project_formation', 'Returning live formation checklist', { projectSlug, item_count: items.length });

    return { formation, template, items, data_source: 'live' };
  }

  /**
   * Every `/formations/:projectUid/items/:itemKey` caller goes through this, which is the sole
   * enforcement point for per-item project visibility (fixes a real gap: the fixture item store is
   * a flat, guessable-uid lookup with no access check of its own — see `assertItemProjectAccess`).
   * Do not add a new item code path that resolves an item any other way.
   *
   * Live mode (GH-2267 Phase 1): the contract has no single-item read, only the full checklist
   * (`GET /formations/{project_uid}`), so this fetches the whole thing and finds `itemKey` in it —
   * every mutation method pays this cost on its pre-read too, same as the fixture path's
   * per-request store lookup.
   */
  public async getFormationItemOrThrow(req: Request, projectUid: string, itemKey: string): Promise<FormationItem> {
    const itemAddress = `${projectUid}/${itemKey}`;

    if (!isFormationServiceLive()) {
      const itemUid = FormationService.itemUidFor(projectUid, itemKey);
      const item = getStoredItem(itemUid);
      if (!item) {
        throw new ResourceNotFoundError('FormationItem', itemAddress, {
          operation: 'get_formation_item',
          service: 'formation_service',
          path: req.path,
        });
      }
      await this.assertItemProjectAccess(req, projectUid, itemAddress);
      return item;
    }

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
    return { item: enriched, history: getActivityForItem(item.formation_uid, item.uid) };
  }

  /**
   * A gating item without gate-writer access doesn't close outright — it moves to
   * `awaiting_acceptance` and sits with the formation team until a `can_complete` caller accepts
   * it (calling this same method again, which then resolves to `done` since they have access).
   * Non-gating items and gate-writer callers on a gating item still resolve straight to `done`.
   * TODO(#1957): swap the putStoredItem/recordActivity fixture writes below for a real
   * lfx-v2-formation-service mutation call once it ships.
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
    const canComplete = await formationItemAccessService.canComplete(req, item);
    const nextStatus: FormationItemStatus = item.is_gating && !canComplete ? 'awaiting_acceptance' : 'done';
    const nextNotes = notes ?? item.notes;

    if (isFormationServiceLive()) {
      const raw = await this.mutateLiveItem(
        req,
        projectUid,
        itemKey,
        item.version,
        { status: nextStatus, note: nextNotes ?? undefined },
        'complete_formation_item'
      );
      const updated = await this.mapLiveItem(req, projectUid, raw);
      logger.info(req, 'complete_formation_item', 'Formation item completion recorded', {
        item_uid: updated.uid,
        is_gating: updated.is_gating,
        status: updated.status,
      });
      return this.enrichSingle(req, updated);
    }

    const updated: FormationItem = { ...item, status: nextStatus, skip_reason: null, notes: nextNotes, updated_at: new Date().toISOString() };
    putStoredItem(updated);
    this.recordActivity(
      req,
      updated,
      'item_completed',
      nextStatus === 'done' ? `marked "${updated.title}" done` : `marked "${updated.title}" ready for the formation team to accept`
    );
    this.refreshFormationReadiness(updated.formation_uid);

    logger.info(req, 'complete_formation_item', 'Formation item completion recorded', { item_uid: item.uid, is_gating: updated.is_gating, status: nextStatus });
    return this.enrichSingle(req, updated);
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

    if (isFormationServiceLive()) {
      const raw = await this.mutateLiveItem(req, projectUid, itemKey, item.version, { status: 'skipped', skip_reason: reason }, 'skip_formation_item');
      const updated = await this.mapLiveItem(req, projectUid, raw);
      logger.info(req, 'skip_formation_item', 'Formation item skipped', { item_uid: updated.uid });
      return this.enrichSingle(req, updated);
    }

    const updated: FormationItem = { ...item, status: 'skipped', skip_reason: reason, updated_at: new Date().toISOString() };
    putStoredItem(updated);
    this.recordActivity(req, updated, 'item_skipped', `skipped "${updated.title}"`, { skip_reason: reason });
    this.refreshFormationReadiness(updated.formation_uid);

    // Reason text goes into skip_reason/activity metadata (both already persisted above), not the
    // log line — a free-text field is the wrong shape for a structured log field.
    logger.info(req, 'skip_formation_item', 'Formation item skipped', { item_uid: item.uid });
    return this.enrichSingle(req, updated);
  }

  /**
   * Files the lightweight Epic-1 `request` action (GH-1958 finding #1) — flips the item to
   * `blocked`, the canonical status's direct successor to the old `waiting_on_partner` (dropped
   * from `FormationItemStatus`; a requested item is, by definition, blocked on someone else). No
   * SLA/target-team object; that richer `request` type is #1957/Epic 2.
   * TODO(#1957): swap the fixture writes below for a real lfx-v2-formation-service mutation call.
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

    if (isFormationServiceLive()) {
      const raw = await this.mutateLiveItem(req, projectUid, itemKey, item.version, { status: 'blocked' }, 'request_formation_item');
      const updated = await this.mapLiveItem(req, projectUid, raw);
      logger.info(req, 'request_formation_item', 'Formation item request filed', { item_uid: updated.uid });
      return this.enrichSingle(req, updated);
    }

    const updated: FormationItem = { ...item, status: 'blocked', updated_at: new Date().toISOString() };
    putStoredItem(updated);
    this.recordActivity(req, updated, 'item_requested', `requested "${updated.title}"`);
    // request also moves `status`, same as complete/skip — the readiness rollup must reflect it
    // (e.g. a previously-done gating item moved back to blocked reopens is_activating).
    this.refreshFormationReadiness(updated.formation_uid);

    logger.info(req, 'request_formation_item', 'Formation item request filed', { item_uid: item.uid });
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
   * TODO(#1957): swap the fixture writes below for a real lfx-v2-formation-service mutation call.
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
    if (item.is_gating && (item.status === 'done' || item.status === 'awaiting_acceptance')) {
      await this.assertCanComplete(req, item, 'update_formation_item_status');
    }
    const nextStatus = status as FormationItemStatus;
    // A block reason is filed as activity metadata below, not written into `notes` — that field
    // is the drawer's free-text note and must survive a status change untouched.
    const blockNote = nextStatus === 'blocked' && typeof note === 'string' ? note : null;

    if (isFormationServiceLive()) {
      // Deliberately omits `note` from the body — same rationale as the fixture branch below: the
      // drawer's free-text `notes` field must survive a plain status change untouched, and the
      // block reason is metadata about the transition, not an item-note update.
      const raw = await this.mutateLiveItem(req, projectUid, itemKey, item.version, { status: nextStatus }, 'update_formation_item_status');
      const updated = await this.mapLiveItem(req, projectUid, raw);
      logger.info(req, 'update_formation_item_status', 'Formation item status changed', { item_uid: updated.uid, status: updated.status });
      return this.enrichSingle(req, updated);
    }

    const updated: FormationItem = {
      ...item,
      status: nextStatus,
      skip_reason: null,
      updated_at: new Date().toISOString(),
    };
    putStoredItem(updated);
    this.recordActivity(req, updated, 'item_reopened', `moved "${updated.title}" to ${nextStatus}`, blockNote !== null ? { note: blockNote } : null);
    this.refreshFormationReadiness(updated.formation_uid);

    logger.info(req, 'update_formation_item_status', 'Formation item status changed', { item_uid: item.uid, status: nextStatus });
    return this.enrichSingle(req, updated);
  }

  /**
   * Notes/assignee/due-date are general drawer editors, not gate_writer-restricted — the ticket
   * scopes `gate_writer` to completing/skipping a *gating* item specifically, not to editing its
   * metadata. No `assertCanComplete` call here by design; ordinary project `writer` (via
   * `assertItemProjectWriteAccess`) is still required, same as every other mutating method.
   * TODO(#1957): swap the fixture writes below for a real lfx-v2-formation-service mutation call.
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

    if (isFormationServiceLive()) {
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
        // path (open the drawer, hit Save without editing), so match the fixture branch below and
        // return the item unchanged rather than issuing a request upstream can only reject.
        logger.debug(req, 'update_formation_item', 'No-op update, skipping upstream call', { item_uid: item.uid });
        return this.enrichSingle(req, item);
      }
      const raw = await this.mutateLiveItem(req, projectUid, itemKey, item.version, body, 'update_formation_item');
      const updated = await this.mapLiveItem(req, projectUid, raw);
      logger.debug(req, 'update_formation_item', 'Formation item updated', { item_uid: updated.uid });
      return this.enrichSingle(req, updated);
    }

    const updated: FormationItem = { ...item, updated_at: new Date().toISOString() };
    if (notesChanged) {
      updated.notes = nextNotes;
      this.recordActivity(req, updated, 'note_added', 'updated notes');
    }
    if (ownerChanged) {
      updated.owner = nextOwnerUsername ? { username: nextOwnerUsername, name: nextOwnerUsername } : null;
      this.recordActivity(req, updated, 'assignee_changed', 'changed the assignee');
    }
    if (dueDateChanged) {
      updated.due_date = patch.due_date ?? null;
      this.recordActivity(req, updated, 'due_date_changed', 'changed the due date');
    }

    putStoredItem(updated);
    logger.debug(req, 'update_formation_item', 'Formation item updated', { item_uid: item.uid });
    return this.enrichSingle(req, updated);
  }

  /**
   * New in GH-2267 Phase 2 — mirrors the upstream `accept` action (design.go item 4), gated there on
   * `team:formation` membership; Epic 1 has no such team, so this fixture-era implementation reuses
   * the existing `gate_writer` (`assertCanComplete`) gate instead. Only meaningful on an item
   * already sitting in `awaiting_acceptance` (i.e. a non-gate-writer already submitted it via
   * `completeFormationItem`) — accepting anything else is a state-precondition error, not a access
   * one. TODO(#1957): swap for a real mutation call once the client lands (Phase 1 remainder); the
   * activity type reused below (`item_completed`) is a placeholder — PR B's activity reconciliation
   * (gap 4) adds a dedicated accept/reject/reopen vocabulary.
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

    if (isFormationServiceLive()) {
      // Unlike PATCH, upstream's accept/reject/reopen always overwrite the note column — omitting
      // it means "the note is now empty", not "leave unchanged" (`acceptance.go`: "Written whether
      // or not one was supplied, so the column means 'the note on this row now'"). Pass the item's
      // current note through when the caller didn't supply one, matching the fixture branch below.
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

    const updated: FormationItem = { ...item, status: 'done', notes: note ?? item.notes, updated_at: new Date().toISOString() };
    putStoredItem(updated);
    this.recordActivity(req, updated, 'item_completed', `accepted "${updated.title}"`, note !== undefined ? { note } : null);
    this.refreshFormationReadiness(updated.formation_uid);

    logger.info(req, 'accept_formation_item', 'Formation item accepted', { item_uid: item.uid });
    return this.enrichSingle(req, updated);
  }

  /**
   * New in GH-2267 Phase 2 — mirrors the upstream `reject` action (design.go item 5), which requires
   * a non-empty note upstream; sends an `awaiting_acceptance` item back to the submitter as
   * `in_progress` rather than closing it. Same fixture-era `gate_writer` substitution as
   * {@link acceptFormationItem}. TODO(#1957): see that method's TODO — applies here too.
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

    if (isFormationServiceLive()) {
      const raw = await this.actLiveItem(req, projectUid, itemKey, 'reject', item.version, { note }, 'reject_formation_item');
      const updated = await this.mapLiveItem(req, projectUid, raw);
      logger.info(req, 'reject_formation_item', 'Formation item rejected', { item_uid: updated.uid });
      return this.enrichSingle(req, updated);
    }

    const updated: FormationItem = { ...item, status: 'in_progress', updated_at: new Date().toISOString() };
    putStoredItem(updated);
    this.recordActivity(req, updated, 'item_reopened', `rejected "${updated.title}"`, { rejected: true, note });
    this.refreshFormationReadiness(updated.formation_uid);

    logger.info(req, 'reject_formation_item', 'Formation item rejected', { item_uid: item.uid });
    return this.enrichSingle(req, updated);
  }

  /**
   * New in GH-2267 Phase 2 — mirrors the upstream `reopen` action (design.go item 6). Reversing a
   * `done`/`skipped`/`awaiting_acceptance` item undoes a prior gate decision, so this reuses
   * `assertCanComplete` the same way `updateFormationItemStatus` does for the equivalent reversal.
   * TODO(#1957): see {@link acceptFormationItem}'s TODO — applies here too.
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

    if (isFormationServiceLive()) {
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

    const updated: FormationItem = { ...item, status: 'in_progress', skip_reason: null, updated_at: new Date().toISOString() };
    putStoredItem(updated);
    this.recordActivity(req, updated, 'item_reopened', `reopened "${updated.title}"`, note !== undefined ? { note } : null);
    this.refreshFormationReadiness(updated.formation_uid);

    logger.info(req, 'reopen_formation_item', 'Formation item reopened', { item_uid: item.uid });
    return this.enrichSingle(req, updated);
  }

  public async getFormationsQueue(req: Request, subStage?: FormationSubStage, search?: string): Promise<FormationsQueueResponse> {
    logger.debug(req, 'get_formations_queue', 'Fetching Formations queue', { subStage, search });

    if (isFormationServiceLive()) {
      return this.getFormationsQueueLive(req, subStage, search);
    }

    // TODO(#1957): swap for a real query-service read once lfx-v2-formation-service ships;
    // the real projection already serves FormationQueueRow's exact shape (gap 2), so this fixture
    // branch has to build one from the Formation fixture + its items instead of returning the
    // Formation itself. Each row is read through the write store first, so a completed/skipped
    // item's readiness rollup (refreshFormationReadiness) is reflected here too, not just on the
    // project-page checklist response.
    let formations = STATIC_QUEUE_FORMATIONS.map((row) => getStoredFormation(row.uid) ?? row);
    if (subStage) {
      formations = formations.filter((row) => row.sub_stage === subStage);
    }
    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      formations = formations.filter((row) => row.parent_project_name.toLowerCase().includes(term));
    }

    // Resolved once per request, not per row — root-project.helper.ts's cache already amortizes
    // the NATS lookup across requests, but there's no reason to await it N times per response.
    const rootUid = await resolveRootProjectUid(req, this.natsService);
    const rows = formations.map((formation) => this.toQueueRow(formation, rootUid));
    const tiles = this.buildQueueTiles();

    return { tiles, rows, data_source: 'fixture' };
  }

  /**
   * GH-1956 Me lens: "My formations" = every formation with at least one checklist item assigned to
   * the caller (decision 2 in the ticket's third comment — a direct-grant-only definition can't be
   * satisfied by the permission model, since it can't distinguish a direct grant from one inherited
   * via a parent project or `lf-staff`/`lf-contractor`). The item index this needs ("which items are
   * assigned to me", one access-filtered query with an assignee filter) doesn't exist upstream yet —
   * see {@link MyFormationItemRow}'s doc comment.
   */
  public async getMyFormationWork(req: Request, username: string): Promise<MyFormationWorkResponse> {
    logger.debug(req, 'get_my_formation_work', 'Fetching formation work assigned to caller');

    // Normalized here rather than trusted from the caller (copilot review, PR #2309): the
    // `/api/user/formation-work` controller passes the raw `getUsernameFromAuth` value (no prefix
    // stripped), while `getUserPendingActions`'s Me-lens aggregation already strips it before
    // calling this method. For an identity like "auth0|alice" the two callers would otherwise hash
    // different strings in `isAssignedToCaller` below and disagree on which formations are assigned
    // to the same signed-in user. Stripping unconditionally here makes both callers agree regardless
    // of what they pass in.
    const normalizedUsername = stripAuthPrefix(username);

    if (isFormationServiceLive()) {
      // TODO(#1957): swap for a real read against the item index once it ships (see the interface
      // doc comment above). Returning empty rather than fabricating fixture rows under a live flag
      // is the honest degradation — the card/tile simply don't render until the index exists.
      logger.warning(req, 'get_my_formation_work', 'Live formation-work read not supported upstream yet, returning empty');
      return { formations: [], items: [], data_source: 'live' };
    }

    const formations: MyFormationSummary[] = [];
    const items: MyFormationItemRow[] = [];

    // Built from the caller's own real accessible projects (via getProjects's access-scoped
    // /query/resources read), not STATIC_QUEUE_FORMATIONS' synthetic queue-project-* rows. The
    // queue rows exist only to populate the staff Formations queue with a fixed demo set — using
    // them here meant `getProjectById` could never resolve `parent_project_uid` (it isn't a real
    // project), so `can_write` silently defaulted to read-only for every row and Open/Claim
    // resolved a different item store than the one `getProjectFormation(projectSlug)` seeds for
    // that same project. Sourcing from real formation-stage projects the caller can already read
    // keeps this response, the checklist page, and the write-access check all pointed at the same
    // project uid and the same seeded item store.
    const rootUid = await resolveRootProjectUid(req, this.natsService);
    // failOnPartial: true — a paged failure here must not build a "successful" response from a
    // prefix of the caller's real projects (copilot review, PR #2309: getProjects's own default is
    // lenient because most callers show a project list where a partial page just means fewer rows
    // rendered; this caller instead uses the result to decide which formations exist for the
    // caller at all, so silent truncation would drop assigned formations/Pending Actions with no
    // signal). Caught below for the same honest-empty degradation the live branch above uses.
    // cel_filter narrows to Formation-stage projects before getProjects's own addAccessToResources
    // FGA batch check runs (dealako review, PR #2309) — the query-service contract documents
    // cel_filter as applied in-process "after OpenSearch, before access control checks", so this
    // shrinks the set the batch check has to cover even though it can't shrink the underlying
    // OpenSearch pagination itself (cel_filter is post-query there). Mirrors isFormationStageGate's
    // own prefix match ('Formation - ') rather than an exact stage list, for the same reason that
    // util documents: a new Formation sub-stage added upstream still matches. The client-side
    // isFormationStageGate filter below is kept as an unconditional backstop, not a substitute —
    // same pattern already used for filters_all in committee-activity.service.ts's notes_added leg.
    let callerProjects: Project[];
    try {
      callerProjects = await this.projectService.getProjects(req, { cel_filter: 'data.stage.startsWith("Formation - ")' }, true);
    } catch (error) {
      logger.warning(req, 'get_my_formation_work', 'Failed to fetch caller projects, returning empty', { err: error });
      return { formations: [], items: [], data_source: 'fixture' };
    }
    const formationProjects = callerProjects.filter((project) => isFormationStageGate(project.stage));

    for (const project of formationProjects) {
      const formationUid = `formation:${project.uid}`;
      let formationRow = getStoredFormation(formationUid) as (Formation & { uid: string }) | undefined;
      let formationItems = formationRow ? getStoredItemsForFormation(formationRow.uid) : [];
      if (!formationRow || formationItems.length === 0) {
        // Never visited via getProjectFormation — generate + seed exactly as that path does, so a
        // claim made from this response's rows is visible on the project's own checklist afterward
        // (and vice versa; see formation-store.service.ts's `seedFormation`, which no-ops if the
        // formation/items are already present).
        const collapsedParentUid = collapseRootParentUid(project.parent_uid || null, rootUid) ?? null;
        const generated = generateMockFormation({
          projectUid: project.uid,
          projectSlug: project.slug,
          projectName: project.name,
          parentProjectUid: collapsedParentUid,
          stage: project.stage,
        });
        seedFormation(generated.formation, generated.items);
        formationRow = (getStoredFormation(generated.formation.uid) as (Formation & { uid: string }) | undefined) ?? generated.formation;
        formationItems = getStoredItemsForFormation(formationRow.uid);
      }

      const assignedItems = formationItems.filter((item) => FormationService.isAssignedToCaller(normalizedUsername, item));
      if (assignedItems.length === 0) continue;

      // Same check `assertItemProjectWriteAccess` runs before actually allowing the mutation — an
      // `auditor`-only assignee is a valid GH-1956 assignee (decision 1: partner contacts are
      // invited as `auditor` or `writer`) but Claim/Block would 403 for them; see `can_write`'s
      // doc comment on `MyFormationItemRow`. Read directly off `project.writer` — `getProjects`
      // already ran the access check for every row above, so there's no second network round trip
      // (and no per-formation failure mode to catch: an upstream error here would already have
      // failed the whole `getProjects` call, consistent with every other real-project read).
      const canWrite = project.writer === true;

      const doneOrSkipped = (item: FormationItem): boolean => item.status === 'done' || item.status === 'skipped';
      const gatingItems = formationItems.filter((item) => item.is_gating);

      formations.push({
        formation_uid: formationRow.uid,
        project_uid: formationRow.parent_project_uid,
        project_slug: formationRow.parent_project_slug,
        project_name: formationRow.parent_project_name,
        sub_stage: formationRow.sub_stage,
        announcement_date: formationRow.announcement_date,
        ...summarizeMyFormationItems(assignedItems),
        // Only true completion counts here — unlike `gating_done` below, a skipped item is not done.
        items_done: formationItems.filter((item) => item.status === 'done').length,
        items_total: formationItems.length,
        gating_done: gatingItems.filter(doneOrSkipped).length,
        gating_total: gatingItems.length,
        blocking_item_title: formationRow.blocking_item_title,
      });

      for (const item of assignedItems.filter((assignedItem) => isAssignedItemOpen(assignedItem.status))) {
        items.push({
          item_uid: item.uid,
          template_item_key: item.template_item_key,
          project_uid: item.project_uid,
          project_slug: formationRow.parent_project_slug,
          project_name: formationRow.parent_project_name,
          title: item.title,
          status: item.status,
          is_gating: item.is_gating,
          due_date: item.due_date,
          action: item.action,
          action_href: item.action_href,
          version: item.version,
          can_write: canWrite,
        });
      }
    }

    logger.debug(req, 'get_my_formation_work', 'Returning fixture formation work', {
      formation_count: formations.length,
      item_count: items.length,
    });

    return { formations, items, data_source: 'fixture' };
  }

  /**
   * Live branch of {@link getFormationsQueue} — the indexer's `formation` projection already
   * matches `FormationQueueRow`'s shape verbatim (GH-2267 plan gap 2), so no per-row mapper is
   * needed, only ROOT collapse and the subStage/search filters the fixture branch also applies.
   * `search` matches on `project_name`, mirroring the fixture branch's `parent_project_name` match.
   * Rows the caller can't read are simply absent from `/query/resources` (per-row `auditor`
   * enforcement upstream), so no additional access filtering is needed here.
   */
  private async getFormationsQueueLive(req: Request, subStage?: FormationSubStage, search?: string): Promise<FormationsQueueResponse> {
    // subStage/search are applied client-side below, not as query-service params — the contract
    // (GH-2267 plan §7's `getFormationsQueue` row) only documents `type=formation` and an
    // `assignee:<username>` tag for "Mine"; there's no confirmed server-side sub_stage/name filter.
    // failOnPartial: true — buildQueueTilesFromRows below is pure counting over rawRows, and a
    // silently-partial page set would render wrong tile totals with no indication anything failed.
    const rawRows = await fetchAllQueryResources<FormationQueueRow>(
      req,
      (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<FormationQueueRow>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'formation',
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

    const tiles = this.buildQueueTilesFromRows(normalizedRows);

    return { tiles, rows, data_source: 'live' };
  }
  /**
   * Deterministic SHA-256-seeded "is this item assigned to the caller" check (never `Math.random()`)
   * — a fixture item's real `owner` is drawn from a synthetic staff pool
   * (`formation-fixture.helper.ts`'s `SYNTHETIC_STAFF`) that never matches a real signed-in username,
   * so GH-1956 assignment is derived independently of `owner` rather than gated on it. ~30% of a
   * caller's items land in their own queue — enough to populate "My formations" for demo purposes
   * without every formation landing on every caller, satisfying the ticket's acceptance criterion
   * that a staff member does not see every formation here.
   *
   * TODO(#1957): purely a function of `username`/`item.uid` — it does not check that the caller
   * actually has any role on `item`'s project. That's safe only because the fixture branch is
   * synthetic data with no real entitlements to leak. When the live assignment source lands, it
   * must gate on a real project-access check (e.g. `assertItemProjectAccess`) before including an
   * item, not just swap this hash for a real assignee lookup — otherwise a caller could see items
   * on a project they can't actually access.
   */
  private static isAssignedToCaller(username: string, item: FormationItem): boolean {
    const digest = crypto.createHash('sha256').update(`${username}:${item.uid}`).digest();
    return digest.readUInt32BE(0) / 0xffffffff < 0.3;
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
      return await this.microserviceProxy.proxyRequest<UpstreamFormationChecklist>(
        req,
        'LFX_V2_FORMATION_SERVICE',
        `/formations/${encodeURIComponent(projectUid)}`,
        'GET'
      );
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
   * this path (gap 3) — synthesized deterministically from `projectUid`, mirroring the fixture
   * generator's own `formation:<project_uid>` convention so both backends agree on the shape.
   */
  private async mapLiveItem(req: Request, projectUid: string, raw: UpstreamFormationItem): Promise<FormationItem> {
    const project = await this.getProjectByIdCached(req, projectUid);
    const ctx: FormationItemMapContext = { formationUid: `formation:${projectUid}`, projectUid, projectSlug: project.slug };
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
   * `skipped`/`awaiting_acceptance` in addition to `done`, matching the fixture-era behavior
   * documented on {@link reopenFormationItem}) — so the live path must still be prepared for
   * upstream's own 409 `Conflict` (`internal/service/acceptance.go`'s `wrongStatusReason`) on a
   * status this BFF's guard let through. Mapped the same shape as the fixture branch's own
   * conflict errors, not left as a raw `MicroserviceError`.
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
   * Fixture-only address→uid bridge (GH-2267 Phase 2) — the store's flat item map is still keyed by
   * the fixture uid (`formation-item:<project_uid>:<item_key>`, see `generateMockFormation`'s seed
   * in `formation-fixture.helper.ts`), but every route/controller/client call above this service now
   * addresses items by `(project_uid, item_key)`, matching the real service's contract. TODO(#1957):
   * the real client drops this entirely — items are addressed by `(project_uid, item_key)` all the
   * way down, with no uid reconstruction needed.
   */
  private static itemUidFor(projectUid: string, itemKey: string): string {
    return `formation-item:${projectUid}:${itemKey}`;
  }

  /**
   * Fixture-only adapter from {@link Formation} + its stored items to {@link FormationQueueRow} —
   * the real client won't need this once `getFormationsQueue`'s live branch reads the indexer's
   * projection directly (that document already carries this exact shape; see gap 2 in the GH-2267
   * plan). `lifecycle` has no fixture source (it's a project-service concept the Formation fixture
   * never modeled) — `'formation'` is a stand-in for every queue row, all of which are pre-Activation.
   */
  private toQueueRow(formation: Formation, rootUid: string | null): FormationQueueRow {
    // Formation.uid is optional only because the checklist read can't source it (see its doc
    // comment) — every queue-fixture row (STATIC_QUEUE_FORMATIONS, and anything seeded over it in
    // the write store) sets it explicitly, so it's always present on this path.
    const formationUid = formation.uid as string;
    const items = getStoredItemsForFormation(formationUid);
    const gatingItems = items.filter((item) => item.is_gating);
    const blockedGatingItems = gatingItems.filter((item) => item.status === 'blocked');

    const progress: Record<FormationItemStatus, number> = {
      not_started: 0,
      in_progress: 0,
      blocked: 0,
      awaiting_acceptance: 0,
      done: 0,
      skipped: 0,
    };
    if (items.length > 0) {
      for (const item of items) {
        progress[item.status] += 1;
      }
    } else {
      // STATIC_QUEUE_FORMATIONS rows are never seeded into the per-item write store — only visiting
      // a project's own checklist (getProjectFormation) does that. Without this fallback, every
      // never-visited demo row would recompute as "0 of 0" from an empty item list, discarding the
      // formation's own precomputed gating aggregate (which STATIC_QUEUE_FORMATIONS bakes in and
      // refreshFormationReadiness keeps current for any row a mutation has touched).
      progress.done = formation.gating_items_total - formation.gating_items_open;
      progress.not_started = formation.gating_items_open;
    }
    const blockedItemTitles = items.length > 0 ? blockedGatingItems.map((item) => item.title) : (formation.blocking_item_title?.split(', ') ?? []);

    // FormationQueueRow.assignees is bare usernames (matching the live indexer projection) — a
    // Set, not a Map keyed by FormationUser, since the fixture has no separate display-name source.
    const assigneeUsernames = new Set<string>();
    for (const item of items) {
      if (item.owner) {
        assigneeUsernames.add(item.owner.username);
      }
    }

    return {
      formation_uid: formationUid,
      project_uid: formation.parent_project_uid,
      project_name: formation.parent_project_name,
      project_slug: formation.parent_project_slug,
      is_foundation: formation.is_foundation,
      // ROOT collapse (GH-2267 Phase 4) — see root-project.helper.ts. Fixture rows already store
      // null/a real parent, so this is a no-op for them; it matters once the live projection (which
      // copies the project service's parent_uid verbatim) is wired in.
      parent_uid: collapseRootParentUid(formation.parent_uid, rootUid) ?? null,
      sub_stage: formation.sub_stage,
      lifecycle: 'formation',
      // Sourced from the formation's own precomputed rollup, not re-derived from `items` here — that
      // rollup (STATIC_QUEUE_FORMATIONS's baked-in defaults, kept current by refreshFormationReadiness
      // on every mutation) is correct even for a never-visited demo row with no tracked items.
      gates_cleared: formation.gating_items_total > 0 && formation.gating_items_open === 0,
      is_activating: formation.is_activating,
      announcement_date: formation.announcement_date,
      progress,
      blocked_item_titles: blockedItemTitles,
      assignees: Array.from(assigneeUsernames),
    };
  }

  private buildQueueTiles(): FormationsQueueResponse['tiles'] {
    // Every uid here already came from STATIC_QUEUE_FORMATIONS, so no scoping check is needed to
    // resolve each row through the write store first (a completed/skipped item's readiness rollup
    // must be reflected in these counts too, not just the raw static fixture).
    const rows = STATIC_QUEUE_FORMATIONS.map((row) => getStoredFormation(row.uid) ?? row);
    const bySubStage = Object.fromEntries(FORMATION_QUEUE_SUB_STAGES.map((stage) => [stage, 0])) as Record<FormationSubStage, number>;
    for (const row of rows) {
      bySubStage[row.sub_stage] = (bySubStage[row.sub_stage] ?? 0) + 1;
    }

    // The tile subLine only has room for a foundations/projects split — a bare 'project' entity (no
    // foundation/child_project formation ceremony) rolls into the projects count so it isn't
    // silently dropped from the breakdown while still counting toward `total`.
    return {
      ...bySubStage,
      total: rows.length,
      foundations: rows.filter((row) => deriveFormationEntityType(row) === 'foundation').length,
      projects: rows.filter((row) => deriveFormationEntityType(row) !== 'foundation').length,
    };
  }

  /**
   * Live counterpart of {@link buildQueueTiles} — tiles are computed from the full unfiltered
   * `FormationQueueRow[]` (pre-ROOT-collapse, since `deriveFormationEntityType` only needs
   * `is_foundation`/whether `parent_uid` is set, and collapsing null→null is a no-op either way),
   * matching the fixture branch's own "tiles reflect the whole queue, not the filtered view" contract.
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

  private recordActivity(
    req: Request,
    item: FormationItem,
    type: FormationActivity['type'],
    message: string,
    metadata: Record<string, unknown> | null = null
  ): void {
    const username = getEffectiveUsername(req) || 'unknown';
    appendActivity({
      uid: nextActivityUid(),
      formation_uid: item.formation_uid,
      formation_item_uid: item.uid,
      type,
      actor: { username, name: username },
      message,
      metadata,
      created_at: new Date().toISOString(),
    });
  }

  /**
   * `sub_stage` (exploratory/engaged/on_hold) is never touched here — it tracks the project's real
   * stage independently of gating status. Only `is_activating` flips on gating completion; there is
   * no lossy "revert to engaged" case to worry about since nothing ever overwrites `sub_stage` in
   * the first place.
   */
  private refreshFormationReadiness(formationUid: string): void {
    const formation = getStoredFormation(formationUid);
    if (!formation) return;

    const items = getStoredItemsForFormation(formationUid);
    const gatingItems = items.filter((item) => item.is_gating);
    // A skipped gating item is resolved, not open — skipFormationItem is the designed escape hatch
    // for a gate the project can't complete, mirroring deriveFormationReadinessSummary's
    // client-side rollup (formation-checklist.utils.ts). isActivating also factors in
    // announcement_date as an independent activation trigger, same as the client util, so the
    // strip/tiles/queue rollups all agree on when a formation is ready.
    const openGatingItems = gatingItems.filter((item) => item.status !== 'done' && item.status !== 'skipped');
    const hasAnnounced = !!formation.announcement_date && Date.parse(formation.announcement_date) <= Date.now();
    const isActivating = (gatingItems.length > 0 && openGatingItems.length === 0) || hasAnnounced;
    // Blocking column reflects items actually in `blocked` status specifically, not "first not-done
    // gating item" — `awaiting_acceptance`/`in_progress`/`not_started` items are open but not blocking.
    const blockedGatingItems = gatingItems.filter((item) => item.status === 'blocked');
    const blockingItemTitle = blockedGatingItems.length > 0 ? blockedGatingItems.map((item) => item.title).join(', ') : null;

    putStoredFormation({
      ...formation,
      // Anything the store hands back was written keyed by uid, so it's always present here even
      // though `getStoredFormation`'s declared return type doesn't narrow that.
      uid: formationUid,
      gating_items_open: openGatingItems.length,
      gating_items_total: gatingItems.length,
      is_activating: isActivating,
      blocking_item_title: blockingItemTitle,
      updated_at: new Date().toISOString(),
    });
  }

  /**
   * The formation-item fixture store is a flat, guessable-uid lookup (`formation-item:<project
   * uid>:<template key>`) with no access check of its own — resolving the item's parent project
   * through the user's own bearer token is the actual enforcement point, mirroring the same
   * upstream visibility check `GET /api/projects/:slug` already relies on. A project this caller
   * can't see throws here (404/403 from the upstream project service) before any item data or
   * mutation is returned.
   */
  private async assertItemProjectAccess(req: Request, projectUid: string, itemAddress: string): Promise<void> {
    // Always throws the same "FormationItem not found" shape as the missing-address branch above
    // (getFormationItemOrThrow), keyed by the same public `${projectUid}/${itemKey}` address rather
    // than the internal fixture uid — regardless of which check actually failed, a differentiated
    // error would let a caller distinguish "this item doesn't exist" from "it exists and you can't
    // see it", an account/resource enumeration oracle. The real cause is still logged for operators.
    //
    // Takes `projectUid` directly (GH-2267 Phase 1) rather than resolving it via a formation-record
    // lookup keyed by `item.formation_uid` — that lookup (`getStoredFormation`/
    // `STATIC_QUEUE_FORMATIONS`) is fixture-only and has no live equivalent, while every caller
    // already has `projectUid` in hand. Works identically for both backends.
    try {
      await this.projectService.getProjectById(req, projectUid, false);
    } catch (error) {
      logger.debug(req, 'assert_item_project_access', 'Denying formation-item access', { item_address: itemAddress, err: error });
      throw new ResourceNotFoundError('FormationItem', itemAddress, { operation: 'get_formation_item', service: 'formation_service', path: req.path });
    }
  }

  /**
   * Required before any mutation (complete/skip/request/update) — `assertItemProjectAccess`
   * (called first, via `getFormationItemOrThrow`) only requires the `viewer` relation, which is
   * enough to read the checklist but not enough to change it. Callers here have already passed
   * that read gate, so a denial is a plain `AuthorizationError` (403) rather than the "not found"
   * masking `assertItemProjectAccess` uses — the caller already legitimately knows this item
   * exists, so there is no existence-oracle risk in saying so.
   */
  private async assertItemProjectWriteAccess(req: Request, projectUid: string): Promise<void> {
    // Takes `projectUid` directly, same rationale as `assertItemProjectAccess` above.
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
   * can't push unbounded text into the never-evicted fixture activity store or into this log line.
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
