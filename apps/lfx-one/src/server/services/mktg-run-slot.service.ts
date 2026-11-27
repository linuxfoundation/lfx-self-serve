// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_RUN_SLOT_CLAIM_ATTEMPTS, MKTG_RUN_SLOT_SCHEMA, MKTG_RUN_SLOT_TTL_MS } from '@lfx-one/shared/constants/mktg-run.constants';
import type { MktgRunSlot, MktgRunSlotClaim, MktgRunSlotMarker, ObjectStorePutInput } from '@lfx-one/shared/interfaces';
import { buildMktgRunSlotKey, readMktgRunSlotMarker } from '@lfx-one/shared/utils/mktg-run-active.utils';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { logger } from './logger.service';
import { ObjectStoreService } from './object-store.service';

/**
 * The one reservation of an active slot. A start claims it before it reads the slot's runs or creates a Guild
 * session, and holds it until its run record is published; from then on the record is what holds the slot. Every
 * write is conditional, so of two simultaneous starts exactly one holds the slot.
 */
export class MktgRunSlotService {
  private readonly store = new ObjectStoreService();

  /**
   * Take the slot for one start. The reservation is created only when none exists (`ifNoneMatch`), or written over
   * the exact version read (`ifMatch`) when that one holds nothing any more: released, past its deadline, or
   * unreadable. A live reservation, or a write lost to another start, is answered with its holder. Nothing has been
   * read or sent when this returns without `held`.
   */
  public async claim(req: Request, slot: MktgRunSlot, creatorSubject: string | null): Promise<MktgRunSlotClaim> {
    const key = buildMktgRunSlotKey(slot);
    for (let attempt = 0; attempt < MKTG_RUN_SLOT_CLAIM_ATTEMPTS; attempt++) {
      const now = Date.now();
      const marker: MktgRunSlotMarker = {
        schema: MKTG_RUN_SLOT_SCHEMA,
        ...slot,
        claim: randomUUID(),
        creatorSubject,
        startedAt: new Date(now).toISOString(),
        expiresAt: now + MKTG_RUN_SLOT_TTL_MS,
      };
      const saved = await this.store.getPrivateObject(req, 'marketing-os-artifacts', key);
      if (!saved) {
        if (await this.store.putPrivateObjectIfAbsent(req, 'marketing-os-artifacts', key, this.input(marker))) return { held: marker, holder: null };
        continue;
      }
      const holder = readMktgRunSlotMarker(saved.body, slot);
      if (holder && holder.expiresAt > now) return { held: null, holder };
      if (!holder) logger.warning(req, 'mktg_run_slot_claim', 'The slot reservation is unreadable — it holds nothing and is written over', this.scope(slot));
      if (saved.etag && (await this.store.putConditionalObject(req, 'marketing-os-artifacts', key, { ...this.input(marker), ifMatch: saved.etag }, true))) {
        return { held: marker, holder: null };
      }
    }
    // Every write was lost to another start and none could be read as the holder: still a refusal, naming nobody.
    return { held: null, holder: null };
  }

  /**
   * Release the reservation this start holds, by its claim and over the exact version read: a late release never
   * frees a newer start's reservation. It never throws: the start's own answer still reaches the caller, and a
   * reservation that could not be released holds nothing past its deadline.
   */
  public async release(req: Request, held: MktgRunSlotMarker): Promise<void> {
    try {
      const key = buildMktgRunSlotKey(held);
      const saved = await this.store.getPrivateObject(req, 'marketing-os-artifacts', key);
      const marker = saved ? readMktgRunSlotMarker(saved.body, held) : null;
      const released =
        !!saved?.etag &&
        marker?.claim === held.claim &&
        (await this.store.putConditionalObject(req, 'marketing-os-artifacts', key, { ...this.input({ ...marker, expiresAt: 0 }), ifMatch: saved.etag }, true));
      if (released) {
        logger.debug(req, 'mktg_run_slot_release', 'Released the slot reservation', this.scope(held));
        return;
      }
      // The start outlived its reservation: another start may have taken the slot, and the supersede scan settles the two.
      logger.warning(req, 'mktg_run_slot_release', 'The slot reservation was no longer held when its start ended', this.scope(held));
    } catch (err) {
      logger.warning(req, 'mktg_run_slot_release', 'The slot reservation could not be released — its deadline frees the slot', { ...this.scope(held), err });
    }
  }

  private scope(slot: MktgRunSlot): { project: string; agentKey: string } {
    return { project: slot.project, agentKey: slot.agentKey };
  }

  private input(marker: MktgRunSlotMarker): ObjectStorePutInput {
    return { body: Buffer.from(JSON.stringify(marker), 'utf8'), contentType: 'application/json; charset=utf-8', cacheControl: 'private, no-store' };
  }
}
