// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEMBER_360_MAX_BYTES, MEMBER_360_TRACKER_ID_REGEX, MEMBER_360_TRACKER_TTL_MS, MKTG_ARTIFACT_PARTITION_REGEX } from '@lfx-one/shared/constants';
import { Member360StoredTracker, Member360Tracker, Member360TrackerReceipt } from '@lfx-one/shared/interfaces';
import { trackerSchema } from '@lfx-one/shared/server/member-360.utils';
import { Request } from 'express';
import { createHash, randomBytes } from 'node:crypto';

import { AuthenticationError, MicroserviceError, ServiceValidationError } from '../errors';
import { getEffectiveSub } from '../utils/auth-helper';
import { ObjectStoreService } from './object-store.service';
import { logger } from './logger.service';

/** Private tracker rows share the durable run store, never a browser round trip.
 * Callers must resolve the project's writer entitlement before invoking this service.
 * Consumed and expired records are deleted best-effort. Bucket lifecycle remains
 * the fallback for abandoned uploads and failed deletes.
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

  /** Only called after these rows were included in a successfully started run. */
  public async deleteConsumed(req: Request, project: string, ids: string[]): Promise<void> {
    for (const id of new Set(ids)) await this.erase(req, this.key(project, id), 'consumed');
  }

  private async erase(req: Request, key: string, reason: 'consumed' | 'expired'): Promise<void> {
    try {
      await this.store.deletePrivateObject(req, 'marketing-os-artifacts', key);
    } catch {
      // A Guild start must not be retried because cleanup failed. Never log rows,
      // identity, private keys or provider error messages at this boundary.
      logger.warning(req, 'member_360_tracker_delete', 'Private tracker cleanup failed; lifecycle cleanup is required', { reason });
    }
  }

  private key(project: string, id: string): string {
    if (!MKTG_ARTIFACT_PARTITION_REGEX.test(project) || !MEMBER_360_TRACKER_ID_REGEX.test(id))
      throw ServiceValidationError.forField('trackerIds', 'Use the tracker ids returned by an upload.');
    return `member-360-trackers/${project}/${id}.json`;
  }

  private creator(req: Request): string {
    const subject = getEffectiveSub(req);
    if (!subject) throw new AuthenticationError('Sign in to upload or use trackers.');
    return createHash('sha256').update(subject).digest('hex');
  }
}
