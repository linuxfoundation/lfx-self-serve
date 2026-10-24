// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ARTIFACT_PARTITION_REGEX } from '@lfx-one/shared/constants/mktg-artifact.constants';
import type { MktgProjectSignOffSettings } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { MicroserviceError, ServiceValidationError } from '../errors';
import { logger } from './logger.service';
import { ObjectStoreService } from './object-store.service';

/** Read-only policy seam shared by approval and the later writer-gated settings API. */
export class MktgSignOffSettingsService {
  private readonly objectStore = new ObjectStoreService();

  public async modeOf(req: Request, project: string): Promise<MktgProjectSignOffSettings['mode']> {
    if (!MKTG_ARTIFACT_PARTITION_REGEX.test(project)) throw ServiceValidationError.forField('project', 'Invalid project uid');
    logger.debug(req, 'mktg_sign_off_settings_read', 'Reading project sign-off policy');
    const object = await this.objectStore.getObject(req, 'marketing-os-artifacts', `project-settings/${project}/sign-off.json`);
    if (!object) return 'single-writer';
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
        return record.mode;
    } catch {
      // Invalid JSON and unknown schemas are both unreadable policy, never implicit single-writer.
    }
    throw new MicroserviceError('Project sign-off settings are unreadable', 502, 'MKTG_SIGN_OFF_SETTINGS_UNREADABLE');
  }
}
