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

import { ResourceNotFoundError, ServiceValidationError } from '../errors';
import { isFormationServiceLive } from '../helpers/formation-backend.helper';
import {
  appendActivity,
  generateMockFormation,
  getActivityForItem,
  getStoredFormation,
  getStoredItem,
  getStoredItemsForFormation,
  nextActivityUid,
  putStoredFormation,
  putStoredItem,
  seedFormation,
  SEEDED_FORMATION_TEMPLATE,
  STATIC_QUEUE_FORMATIONS,
} from '../helpers/formation-fixture.helper';
import { getEffectiveEmail, getEffectiveUsername } from '../utils/auth-helper';
import { formationItemAccessService } from './formation-item-access.service';
import { logger } from './logger.service';
import { ProjectService } from './project.service';

/**
 * BFF service for the Formation Checklist section and Formations queue (GH-1958). Every public
 * method branches on {@link isFormationServiceLive} — currently always the fixture path — so this
 * is the single place `// TODO(#1957)` marks the real `lfx-v2-formation-service` swap; the fixture
 * generator's return shape already matches `Formation`/`FormationItem[]`, so downstream code
 * (controllers, Angular services) needs no change when that swap happens.
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

  public async getFormationItemOrThrow(req: Request, itemUid: string): Promise<FormationItem> {
    const item = getStoredItem(itemUid);
    if (!item) {
      throw new ResourceNotFoundError('FormationItem', itemUid, { operation: 'get_formation_item', service: 'formation_service', path: req.path });
    }
    return item;
  }

  public async getFormationItemDetail(req: Request, itemUid: string): Promise<{ item: FormationItem; history: FormationActivity[] }> {
    const item = await this.getFormationItemOrThrow(req, itemUid);
    const [enriched] = await this.enrichItems(req, [item]);
    return { item: enriched, history: getActivityForItem(item.formation_uid, item.uid) };
  }

  public async completeFormationItem(req: Request, itemUid: string, notes?: string): Promise<FormationItem> {
    const item = await this.getFormationItemOrThrow(req, itemUid);
    const updated: FormationItem = { ...item, status: 'done', skip_reason: null, notes: notes ?? item.notes, updated_at: new Date().toISOString() };
    putStoredItem(updated);
    this.recordActivity(req, updated, 'item_completed', `marked "${updated.title}" done`);
    this.refreshFormationReadiness(updated.formation_uid);

    logger.info(req, 'complete_formation_item', 'Formation item marked done', { item_uid: itemUid, is_gating: updated.is_gating });
    return this.enrichSingle(req, updated);
  }

  public async skipFormationItem(req: Request, itemUid: string, reason: string): Promise<FormationItem> {
    if (!reason || !reason.trim()) {
      throw ServiceValidationError.forField('reason', 'A reason is required to skip a gating item', {
        operation: 'skip_formation_item',
        service: 'formation_service',
        path: req.path,
      });
    }

    const item = await this.getFormationItemOrThrow(req, itemUid);
    const updated: FormationItem = { ...item, status: 'skipped', skip_reason: reason, updated_at: new Date().toISOString() };
    putStoredItem(updated);
    this.recordActivity(req, updated, 'item_skipped', `skipped "${updated.title}"`, { skip_reason: reason });
    this.refreshFormationReadiness(updated.formation_uid);

    logger.info(req, 'skip_formation_item', 'Formation item skipped', { item_uid: itemUid, reason });
    return this.enrichSingle(req, updated);
  }

  /**
   * Files the lightweight Epic-1 `request` action (GH-1958 finding #1) — flips the item to
   * `waiting_on_partner`. No SLA/target-team object; that richer `request` type is #1957/Epic 2.
   */
  public async requestFormationItem(req: Request, itemUid: string): Promise<FormationItem> {
    const item = await this.getFormationItemOrThrow(req, itemUid);
    const updated: FormationItem = { ...item, status: 'waiting_on_partner', updated_at: new Date().toISOString() };
    putStoredItem(updated);
    this.recordActivity(req, updated, 'item_requested', `requested "${updated.title}"`);

    logger.info(req, 'request_formation_item', 'Formation item request filed', { item_uid: itemUid });
    return this.enrichSingle(req, updated);
  }

  public async updateFormationItem(
    req: Request,
    itemUid: string,
    patch: { notes?: string; owner_username?: string; due_date?: string | null }
  ): Promise<FormationItem> {
    const item = await this.getFormationItemOrThrow(req, itemUid);
    const updated: FormationItem = { ...item, updated_at: new Date().toISOString() };

    if (patch.notes !== undefined && patch.notes !== item.notes) {
      updated.notes = patch.notes;
      this.recordActivity(req, updated, 'note_added', 'updated notes');
    }
    if (patch.owner_username !== undefined) {
      updated.owner = patch.owner_username ? { username: patch.owner_username, name: patch.owner_username } : null;
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
    // STATIC_QUEUE_FORMATIONS's shape already matches Formation[].
    let rows = STATIC_QUEUE_FORMATIONS;
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
    const formation = STATIC_QUEUE_FORMATIONS.find((row) => row.uid === formationUid) ?? getStoredFormation(formationUid);
    if (!formation) {
      throw new ResourceNotFoundError('Formation', formationUid, { operation: 'accept_formation', service: 'formation_service', path: req.path });
    }

    logger.info(req, 'accept_formation', 'Formations queue Accept — returning admin-tool deep link (fixture, no state change)', {
      formation_uid: formationUid,
    });
    return { deep_link_url: `https://admin.linuxfoundation.org/formations/${encodeURIComponent(formation.parent_project_slug)}` };
  }

  public async declineFormation(req: Request, formationUid: string, reason: string): Promise<Formation> {
    if (!reason || !reason.trim()) {
      throw ServiceValidationError.forField('reason', 'A reason is required to decline a formation', {
        operation: 'decline_formation',
        service: 'formation_service',
        path: req.path,
      });
    }

    const existing = STATIC_QUEUE_FORMATIONS.find((row) => row.uid === formationUid) ?? getStoredFormation(formationUid);
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
    logger.info(req, 'decline_formation', 'Would notify proposer (stub — #1957 owns real email-service integration)', {
      formation_uid: formationUid,
      proposer: declined.proposer?.username ?? null,
    });

    return declined;
  }

  private buildQueueTiles(req: Request): FormationsQueueResponse['tiles'] {
    const rows = STATIC_QUEUE_FORMATIONS;
    const bySubStage = Object.fromEntries(FORMATION_QUEUE_SUB_STAGES.map((stage) => [stage, 0])) as Record<FormationSubStage, number>;
    for (const row of rows) {
      bySubStage[row.sub_stage] = (bySubStage[row.sub_stage] ?? 0) + 1;
    }

    const email = getEffectiveEmail(req);
    return {
      ...bySubStage,
      total: rows.length,
      foundations: rows.filter((row) => row.entity_type === 'foundation').length,
      subprojects: rows.filter((row) => row.entity_type === 'subproject').length,
      mine: rows.filter((row) => row.lead?.username === email || row.proposer?.username === email).length,
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
    const openGatingItems = gatingItems.filter((item) => item.status !== 'done');
    const isActivating = gatingItems.length > 0 && openGatingItems.length === 0;

    putStoredFormation({
      ...formation,
      gating_items_open: openGatingItems.length,
      gating_items_total: gatingItems.length,
      is_activating: isActivating,
      blocking_item_title: openGatingItems[0]?.title ?? null,
      updated_at: new Date().toISOString(),
    });
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
