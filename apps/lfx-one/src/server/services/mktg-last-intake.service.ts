// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  LINKEDIN_POST_INTAKE,
  LINKEDIN_SHARE_LINK_ANSWER_KEY,
  MKTG_AGENTS,
  MKTG_AGENT_INTAKES,
  MKTG_ARTIFACT_PARTITION_REGEX,
  MKTG_DOCUMENT_TYPES,
  MKTG_LAST_INTAKE_MAX_BYTES,
  MKTG_LAST_INTAKE_PREFIX,
  MKTG_LAST_INTAKE_SCHEMA,
  MKTG_STARTED_RUN_ID_REGEX,
} from '@lfx-one/shared/constants';
import { MKTG_LAST_INTAKE_RETENTION_DAYS } from '@lfx-one/shared/constants/mktg-last-intake.constants';
import { MktgAgentIntake, MktgLastIntake, MktgLastIntakeInput, MktgStoredLastIntake } from '@lfx-one/shared/interfaces';
import { normalizeLinkedinShareAnswers } from '@lfx-one/shared/utils';
import { Request } from 'express';
import { createHash } from 'node:crypto';
import { AuthenticationError, MicroserviceError, ServiceValidationError } from '../errors';
import { getEffectiveSub } from '../utils/auth-helper';
import { logger } from './logger.service';
import { MktgDocumentRunService } from './mktg-document-run.service';
import { ObjectStoreService } from './object-store.service';

/** Scalar snapshots with metadata-only cleanup; no session-record or sibling-body reads. */
export class MktgLastIntakeService {
  private readonly store = new ObjectStoreService();
  private runs?: MktgDocumentRunService;

  /** A missing key is empty history; storage failures are not reported as absence. */
  public async read(req: Request, rawProject: unknown, rawAgentKey: unknown): Promise<MktgLastIntake | null> {
    const { agentKey, intake } = this.registration(rawAgentKey);
    const project = await (this.runs ??= new MktgDocumentRunService()).resolveProject(req, rawProject);
    const subject = agentKey === LINKEDIN_POST_INTAKE.agentId ? getEffectiveSub(req) : null;
    if (agentKey === LINKEDIN_POST_INTAKE.agentId && !subject) throw new AuthenticationError('A signed-in writer subject is required.');
    if (subject) await this.sweepExpired(req, project);
    logger.debug(req, 'mktg_last_intake_read', 'Reading scalar intake history', { project, agentKey });
    try {
      const key = this.key(project, agentKey, subject);
      const stored = await this.store.getObject(req, 'marketing-os-artifacts', key);
      if (!stored) return null;
      if (Buffer.byteLength(stored.body) > MKTG_LAST_INTAKE_MAX_BYTES) throw this.unavailable();
      // Parse errors can quote source text. Never log or return the original error.
      const record = JSON.parse(stored.body) as MktgStoredLastIntake;
      if (
        !record ||
        record.schema !== MKTG_LAST_INTAKE_SCHEMA ||
        record.project !== project ||
        record.agentKey !== agentKey ||
        typeof record.startedAt !== 'string' ||
        !Number.isFinite(Date.parse(record.startedAt)) ||
        typeof record.runId !== 'string' ||
        !MKTG_STARTED_RUN_ID_REGEX.test(record.runId) ||
        !this.validCount(record.documentCount) ||
        !this.validCount(record.logoCount)
      ) {
        throw this.unavailable();
      }
      const answers = this.scalarAnswers(intake, record.answers);
      if (Date.now() - Date.parse(record.startedAt) > MKTG_LAST_INTAKE_RETENTION_DAYS * 86400e3) {
        try {
          await this.store.deletePrivateObject(req, 'marketing-os-artifacts', key);
        } catch {
          logger.warning(req, 'mktg_last_intake_expire', 'Expired scalar intake history could not be deleted', { failed: 1 });
        }
        return null;
      }
      // Explicit projection: even unexpected private fields can never escape on reads.
      return { answers, documentCount: record.documentCount, logoCount: record.logoCount };
    } catch {
      throw this.unavailable();
    }
  }

  /**
   * Called only after a validated Generate has an accepted durable run id.
   * Last PUT wins intentionally (not CAS and not chronological conflict resolution).
   * Failure must not turn an accepted session into a retryable Generate error.
   */
  public async recordStartBestEffort(req: Request, input: MktgLastIntakeInput): Promise<void> {
    try {
      const { agentKey, intake } = this.registration(MKTG_DOCUMENT_TYPES.find((type) => type.catalogAgentId === input.agentId)?.agentKey);
      const subject = getEffectiveSub(req);
      if (!subject) throw new AuthenticationError('A signed-in writer subject is required.');
      if (!MKTG_STARTED_RUN_ID_REGEX.test(input.runId) || !this.validCount(input.documentCount) || !this.validCount(input.logoCount)) {
        throw ServiceValidationError.forField('intake', 'Invalid accepted intake metadata.');
      }
      const record: MktgStoredLastIntake = {
        schema: MKTG_LAST_INTAKE_SCHEMA,
        project: input.project,
        agentKey,
        startedAt: new Date().toISOString(),
        runId: input.runId,
        answers: this.scalarAnswers(intake, input.answers),
        documentCount: intake.documents ? input.documentCount : 0,
        logoCount: intake.logoFiles ? input.logoCount : 0,
      };
      let body = Buffer.from(JSON.stringify(record));
      if (body.length > MKTG_LAST_INTAKE_MAX_BYTES && intake.agentId === LINKEDIN_POST_INTAKE.agentId) {
        // Replace older inputs with current metadata; never truncate or retain the prior run's text.
        delete record.answers['content_text'];
        body = Buffer.from(JSON.stringify(record));
      }
      if (body.length > MKTG_LAST_INTAKE_MAX_BYTES) throw ServiceValidationError.forField('intake', 'Scalar intake history exceeds its storage limit.');
      if (agentKey === LINKEDIN_POST_INTAKE.agentId) await this.sweepExpired(req, input.project);
      await this.store.putContentAddressedObject(
        req,
        'marketing-os-artifacts',
        this.key(input.project, agentKey, subject),
        body,
        'application/json; charset=utf-8',
        'private, no-store',
        {},
        {
          // Reuse the existing purpose-keyed PUT primitive, explicitly replacing the body at this mutable key.
          refreshMetadataWhen: () => true,
        }
      );
    } catch {
      // Neither source text, the submitted request, author nor session capability belongs in logs.
      logger.warning(req, 'mktg_last_intake_write', 'Run accepted, but scalar intake history could not be saved', { err: this.unavailable() });
    }
  }

  public async eraseWriter(req: Request, subject: string): Promise<void> {
    if (!subject) return;
    const writer = createHash('sha256').update(subject).digest('hex');
    const pattern = new RegExp(`^${MKTG_LAST_INTAKE_PREFIX}/[^/]+/${LINKEDIN_POST_INTAKE.agentId}/${writer}\\.json$`);
    await this.removeSnapshots(req, `${MKTG_LAST_INTAKE_PREFIX}/`, (key) => pattern.test(key));
  }

  public async sweepExpired(req: Request, project: string): Promise<void> {
    if (!MKTG_ARTIFACT_PARTITION_REGEX.test(project)) return;
    const prefix = `${MKTG_LAST_INTAKE_PREFIX}/${project}/${LINKEDIN_POST_INTAKE.agentId}/`;
    const pattern = /^[a-f0-9]{64}\.json$/;
    const cutoff = Date.now() - MKTG_LAST_INTAKE_RETENTION_DAYS * 86400e3;
    await this.removeSnapshots(
      req,
      prefix,
      (key, modified) => key.startsWith(prefix) && pattern.test(key.slice(prefix.length)) && !!modified && modified.getTime() < cutoff
    );
  }

  private async removeSnapshots(req: Request, prefix: string, matches: (key: string, modified?: Date) => boolean): Promise<void> {
    let failed = 0;
    try {
      for (const entry of await this.store.listObjects(req, 'marketing-os-artifacts', prefix)) {
        if (!matches(entry.key, entry.lastModified)) continue;
        try {
          await this.store.deletePrivateObject(req, 'marketing-os-artifacts', entry.key);
        } catch {
          failed++;
        }
      }
    } catch {
      failed++;
    }
    if (failed) logger.warning(req, 'mktg_last_intake_cleanup', 'Scalar intake cleanup was incomplete', { failed });
  }

  private registration(rawAgentKey: unknown): { agentKey: string; intake: MktgAgentIntake } {
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === rawAgentKey);
    const agent = MKTG_AGENTS.find((entry) => entry.id === type?.catalogAgentId && entry.status === 'active');
    const intake = agent && MKTG_AGENT_INTAKES[agent.id];
    if (!type || !intake || (type.kind !== 'living' && !intake.lastIntakeFields?.length))
      throw ServiceValidationError.forField('agentKey', 'A registered active agent with scalar history is required.');
    return { agentKey: type.agentKey, intake };
  }

  private scalarAnswers(intake: MktgAgentIntake, raw: unknown): Record<string, string> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw ServiceValidationError.forField('answers', 'Invalid scalar intake history.');
    let source = raw as Record<string, unknown>;
    const linkedin = intake.agentId === LINKEDIN_POST_INTAKE.agentId;
    if (linkedin) {
      if (source['content_source'] !== 'text' && source['content_source'] !== 'url' && source['content_source'] !== 'file')
        throw ServiceValidationError.forField('answers', 'Invalid scalar intake history.');
      const share = normalizeLinkedinShareAnswers({ [LINKEDIN_SHARE_LINK_ANSWER_KEY]: source[LINKEDIN_SHARE_LINK_ANSWER_KEY] });
      if (!share) throw ServiceValidationError.forField('answers', 'Invalid scalar intake history.');
      source = { ...source, ...share };
    }
    const dependencyKeys = new Set((intake.attachments ?? []).map((attachment) => attachment.answerKey));
    return Object.fromEntries(
      (intake.lastIntakeFields ?? intake.fields.map((field) => field.key))
        .filter((key) => !dependencyKeys.has(key) && Object.hasOwn(source, key))
        .filter(
          (key) =>
            !linkedin || ((key !== 'content_text' || source['content_source'] === 'text') && (key !== 'content_url' || source['content_source'] === 'url'))
        )
        .map((key) => {
          const value = source[key];
          if (typeof value !== 'string') throw ServiceValidationError.forField('answers', 'Invalid scalar intake history.');
          // Keep submitted blanks, but never claim a newly registered/missing field came from this run.
          return [key, value.trim()];
        })
    );
  }

  private validCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  }

  private key(project: string, agentKey: string, subject: string | null): string {
    if (!MKTG_ARTIFACT_PARTITION_REGEX.test(project)) throw ServiceValidationError.forField('project', 'A single-segment project uid is required.');
    if (agentKey !== LINKEDIN_POST_INTAKE.agentId) return `${MKTG_LAST_INTAKE_PREFIX}/${project}/${agentKey}.json`;
    if (!subject) throw new AuthenticationError('A signed-in writer subject is required.');
    const writer = createHash('sha256').update(subject).digest('hex');
    // Never fall back to LinkedIn's former project-wide key: its writer cannot be established.
    return `${MKTG_LAST_INTAKE_PREFIX}/${project}/${agentKey}/${writer}.json`;
  }

  private unavailable(): MicroserviceError {
    return new MicroserviceError('Last run inputs are unavailable. Try again later.', 503, 'MKTG_LAST_INTAKE_UNAVAILABLE', {
      operation: 'mktg_last_intake',
      service: 'object_store',
    });
  }
}
