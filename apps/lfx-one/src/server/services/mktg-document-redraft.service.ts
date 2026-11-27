// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_AGENTS, MKTG_AGENT_INTAKES, MKTG_RUN_ACTIVE } from '@lfx-one/shared/constants';
import type { ActiveMktgAgent, MktgDocumentType, MktgPreparedRedraft, MktgRedraftStartResponse, MktgReviseDocumentRequest } from '@lfx-one/shared/interfaces';
import { readMktgRedraftRequest, isMktgRedraftSubmissionBusy } from '@lfx-one/shared/utils';
import { redraftWasNotAccepted } from '../utils/mktg-redraft-start.util';
import type { Request } from 'express';
import { AuthenticationError, ConflictError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { createSessionOwnerToken } from '../utils/mktg-session-token.util';
import { GuildService } from './guild.service';
import { logger } from './logger.service';
import { MktgDocumentAuthorService } from './mktg-document-author.service';
import { MktgDocumentCommentsService } from './mktg-document-comments.service';
import { MktgDocumentRedraftContextService } from './mktg-document-redraft-context.service';
import { MktgDocumentRedraftInputService } from './mktg-document-redraft-input.service';
import type { MktgDocumentRunService } from './mktg-document-run.service';
import { MktgDocumentStoreService } from './mktg-document-store.service';

/**
 * Writer/canonical-project boundary is the Documents controller. No callback after reservation can create another session.
 * Both refusals come before any reservation is committed, so a 409 MKTG_REDRAFT_COMMENTS_BUSY or MKTG_RUN_ACTIVE proves nothing was sent.
 * A new send holds the document's active slot from before its ledger reservation until its run record is published.
 */
export class MktgDocumentRedraftService {
  private readonly guild = new GuildService();
  private readonly comments = new MktgDocumentCommentsService();
  private readonly contexts = new MktgDocumentRedraftContextService();
  private readonly inputs = new MktgDocumentRedraftInputService();
  private readonly documents = new MktgDocumentStoreService();
  private readonly authors = new MktgDocumentAuthorService();

  public async send(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    raw: unknown,
    runs: MktgDocumentRunService
  ): Promise<MktgRedraftStartResponse> {
    const input = readMktgRedraftRequest(raw);
    if (!input) throw ServiceValidationError.forField('redraft', 'Only a stored base, unique comment IDs and request ID are accepted.');
    const creator = this.authors.captureAuthorId(req);
    if (!creator) throw new AuthenticationError('A signed-in subject is required to own the redraft.');
    const agent = MKTG_AGENTS.find((entry) => entry.id === type.catalogAgentId);
    if (!agent || agent.status !== 'active' || !MKTG_AGENT_INTAKES[agent.id])
      throw ServiceValidationError.forField('agentKey', 'No registered redraft intake.');
    // First answer wins. A replay only re-observes its own run and never creates a session, so it takes no slot; a new
    // send never starts over a run, or another start, that holds this document.
    const replay = await this.comments.admit(req, project, type, documentId, input);
    const start = (): Promise<MktgRedraftStartResponse> => this.start(req, project, type, documentId, input, runs, creator, agent);
    if (replay) return start();
    try {
      return await runs.withActiveSlot(req, project, type.agentKey, { documentId }, start);
    } catch (error) {
      // This creator's own start holds the slot and has no run record yet. It may be this same request sent twice, so the
      // answer must not prove that nothing was sent: the same request ID is retried, and then finds its run or a named 409.
      const details = error instanceof ConflictError && error.code === MKTG_RUN_ACTIVE ? error.details : undefined;
      if (details?.['startedByViewer'] === true && !details['activeRunId']) throw this.uncertain();
      throw error;
    }
  }

  /** The ledger reservation, the one Guild session and its run record: for a new send, all inside the document's active slot. */
  private async start(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    input: MktgReviseDocumentRequest,
    runs: MktgDocumentRunService,
    creator: string,
    agent: ActiveMktgAgent
  ): Promise<MktgRedraftStartResponse> {
    let prepared: MktgPreparedRedraft | undefined;
    const reservation = await this.comments.reserve(req, project, type, documentId, input, async (comments) => {
      this.guild.preflight('mktg_document_redraft');
      const view = await this.documents.getRevision(req, project, type, documentId, input.revisionId);
      if (!view) throw new ResourceNotFoundError('Marketing OS revision', input.revisionId);
      prepared = await this.inputs.prepare(req, view, input.clientRequestId, comments);
    });
    if (!reservation.fresh) {
      if (reservation.submission.state === 'failed') throw this.comments.failedRequest();
      if (reservation.submission.state === 'reserved' && reservation.submission.runId === null && isMktgRedraftSubmissionBusy(reservation.submission))
        throw this.uncertain();
      try {
        const runId = reservation.submission.runId;
        const session = runId ? await runs.knownRedraftSession(req, project, type.agentKey, documentId, runId, input.clientRequestId, creator) : null;
        if (!session) throw this.uncertain();
        const context = await this.contexts.forSession(req, session);
        if (
          !context ||
          context.requestId !== input.clientRequestId ||
          context.basedOnId !== input.revisionId ||
          JSON.stringify(context.comments) !== JSON.stringify(reservation.comments)
        )
          throw this.uncertain();
        this.contexts.assertScope(context, project, type.agentKey);
        await runs.start(req, project, type.agentKey, session, context.priorVersion, input.clientRequestId, { basedOnId: context.basedOnId });
        await this.comments.bindRun(req, project, type, documentId, input.clientRequestId, context.runId, true);
        return { sessionId: session, ownerToken: createSessionOwnerToken(creator, session), runId: context.runId, priorVersion: context.priorVersion };
      } catch (error) {
        logger.warning(req, 'mktg_document_redraft', 'Redraft replay could not be confirmed', { agent: agent.id, err: error });
        if (reservation.submission.state === 'started') throw this.uncertain();
        return this.failUncertain(req, project, type, documentId, input.clientRequestId);
      }
    }
    let sessionExists = false;
    try {
      if (!prepared) throw ServiceValidationError.forField('redraft', 'The stored input could not be prepared.');
      const session = await this.guild.createSession(req, { message: prepared.message, handle: agent.guildAgentHandle });
      if (typeof session !== 'string' || !session.trim()) throw new MicroserviceError('Guild returned no session ID.', 502, 'guild_invalid_response');
      sessionExists = true;
      const runId = MktgDocumentRedraftContextService.runId(session);
      await this.comments.bindRun(req, project, type, documentId, input.clientRequestId, runId);
      await this.documents.rememberGenerationFramework(req, type.agentKey, project, session, prepared.framework);
      await this.contexts.create(req, session, prepared.context);
      // Publish progress only after the contract descriptor: polls cannot fall back to Generate in a context gap.
      await runs.start(req, project, type.agentKey, session, prepared.context.priorVersion, input.clientRequestId, { basedOnId: prepared.context.basedOnId });
      await this.comments.bindRun(req, project, type, documentId, input.clientRequestId, runId, true);
      logger.debug(req, 'mktg_document_redraft', 'Recorded comment redraft start', { agent: agent.id });
      return { sessionId: session, ownerToken: createSessionOwnerToken(creator, session), runId, priorVersion: prepared.context.priorVersion };
    } catch (error) {
      logger.warning(req, 'mktg_document_redraft', 'Redraft start failed; no automatic resubmission', { agent: agent.id, err: error });
      const rejected = redraftWasNotAccepted(error, sessionExists);
      if (rejected) {
        await this.comments.endStart(req, project, type, documentId, input.clientRequestId, false);
        throw error;
      }
      return this.failUncertain(req, project, type, documentId, input.clientRequestId);
    }
  }
  /** After a possible session, even a failed ledger update must never become a definitive HTTP rejection. */
  private async failUncertain(req: Request, project: string, type: MktgDocumentType, documentId: string, requestId: string): Promise<never> {
    try {
      await this.comments.endStart(req, project, type, documentId, requestId, true);
    } catch (error) {
      logger.warning(req, 'mktg_document_redraft', 'Could not record redraft uncertainty', { agent: type.agentKey, err: error });
    }
    throw this.uncertain();
  }
  private uncertain(): MicroserviceError {
    return new MicroserviceError(
      'The redraft start is uncertain. Retry the same request ID or explicitly release it before sending again.',
      503,
      'MKTG_REDRAFT_START_UNCERTAIN'
    );
  }
}
