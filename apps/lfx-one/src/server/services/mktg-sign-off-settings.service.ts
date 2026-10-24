// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ARTIFACT_PARTITION_REGEX } from '@lfx-one/shared/constants';
import type { MktgProjectSignOffSettings, MktgProjectSignOffSettingsSnapshot } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { AuthorizationError, MicroserviceError, PreconditionFailedError, ServiceValidationError } from '../errors';
import { isImpersonating } from '../utils/auth-helper';
import { MktgDocumentAuthorService } from './mktg-document-author.service';
import { logger } from './logger.service';
import { ObjectStoreService } from './object-store.service';

/** One policy record: lightweight reads for approval, conditional writes behind the writer-gated API. */
export class MktgSignOffSettingsService {
  private readonly objectStore = new ObjectStoreService();
  private readonly authors = new MktgDocumentAuthorService();

  public async modeOf(req: Request, project: string): Promise<MktgProjectSignOffSettings['mode']> {
    return (await this.readSnapshot(req, project)).record?.mode ?? 'single-writer';
  }

  public async readSnapshot(req: Request, project: string): Promise<MktgProjectSignOffSettingsSnapshot> {
    const key = this.key(project);
    logger.debug(req, 'mktg_sign_off_settings_read', 'Reading project sign-off policy');
    const object = await this.objectStore.getObject(req, 'marketing-os-artifacts', key);
    if (!object) return { record: null };
    try {
      const record = JSON.parse(object.body) as Partial<MktgProjectSignOffSettings> | null;
      if (
        record &&
        record.schema === 'mktg-project-sign-off/v1' &&
        (record.mode === 'single-writer' || record.mode === 'two-role') &&
        typeof record.changedAt === 'string' &&
        Number.isFinite(Date.parse(record.changedAt)) &&
        (record.changedBy === null || (typeof record.changedBy === 'string' && record.changedBy.trim()))
      )
        return { record: { schema: record.schema, mode: record.mode, changedAt: record.changedAt, changedBy: record.changedBy }, etag: object.etag };
    } catch {
      // Invalid JSON and unknown schemas are both unreadable policy, never implicit single-writer.
    }
    throw new MicroserviceError('Project sign-off settings are unreadable', 502, 'MKTG_SIGN_OFF_SETTINGS_UNREADABLE');
  }

  /** Caller supplies one observed snapshot after canonical project-writer/enable-policy checks. Never retries a stale write. */
  public async write(
    req: Request,
    project: string,
    mode: MktgProjectSignOffSettings['mode'],
    snapshot: MktgProjectSignOffSettingsSnapshot
  ): Promise<MktgProjectSignOffSettings> {
    if (isImpersonating(req)) throw new AuthorizationError('Sign-off settings cannot be changed while impersonating a user');
    const key = this.key(project);
    if (mode !== 'single-writer' && mode !== 'two-role') throw ServiceValidationError.forField('mode', 'Unknown sign-off mode');
    if (snapshot.record && !snapshot.etag)
      throw new MicroserviceError('Sign-off settings have no conditional-write token', 502, 'MKTG_SIGN_OFF_SETTINGS_UNREADABLE');
    const record: MktgProjectSignOffSettings = {
      schema: 'mktg-project-sign-off/v1',
      mode,
      changedAt: new Date().toISOString(),
      changedBy: this.authors.captureAuthorId(req),
    };
    const written = await this.objectStore.putConditionalObject(req, 'marketing-os-artifacts', key, {
      body: Buffer.from(JSON.stringify(record)),
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'private, no-store',
      ...(snapshot.etag ? { ifMatch: snapshot.etag } : { ifNoneMatch: '*' as const }),
    });
    if (!written) throw new PreconditionFailedError('Project sign-off settings changed. Reload and try again.');
    logger.info(req, 'mktg_sign_off_settings_write', 'Committed project sign-off policy', { mode });
    return record;
  }

  private key(project: string): string {
    if (!MKTG_ARTIFACT_PARTITION_REGEX.test(project)) throw ServiceValidationError.forField('project', 'Invalid project uid');
    return `project-settings/${project}/sign-off.json`;
  }
}
