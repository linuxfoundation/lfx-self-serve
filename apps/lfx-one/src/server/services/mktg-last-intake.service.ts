// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MKTG_AGENTS,
  MKTG_AGENT_INTAKES,
  MKTG_ARTIFACT_PARTITION_REGEX,
  MKTG_DOCUMENT_TYPES,
  MKTG_LAST_INTAKE_MAX_BYTES,
  MKTG_LAST_INTAKE_PREFIX,
  MKTG_LAST_INTAKE_SCHEMA,
  MKTG_STARTED_RUN_ID_REGEX,
} from '@lfx-one/shared/constants';
import { MktgAgentIntake, MktgLastIntake, MktgLastIntakeStart, MktgStoredLastIntake } from '@lfx-one/shared/interfaces';
import { Request } from 'express';
import { AuthenticationError, MicroserviceError, ServiceValidationError } from '../errors';
import { getEffectiveSub } from '../utils/auth-helper';
import { logger } from './logger.service';
import { MktgDocumentRunService } from './mktg-document-run.service';
import { ObjectStoreService } from './object-store.service';

/** One private scalar snapshot per project/registered intake. No listing or session-record reads. */
export class MktgLastIntakeService {
  private readonly store = new ObjectStoreService();
  private readonly runs = new MktgDocumentRunService();

  /** A missing key is empty history; storage failures are not reported as absence. */
  public async read(req: Request, rawProject: unknown, rawAgentKey: unknown): Promise<MktgLastIntake | null> {
    const { agentKey, intake } = this.registration(rawAgentKey);
    const project = await this.runs.resolveProject(req, rawProject);
    logger.debug(req, 'mktg_last_intake_read', 'Reading scalar intake history', { project, agentKey });
    try {
      const stored = await this.store.getObject(req, 'marketing-os-artifacts', this.key(project, agentKey));
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
      // Explicit projection: even unexpected private fields can never escape on reads.
      return { answers: this.scalarAnswers(intake, record.answers), documentCount: record.documentCount, logoCount: record.logoCount };
    } catch {
      throw this.unavailable();
    }
  }

  /**
   * Called only after a validated Generate has an accepted durable run id.
   * Last PUT wins intentionally (not CAS and not chronological conflict resolution).
   * Failure must not turn an accepted session into a retryable Generate error.
   */
  public async recordStartBestEffort(req: Request, input: MktgLastIntakeStart): Promise<void> {
    try {
      const { agentKey, intake } = this.registration(MKTG_DOCUMENT_TYPES.find((type) => type.catalogAgentId === input.agentId)?.agentKey);
      if (!getEffectiveSub(req)) throw new AuthenticationError('A signed-in writer subject is required.');
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
      const body = Buffer.from(JSON.stringify(record));
      if (body.length > MKTG_LAST_INTAKE_MAX_BYTES) throw ServiceValidationError.forField('intake', 'Scalar intake history exceeds its storage limit.');
      await this.store.putContentAddressedObject(
        req,
        'marketing-os-artifacts',
        this.key(input.project, agentKey),
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
    const source = raw as Record<string, unknown>;
    const dependencyKeys = new Set((intake.attachments ?? []).map((attachment) => attachment.answerKey));
    return Object.fromEntries(
      (intake.lastIntakeFields ?? intake.fields.map((field) => field.key))
        .filter((key) => !dependencyKeys.has(key) && Object.hasOwn(source, key))
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

  private key(project: string, agentKey: string): string {
    if (!MKTG_ARTIFACT_PARTITION_REGEX.test(project)) throw ServiceValidationError.forField('project', 'A single-segment project uid is required.');
    return `${MKTG_LAST_INTAKE_PREFIX}/${project}/${agentKey}.json`;
  }

  private unavailable(): MicroserviceError {
    return new MicroserviceError('Last run inputs are unavailable. Try again later.', 503, 'MKTG_LAST_INTAKE_UNAVAILABLE', {
      operation: 'mktg_last_intake',
      service: 'object_store',
    });
  }
}
