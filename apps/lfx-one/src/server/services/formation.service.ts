// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  Formation,
  FormationActivity,
  FormationChecklistResponse,
  FormationItem,
  FormationsQueueResponse,
  FormationSubStage,
} from '@lfx-one/shared/interfaces';
import { FORMATION_QUEUE_SUB_STAGES } from '@lfx-one/shared/constants';
import { Request } from 'express';

import { AuthorizationError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { isFormationServiceLive } from '../helpers/formation-backend.helper';
import { generateMockFormation, SEEDED_FORMATION_TEMPLATE, STATIC_QUEUE_FORMATIONS } from '../helpers/formation-fixture.helper';
import { getEffectiveUsername } from '../utils/auth-helper';
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
import { ProjectService } from './project.service';

/**
 * BFF service for the Formation Checklist section and Formations queue (GH-1958). Only
 * {@link getProjectFormation} branches on {@link isFormationServiceLive} today; the item mutations
 * (complete/skip/request/update), {@link declineFormation}, and the queue read
 * {@link getFormationsQueue} are fixture-only and each carry their own `// TODO(#1957)` marking the
 * real `lfx-v2-formation-service` swap. {@link acceptFormation} is a read (a deep link, no state
 * change — nothing real to accept into yet) and {@link getFormationItemOrThrow}/
 * {@link getFormationItemDetail} resolve against whatever the store already holds; none of the
 * three need a swap marker of their own. The fixture generator's return shape already matches
 * `Formation`/`FormationItem[]`, so downstream code (controllers, Angular services) needs no change
 * when the swap happens.
 */
export class FormationService {
  private readonly projectService = new ProjectService();

  public async getProjectFormation(req: Request, projectSlug: string): Promise<FormationChecklistResponse> {
    logger.debug(req, 'get_project_formation', 'Fetching formation checklist', { projectSlug });

    const { uid, exists } = await this.projectService.getProjectIdBySlug(req, projectSlug);
    if (!exists || !uid) {
      throw new ResourceNotFoundError('Project', projectSlug, { operation: 'get_project_formation', service: 'formation_service', path: req.path });
    }

    // TODO(#1957): swap for a NATS/HTTP call to lfx-v2-formation-service once it ships. The
    // fixture generator's return shape already matches Formation/FormationItem[], so nothing
    // downstream of this branch needs to change.
    if (!isFormationServiceLive()) {
      const project = await this.projectService.getProjectById(req, uid, false);
      const { formation, items } = generateMockFormation({
        projectUid: uid,
        projectSlug: project.slug,
        projectName: project.name,
        parentProjectUid: project.parent_uid || null,
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

    throw new ResourceNotFoundError('Formation', projectSlug, { operation: 'get_project_formation', service: 'formation_service', path: req.path });
  }

  /**
   * Every `/formation-items/:uid` caller goes through this, which is the sole enforcement point
   * for per-item project visibility (fixes a real gap: the fixture item store is a flat, guessable-uid
   * lookup with no access check of its own — see `assertItemProjectAccess`). Do not add a new
   * `/formation-items/:uid` code path that resolves an item any other way.
   */
  public async getFormationItemOrThrow(req: Request, itemUid: string): Promise<FormationItem> {
    const item = getStoredItem(itemUid);
    if (!item) {
      throw new ResourceNotFoundError('FormationItem', itemUid, { operation: 'get_formation_item', service: 'formation_service', path: req.path });
    }
    await this.assertItemProjectAccess(req, item, itemUid);
    return item;
  }

  public async getFormationItemDetail(req: Request, itemUid: string): Promise<{ item: FormationItem; history: FormationActivity[] }> {
    const item = await this.getFormationItemOrThrow(req, itemUid);
    const [enriched] = await this.enrichItems(req, [item]);
    return { item: enriched, history: getActivityForItem(item.formation_uid, item.uid) };
  }

  // TODO(#1957): swap the putStoredItem/recordActivity fixture writes below for a real
  // lfx-v2-formation-service mutation call once it ships.
  public async completeFormationItem(req: Request, itemUid: string, notes?: unknown): Promise<FormationItem> {
    this.assertValidNotes(notes, req, 'complete_formation_item');
    const item = await this.getFormationItemOrThrow(req, itemUid);
    await this.assertItemProjectWriteAccess(req, item);
    await this.assertCanComplete(req, item, 'complete_formation_item');
    const updated: FormationItem = { ...item, status: 'done', skip_reason: null, notes: notes ?? item.notes, updated_at: new Date().toISOString() };
    putStoredItem(updated);
    this.recordActivity(req, updated, 'item_completed', `marked "${updated.title}" done`);
    this.refreshFormationReadiness(updated.formation_uid);

    logger.info(req, 'complete_formation_item', 'Formation item marked done', { item_uid: itemUid, is_gating: updated.is_gating });
    return this.enrichSingle(req, updated);
  }

  // TODO(#1957): swap the fixture writes below for a real lfx-v2-formation-service mutation call.
  public async skipFormationItem(req: Request, itemUid: string, reason: unknown): Promise<FormationItem> {
    this.assertValidReason(reason, 'A reason is required to skip a gating item', req, 'skip_formation_item');

    const item = await this.getFormationItemOrThrow(req, itemUid);
    await this.assertItemProjectWriteAccess(req, item);
    await this.assertCanComplete(req, item, 'skip_formation_item');
    const updated: FormationItem = { ...item, status: 'skipped', skip_reason: reason, updated_at: new Date().toISOString() };
    putStoredItem(updated);
    this.recordActivity(req, updated, 'item_skipped', `skipped "${updated.title}"`, { skip_reason: reason });
    this.refreshFormationReadiness(updated.formation_uid);

    // Reason text goes into skip_reason/activity metadata (both already persisted above), not the
    // log line — a free-text field is the wrong shape for a structured log field.
    logger.info(req, 'skip_formation_item', 'Formation item skipped', { item_uid: itemUid });
    return this.enrichSingle(req, updated);
  }

  /**
   * Files the lightweight Epic-1 `request` action (GH-1958 finding #1) — flips the item to
   * `waiting_on_partner`. No SLA/target-team object; that richer `request` type is #1957/Epic 2.
   * TODO(#1957): swap the fixture writes below for a real lfx-v2-formation-service mutation call.
   */
  public async requestFormationItem(req: Request, itemUid: string): Promise<FormationItem> {
    const item = await this.getFormationItemOrThrow(req, itemUid);
    await this.assertItemProjectWriteAccess(req, item);
    // Same gate as complete/skip: `request` also changes `status`, so a gating item's status must
    // not be movable through this action by a caller `complete`/`skip` would deny.
    await this.assertCanComplete(req, item, 'request_formation_item');
    const updated: FormationItem = { ...item, status: 'waiting_on_partner', updated_at: new Date().toISOString() };
    putStoredItem(updated);
    this.recordActivity(req, updated, 'item_requested', `requested "${updated.title}"`);
    // request also moves `status`, same as complete/skip — the readiness rollup must reflect it
    // (e.g. a previously-done gating item moved back to waiting_on_partner reopens is_activating).
    this.refreshFormationReadiness(updated.formation_uid);

    logger.info(req, 'request_formation_item', 'Formation item request filed', { item_uid: itemUid });
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
    itemUid: string,
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
    if (patch.due_date !== undefined && patch.due_date !== null && (typeof patch.due_date !== 'string' || Number.isNaN(Date.parse(patch.due_date)))) {
      throw ServiceValidationError.forField('due_date', 'due_date must be a valid ISO date string or null', {
        operation: 'update_formation_item',
        service: 'formation_service',
        path: req.path,
      });
    }

    const item = await this.getFormationItemOrThrow(req, itemUid);
    await this.assertItemProjectWriteAccess(req, item);
    const updated: FormationItem = { ...item, updated_at: new Date().toISOString() };

    // Normalized the same way owner_username is below: the drawer always sends '' for an empty
    // textarea (formation-item-drawer.component.ts), while a freshly generated item has notes:
    // null — without normalizing, '' !== null on every first save (even one that only touches
    // due_date) would spuriously flip notes and record an "updated notes" activity that never happened.
    const nextNotes = patch.notes || null;
    if (patch.notes !== undefined && nextNotes !== (item.notes ?? null)) {
      updated.notes = nextNotes;
      this.recordActivity(req, updated, 'note_added', 'updated notes');
    }
    const nextOwnerUsername = patch.owner_username || null;
    if (patch.owner_username !== undefined && nextOwnerUsername !== (item.owner?.username ?? null)) {
      updated.owner = nextOwnerUsername ? { username: nextOwnerUsername, name: nextOwnerUsername } : null;
      this.recordActivity(req, updated, 'assignee_changed', 'changed the assignee');
    }
    if (patch.due_date !== undefined && patch.due_date !== item.due_date) {
      updated.due_date = patch.due_date;
      this.recordActivity(req, updated, 'due_date_changed', 'changed the due date');
    }

    putStoredItem(updated);
    logger.debug(req, 'update_formation_item', 'Formation item updated', { item_uid: itemUid });
    return this.enrichSingle(req, updated);
  }

  public async getFormationsQueue(req: Request, subStage?: FormationSubStage, search?: string): Promise<FormationsQueueResponse> {
    logger.debug(req, 'get_formations_queue', 'Fetching Formations queue', { subStage, search });

    // TODO(#1957): swap for a real query-service read once lfx-v2-formation-service ships;
    // STATIC_QUEUE_FORMATIONS's shape already matches Formation[]. Each row is read through the
    // write store first — a prior Accept/Decline on this row must be reflected here, not just on
    // its own response (declineFormation writes via putStoredFormation). getQueueFormation's
    // queue-only scoping check is unnecessary here — every uid already came from
    // STATIC_QUEUE_FORMATIONS itself, unlike Accept/Decline's caller-supplied uid.
    let rows = STATIC_QUEUE_FORMATIONS.map((row) => getStoredFormation(row.uid) ?? row);
    if (subStage) {
      rows = rows.filter((row) => row.sub_stage === subStage);
    }
    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      rows = rows.filter((row) => row.parent_project_name.toLowerCase().includes(term));
    }

    const tiles = this.buildQueueTiles(req);

    return { tiles, rows, data_source: 'fixture' };
  }

  /** Returns a deep link to the external admin tool. No state mutation — nothing real to accept into yet (#1957). */
  public async acceptFormation(req: Request, formationUid: string): Promise<{ deep_link_url: string }> {
    const formation = this.getQueueFormation(formationUid);
    if (!formation) {
      throw new ResourceNotFoundError('Formation', formationUid, { operation: 'accept_formation', service: 'formation_service', path: req.path });
    }

    logger.info(req, 'accept_formation', 'Formations queue Accept — returning admin-tool deep link (fixture, no state change)', {
      formation_uid: formationUid,
    });
    return { deep_link_url: `https://admin.linuxfoundation.org/formations/${encodeURIComponent(formation.parent_project_slug)}` };
  }

  // TODO(#1957): swap the fixture writes below for a real lfx-v2-formation-service mutation call.
  public async declineFormation(req: Request, formationUid: string, reason: unknown): Promise<Formation> {
    this.assertValidReason(reason, 'A reason is required to decline a formation', req, 'decline_formation');

    const existing = this.getQueueFormation(formationUid);
    if (!existing) {
      throw new ResourceNotFoundError('Formation', formationUid, { operation: 'decline_formation', service: 'formation_service', path: req.path });
    }

    const declined: Formation = { ...existing, state: 'withdrawn', sub_stage: 'withdrawn', updated_at: new Date().toISOString() };
    putStoredFormation(declined);

    const actor = { username: getEffectiveUsername(req) || 'unknown', name: getEffectiveUsername(req) || 'Unknown' };
    appendActivity({
      uid: nextActivityUid(),
      formation_uid: declined.uid,
      formation_item_uid: null,
      type: 'formation_declined',
      actor,
      message: `declined "${declined.parent_project_name}": ${reason}`,
      metadata: { reason },
      created_at: new Date().toISOString(),
    });

    // TODO(#1957): replace this log-only stub with a real email-service notification once
    // lfx-v2-formation-service ships — this is explicitly a no-op today, not a degraded real path.
    // Deliberately no `proposer` field here: today it's fixture-only, but this line is written
    // against Formation.proposer, and the #1957 swap would turn a real LFID into an unredacted
    // application-log emission with no second review of this line to catch it.
    logger.info(req, 'decline_formation', 'Would notify proposer (stub — #1957 owns real email-service integration)', {
      formation_uid: formationUid,
    });

    return declined;
  }

  /**
   * Resolves a queue formation uid through the write store first, scoped to `STATIC_QUEUE_FORMATIONS`
   * only — `undefined` for a project-checklist formation uid (`getProjectFormation` seeds those into
   * the same store under `formation:<projectUid>`). Accept/Decline must never resolve one of those:
   * a decline would permanently corrupt that project's checklist to `withdrawn`
   * (`refreshFormationReadiness` deliberately never un-withdraws it), with no un-decline path.
   */
  private getQueueFormation(formationUid: string): Formation | undefined {
    const staticRow = STATIC_QUEUE_FORMATIONS.find((row) => row.uid === formationUid);
    if (!staticRow) return undefined;
    return getStoredFormation(formationUid) ?? staticRow;
  }

  private buildQueueTiles(req: Request): FormationsQueueResponse['tiles'] {
    // Same rationale as getFormationsQueue — every uid here already came from
    // STATIC_QUEUE_FORMATIONS, so getQueueFormation's scoping check is unnecessary.
    const rows = STATIC_QUEUE_FORMATIONS.map((row) => getStoredFormation(row.uid) ?? row);
    const bySubStage = Object.fromEntries(FORMATION_QUEUE_SUB_STAGES.map((stage) => [stage, 0])) as Record<FormationSubStage, number>;
    for (const row of rows) {
      bySubStage[row.sub_stage] = (bySubStage[row.sub_stage] ?? 0) + 1;
    }

    // `lead`/`proposer` carry usernames, not emails — compare against the caller's username, not their email.
    const username = getEffectiveUsername(req);
    // The tile subLine only has room for a foundations/subprojects split — a bare 'project' entity
    // (no foundation/subproject formation ceremony) rolls into the subprojects count so it isn't
    // silently dropped from the breakdown while still counting toward `total`.
    return {
      ...bySubStage,
      total: rows.length,
      foundations: rows.filter((row) => row.entity_type === 'foundation').length,
      subprojects: rows.filter((row) => row.entity_type === 'subproject' || row.entity_type === 'project').length,
      mine: rows.filter((row) => row.lead?.username === username || row.proposer?.username === username).length,
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

  private refreshFormationReadiness(formationUid: string): void {
    const formation = getStoredFormation(formationUid);
    if (!formation) return;

    const items = getStoredItemsForFormation(formationUid);
    const gatingItems = items.filter((item) => item.is_gating);
    // A skipped gating item is resolved, not open — skipFormationItem is the designed escape hatch
    // for a gate the project can't complete; treating it as still-open would make isActivating
    // permanently unreachable for any formation that ever uses it.
    const openGatingItems = gatingItems.filter((item) => item.status !== 'done' && item.status !== 'skipped');
    const isActivating = gatingItems.length > 0 && openGatingItems.length === 0;

    // `generateMockFormation` derives the initial sub_stage from is_activating (mapProjectStageToSubStage)
    // — this recompute must track it the same way, or completing the last gating item leaves a stored
    // formation with is_activating: true but a stale sub_stage. 'withdrawn' is a terminal Decline state
    // this method must never override. The original pre-activating sub_stage isn't preserved anywhere,
    // so reverting out of 'activating' falls back to 'engaged' — the generator's own default case.
    let subStage: FormationSubStage = formation.sub_stage;
    if (formation.sub_stage !== 'withdrawn') {
      if (isActivating) {
        subStage = 'activating';
      } else if (formation.sub_stage === 'activating') {
        subStage = 'engaged';
      }
    }

    putStoredFormation({
      ...formation,
      sub_stage: subStage,
      gating_items_open: openGatingItems.length,
      gating_items_total: gatingItems.length,
      is_activating: isActivating,
      blocking_item_title: openGatingItems[0]?.title ?? null,
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
  private async assertItemProjectAccess(req: Request, item: Pick<FormationItem, 'formation_uid'>, itemUid: string): Promise<void> {
    // Always throws the same "FormationItem not found" shape as the missing-uid branch above,
    // regardless of which check actually failed (dangling formation reference vs. an upstream
    // project-visibility denial) — a differentiated error would let a caller distinguish "this
    // item doesn't exist" from "it exists and you can't see it", an account/resource enumeration
    // oracle. The real cause is still logged for operators.
    const denyNotFound = (cause: unknown): never => {
      logger.debug(req, 'assert_item_project_access', 'Denying formation-item access', { item_uid: itemUid, err: cause });
      throw new ResourceNotFoundError('FormationItem', itemUid, { operation: 'get_formation_item', service: 'formation_service', path: req.path });
    };

    const formation = getStoredFormation(item.formation_uid) ?? STATIC_QUEUE_FORMATIONS.find((row) => row.uid === item.formation_uid);
    if (!formation) {
      denyNotFound(new Error(`no formation record for formation_uid ${item.formation_uid}`));
      return;
    }

    try {
      await this.projectService.getProjectById(req, formation.parent_project_uid, false);
    } catch (error) {
      denyNotFound(error);
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
  private async assertItemProjectWriteAccess(req: Request, item: Pick<FormationItem, 'formation_uid'>): Promise<void> {
    const formation = getStoredFormation(item.formation_uid) ?? STATIC_QUEUE_FORMATIONS.find((row) => row.uid === item.formation_uid);
    if (!formation) {
      throw new ResourceNotFoundError('Formation', item.formation_uid, {
        operation: 'assert_item_project_write_access',
        service: 'formation_service',
        path: req.path,
      });
    }

    const project = await this.projectService.getProjectById(req, formation.parent_project_uid, true);
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
   * Shared by `skipFormationItem`/`declineFormation`. Same `unknown`-at-the-boundary rationale as
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

  private async enrichItems(req: Request, items: FormationItem[]): Promise<FormationItem[]> {
    return Promise.all(items.map((item) => this.enrichSingle(req, item)));
  }

  private async enrichSingle(req: Request, item: FormationItem): Promise<FormationItem> {
    const canComplete = await formationItemAccessService.canComplete(req, item);
    return { ...item, can_complete: canComplete };
  }
}

export const formationService = new FormationService();
