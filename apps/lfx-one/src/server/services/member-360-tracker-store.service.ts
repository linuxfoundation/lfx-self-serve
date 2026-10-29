// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MEMBER_360_MAX_BYTES,
  MEMBER_360_TRACKER_ID_REGEX,
  MEMBER_360_TRACKER_TTL_MS,
  MEMBER_360_TRACKER_SWEEP_LIMIT,
  MKTG_ARTIFACT_PARTITION_REGEX,
} from '@lfx-one/shared/constants';
import { Member360StoredTracker, Member360Tracker, Member360TrackerReceipt } from '@lfx-one/shared/interfaces';
import { trackerSchema } from '@lfx-one/shared/server/member-360.utils';
import { Request } from 'express';
import { createHash, randomBytes } from 'node:crypto';

import { AuthenticationError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { getEffectiveSub } from '../utils/auth-helper';
import { ObjectStoreService } from './object-store.service';
import { logger } from './logger.service';

/** Private parsed rows, never a response. Callers resolve fresh project writer scope.
 * Delete on durable consumption, explicit removal, expired reads and bounded
 * upload/generate sweeps; client abandonment cleanup is best-effort. Sweeps are
 * activity-driven, not a timer: crashes, idle projects and failed deletes still
 * require the infrastructure lifecycle safety net (not configured here).
 */
export class Member360TrackerStoreService {
  private readonly store = new ObjectStoreService();

  public async save(req: Request, project: string, tracker: Member360Tracker): Promise<Member360TrackerReceipt> {
    const trackerId = randomBytes(32).toString('hex');
    const record: Member360StoredTracker = {
      project,
      creatorHash: this.creator(req),
      expiresAt: Date.now() + MEMBER_360_TRACKER_TTL_MS,
      tracker,
    };
    const written = await this.store.putPrivateObjectIfAbsent(req, 'marketing-os-artifacts', this.key(project, trackerId), {
      body: Buffer.from(JSON.stringify(record)),
      contentType: 'application/json',
      cacheControl: 'private, no-store',
    });
    if (!written) throw new MicroserviceError('Tracker storage is unavailable. Upload it again.', 503, 'MEMBER_360_TRACKER_STORE_UNAVAILABLE');
    return {
      trackerId,
      rowCount: tracker.rows.length,
      columnCount: Object.keys(tracker.rows[0] ?? {}).length,
      byteCount: Buffer.byteLength(JSON.stringify(tracker)),
      ...(tracker.kind && { kind: tracker.kind }),
    };
  }

  public async load(req: Request, project: string, ids: string[]): Promise<Member360Tracker[]> {
    const creator = this.creator(req);
    const trackers: Member360Tracker[] = [];
    for (const id of ids) {
      const key = this.key(project, id);
      const object = await this.store.getPrivateObject(req, 'marketing-os-artifacts', key);
      let record: Member360StoredTracker | undefined;
      try {
        const candidate = object ? (JSON.parse(object.body) as Member360StoredTracker) : undefined;
        if (candidate?.project === project && candidate.creatorHash === creator && Number.isFinite(candidate.expiresAt)) {
          if (candidate.expiresAt <= Date.now()) {
            await this.erase(req, key, 'expired');
          } else {
            const parsed = trackerSchema.safeParse(candidate.tracker);
            if (parsed.success) record = { ...candidate, tracker: parsed.data };
          }
        }
      } catch {
        // Never expose parser errors that can quote private row bytes.
      }
      if (!record) throw ServiceValidationError.forField('trackerIds', 'A tracker is unavailable or expired. Upload it again.');
      trackers.push(record.tracker);
      if (Buffer.byteLength(JSON.stringify(trackers)) > MEMBER_360_MAX_BYTES)
        throw ServiceValidationError.forField('trackerIds', 'The parsed trackers together must be smaller than 5 MB.');
    }
    return trackers;
  }

  /** Explicit removal must confirm deletion; an absent receipt is already removed. */
  public async remove(req: Request, project: string, id: string): Promise<void> {
    const creator = this.creator(req);
    const key = this.key(project, id);
    const object = await this.store.getPrivateObject(req, 'marketing-os-artifacts', key);
    if (!object) return;
    let owned = false;
    try {
      const record = JSON.parse(object.body) as Partial<Member360StoredTracker>;
      owned = record.project === project && record.creatorHash === creator;
    } catch {
      /* Never quote malformed private bytes. */
    }
    if (!owned) throw new ResourceNotFoundError('Member 360 tracker');
    await this.erase(req, key, 'removed', true);
  }

  /** Metadata-only oldest-first pass; at most N objects / 2N attempts, no row reads. */
  public async sweepExpired(req: Request, project: string): Promise<void> {
    this.creator(req);
    const prefix = this.prefix(project);
    try {
      const cutoff = Date.now() - MEMBER_360_TRACKER_TTL_MS;
      const entries = await this.store.listObjects(req, 'marketing-os-artifacts', prefix);
      const expired = entries
        .filter((entry) => {
          const id = entry.key.slice(prefix.length, -5);
          return (
            entry.key.startsWith(prefix) &&
            entry.key === `${prefix}${id}.json` &&
            MEMBER_360_TRACKER_ID_REGEX.test(id) &&
            entry.lastModified !== undefined &&
            Number.isFinite(entry.lastModified.getTime()) &&
            entry.lastModified.getTime() <= cutoff
          );
        })
        .sort((a, b) => (a.lastModified?.getTime() ?? 0) - (b.lastModified?.getTime() ?? 0))
        .slice(0, MEMBER_360_TRACKER_SWEEP_LIMIT);
      for (const entry of expired) await this.erase(req, entry.key, 'sweep');
    } catch {
      logger.warning(req, 'member_360_tracker_sweep', 'Private tracker sweep unavailable; lifecycle cleanup remains required', { project });
    }
  }

  /** Only called AFTER the consumed run has been durably registered. */
  public async deleteConsumed(req: Request, project: string, ids: string[]): Promise<void> {
    for (const id of new Set(ids)) await this.erase(req, this.key(project, id), 'consumed');
  }

  private async erase(req: Request, key: string, reason: 'consumed' | 'expired' | 'sweep' | 'removed', required = false): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.store.deletePrivateObject(req, 'marketing-os-artifacts', key);
        return;
      } catch (error) {
        if (attempt === 0) continue;
        // Never retry the Guild start or log private/provider bytes. Explicit
        // Remove must fail visibly; background cleanup remains best-effort.
        logger.warning(req, 'member_360_tracker_delete', 'Private tracker cleanup failed after retry; lifecycle cleanup is required', {
          reason,
          trackerId: key.slice(key.lastIndexOf('/') + 1, -5),
        });
        if (required) throw error;
      }
    }
  }

  private prefix(project: string): string {
    if (!MKTG_ARTIFACT_PARTITION_REGEX.test(project)) throw ServiceValidationError.forField('project', 'Use a single-segment project uid.');
    return `member-360-trackers/${project}/`;
  }

  private key(project: string, id: string): string {
    if (!MEMBER_360_TRACKER_ID_REGEX.test(id)) throw ServiceValidationError.forField('trackerIds', 'Use the tracker ids returned by an upload.');
    return `${this.prefix(project)}${id}.json`;
  }

  private creator(req: Request): string {
    const subject = getEffectiveSub(req);
    if (!subject) throw new AuthenticationError('Sign in to upload or use trackers.');
    return createHash('sha256').update(subject).digest('hex');
  }
}
