// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MKTG_DOCUMENT_COMMENTS_PREFIX,
  MKTG_DOCUMENT_COMMENTS_SCHEMA,
  MKTG_DOCUMENT_COMMENT_LIMITS,
  MKTG_DOCUMENT_COMMENT_ANCHOR_KINDS,
  MKTG_DOCUMENT_COMMENT_ID_REGEX,
  MKTG_DOCUMENT_COMMENT_MAX_CHARS,
  MKTG_DOCUMENT_COMMENT_MAX_THREADS,
  MKTG_DOCUMENT_COMMENT_STORE_MAX_BYTES,
  MKTG_DOCUMENT_COMMENT_STATUSES,
  MKTG_DOCUMENT_COMMENT_SUBMISSION_STATES,
  MKTG_DOCUMENT_READ_CONCURRENCY,
  MKTG_DOCUMENT_WRITE_ATTEMPTS,
  MKTG_REVISION_ID_REGEX,
  MKTG_STARTED_RUN_ID_REGEX,
  MKTG_REDRAFT_SUBMISSION_KEYS,
  MKTG_RUN_POLL,
} from '@lfx-one/shared/constants';
import type {
  MktgAddDocumentCommentRequest,
  MktgCommentAgentKey,
  MktgDocumentCommentAnchorKind,
  MktgDocumentCommentAnchor,
  MktgDocumentCommentsRecord,
  MktgDocumentCommentsResponse,
  MktgDocumentCommentsSnapshot,
  MktgDocumentType,
  MktgRevisionResponse,
  MktgStoredDocumentComment,
  MktgDocumentCommentsMutation,
  MktgRedraftReservation,
  MktgDocumentCommentSubmission,
  MktgDocumentRedraftContext,
  MktgRunResultResponse,
  MktgReleaseRedraftResponse,
} from '@lfx-one/shared/interfaces';
import {
  readMktgRedraftRequest,
  validateMktgRedraftResult,
  isMktgRedraftSubmissionBusy,
  findMktgDocumentType,
  mktgDocumentLocationOfReceipt,
  isMktgDocumentCommentAnchor,
  readMktgDocumentCommentField,
  validateMktgDocumentCommentBatch,
} from '@lfx-one/shared/utils';
import { MKTG_DOCUMENT_COMMENT_DOCUMENT_LABEL } from '@lfx-one/shared/constants/mktg-document-comments.constants';
import { MKTG_ARTIFACT_PARTITION_REGEX } from '@lfx-one/shared/constants/mktg-artifact.constants';
import type {
  MktgDocumentCommentReceipt,
  MktgStoredDocumentCommentReceipt,
  MktgSignOffCommentScope,
  MktgSignOffSubmissionProof,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AuthenticationError, ConflictError, MicroserviceError, PreconditionFailedError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { logger } from './logger.service';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { ObjectStoreService } from './object-store.service';
import { MktgDocumentAuthorService } from './mktg-document-author.service';
import { MktgDocumentRedraftContextService } from './mktg-document-redraft-context.service';

/** Writer authorization and canonical project resolution are the existing Documents controller's boundary. */
export class MktgDocumentCommentsService {
  private readonly store = new ObjectStoreService();
  private readonly contexts = new MktgDocumentRedraftContextService();
  private readonly authors = new MktgDocumentAuthorService();
  private readonly documents = new MktgDocumentStoreService(undefined, this.authors);

  /** Read-only creator recovery: unknown and foreign nonces never imply terminal acceptance. */
  public async isRedraftTerminal(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    requestId: string,
    revisionId: string
  ): Promise<boolean> {
    if (!MKTG_DOCUMENT_COMMENT_ID_REGEX.test(requestId) || !MKTG_REVISION_ID_REGEX.test(revisionId))
      throw this.invalid('redraft', 'Invalid recovery identifiers.');
    const actor = this.creator(req);
    const { record } = await this.read(req, project, this.commentAgent(type), documentId);
    const row = record.submissions.find((entry) => entry.id === requestId && entry.requestedBy === actor && entry.baseRevisionId === revisionId);
    return !!row && (row.state === 'completed' || row.state === 'failed');
  }

  public async list(req: Request, project: string, type: MktgDocumentType, documentId: string, revisionId: string): Promise<MktgDocumentCommentsResponse> {
    const agentKey = this.commentAgent(type);
    const view = await this.requireRevision(req, project, type, documentId, revisionId);
    const snapshot = await this.read(req, project, agentKey, documentId);
    const context = await this.documents.redraftForRevision(req, view);
    if (context) {
      const echo = validateMktgRedraftResult(context, view.sidecar);
      if (!echo.valid) throw this.corrupt();
      const history = context.comments.map((frozen, index) => {
        const original = snapshot.record.threads.find((row) => row.id === frozen.id);
        if (!original) throw this.corrupt();
        return {
          ...original,
          ...frozen,
          revisionId: context.basedOnId,
          status: 'resolved' as const,
          sentInRun: context.runId,
          resultRevisionId: revisionId,
          resolution: echo.resolutions[index] ?? null,
        };
      });
      const ids = new Set(history.map((row) => row.id));
      return this.project(req, { ...snapshot.record, threads: [...snapshot.record.threads.filter((row) => !ids.has(row.id)), ...history] }, revisionId);
    }
    return this.project(req, snapshot.record, revisionId);
  }

  public async add(req: Request, project: string, type: MktgDocumentType, documentId: string, raw: unknown): Promise<MktgDocumentCommentsResponse> {
    return (await this.addWithReceipt(req, project, type, documentId, raw)).response;
  }

  /** Internal exact ID receipt over the SAME add/dedupe CAS, never a second comment write path. */
  public async addWithReceipt(req: Request, project: string, type: MktgDocumentType, documentId: string, raw: unknown): Promise<MktgDocumentCommentReceipt> {
    const agentKey = this.commentAgent(type);
    const input = this.input(raw);
    const revision = await this.requireRevision(req, project, type, documentId, input.revisionId);
    const anchor: MktgDocumentCommentAnchor = { ...input.anchor };
    const source = this.source(revision, agentKey);
    if (!isMktgDocumentCommentAnchor(agentKey, source, anchor)) throw this.invalid('anchor', 'The field is not in this stored asset.');
    if (agentKey === 'brand-kit' && anchor.kind === 'document') Object.assign(anchor, { passage: MKTG_DOCUMENT_COMMENT_DOCUMENT_LABEL });
    else if (agentKey === 'brand-kit') {
      const field = readMktgDocumentCommentField(source, anchor.key);
      // A logo ref, colour value, type sample or voice line is prose, not its field path.
      if (!field || typeof field.value !== 'string' || !field.value.trim()) throw this.invalid('anchor', 'Choose a text or value field of the kit.');
      Object.assign(anchor, { passage: field.value });
    }
    const authorId = this.authors.captureAuthorId(req);
    const thread: MktgStoredDocumentComment = {
      id: randomUUID(),
      clientRequestId: input.clientRequestId,
      anchor,
      revisionId: input.revisionId,
      authorId,
      text: input.text,
      createdAt: new Date().toISOString(),
      status: 'open',
      sentInRun: null,
      resultRevisionId: null,
      resolution: null,
    };
    const stored = await this.change<MktgStoredDocumentCommentReceipt>(req, project, agentKey, documentId, (record) => {
      const duplicate = record.threads.find((entry) => entry.clientRequestId === input.clientRequestId);
      if (duplicate) {
        if (
          duplicate.authorId !== authorId ||
          duplicate.revisionId !== input.revisionId ||
          duplicate.anchor.key !== anchor.key ||
          duplicate.anchor.kind !== anchor.kind ||
          duplicate.anchor.passage !== anchor.passage ||
          duplicate.text !== input.text
        ) {
          throw new ConflictError('This comment request was already used for a different comment.', 'MKTG_COMMENT_REQUEST_CONFLICT');
        }
        return { record: null, result: { record, commentId: duplicate.id } };
      }
      if (record.threads.length >= MKTG_DOCUMENT_COMMENT_MAX_THREADS) throw this.invalid('comments', 'The comment history is full; no comments were removed.');
      const next = { ...record, threads: [...record.threads, thread] };
      return { record: next, result: { record: next, commentId: thread.id } };
    });
    logger.debug(req, 'mktg_document_comment_add', 'Stored a field comment', { agent: agentKey });
    return { commentId: stored.commentId, response: await this.project(req, stored.record, input.revisionId) };
  }

  /** Only a fresh committed reservation may invoke Guild. Preflight may read/render, NEVER mutate or send; CAS can repeat it. */
  public async reserve(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    raw: unknown,
    preflight?: (comments: MktgRedraftReservation['comments']) => void | Promise<void>
  ): Promise<MktgRedraftReservation> {
    const agent = this.commentAgent(type);
    const actor = this.creator(req);
    const input = readMktgRedraftRequest(raw);
    if (!input) throw this.invalid('redraft', 'A revision, unique comment IDs and opaque request ID are required.');
    const view = await this.requireRevision(req, project, type, documentId, input.revisionId);
    const source = this.source(view, agent);
    const now = new Date().toISOString();
    let rejected = false;
    let rejection: unknown;
    const reservation = await this.change<MktgRedraftReservation>(req, project, agent, documentId, async (record) => {
      rejected = false;
      const existing = record.submissions.find((entry) => entry.id === input.clientRequestId);
      if (existing) {
        if (
          existing.requestedBy !== actor ||
          existing.baseRevisionId !== input.revisionId ||
          JSON.stringify(existing.commentIds) !== JSON.stringify(input.commentIds)
        ) {
          throw new ConflictError('This send request is already bound to different inputs or a different creator.', 'MKTG_REDRAFT_REQUEST_CONFLICT');
        }
        return { record: null, result: { submission: existing, comments: this.frozen(record, existing), fresh: false } };
      }
      if (record.submissions.some((entry) => this.busy(entry) && entry.commentIds.some((id) => input.commentIds.includes(id)))) {
        throw new ConflictError('Some comments are already reserved for another send.', 'MKTG_REDRAFT_COMMENTS_BUSY');
      }
      const selected = input.commentIds.map((id) => record.threads.find((entry) => entry.id === id));
      if (
        selected.some(
          (entry) => !entry || entry.status !== 'open' || entry.revisionId !== input.revisionId || !isMktgDocumentCommentAnchor(agent, source, entry.anchor)
        )
      ) {
        throw this.invalid('commentIds', 'Every comment must be open and anchored to the selected stored revision.');
      }
      const comments = selected.filter((entry): entry is MktgStoredDocumentComment => !!entry);
      if (validateMktgDocumentCommentBatch(agent, comments).length)
        throw this.invalid('commentIds', `This agent accepts 1–${MKTG_DOCUMENT_COMMENT_LIMITS[agent]} comments.`);
      const submission: MktgDocumentCommentSubmission = {
        id: input.clientRequestId,
        requestedBy: actor,
        createdAt: now,
        baseRevisionId: input.revisionId,
        commentIds: [...input.commentIds],
        state: 'reserved',
        runId: null,
        resultRevisionId: null,
      };
      // Reservation is not proof of external acceptance. Threads become sent only when a returned run hash is bound.
      const next: MktgDocumentCommentsRecord = { ...record, submissions: [...record.submissions, submission] };
      const frozen = this.frozen(next, submission);
      try {
        await preflight?.(frozen);
      } catch (error) {
        rejected = true;
        rejection = error;
        const failed: MktgDocumentCommentSubmission = { ...submission, state: 'failed' };
        return {
          record: {
            ...next,
            submissions: [...record.submissions, failed],
            threads: record.threads.map((row) =>
              input.commentIds.includes(row.id) ? { ...row, status: 'open', sentInRun: null, resultRevisionId: null, resolution: null } : row
            ),
          },
          result: { submission: failed, comments: frozen, fresh: false },
        };
      }
      return { record: next, result: { submission, comments: frozen, fresh: true } };
    });
    if (rejected) throw rejection;
    return reservation;
  }

  /** Bind only the opaque run hash. Raw sessions remain exclusively in existing private document-runs. */
  public async bindRun(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    requestId: string,
    runId: string,
    started = false
  ): Promise<MktgDocumentCommentSubmission> {
    const actor = this.creator(req);
    const agent = this.commentAgent(type);
    if (!MKTG_DOCUMENT_COMMENT_ID_REGEX.test(requestId) || !MKTG_STARTED_RUN_ID_REGEX.test(runId)) throw this.invalid('runId', 'Invalid redraft binding.');
    return this.change(req, project, agent, documentId, (record) => {
      const submission = record.submissions.find((entry) => entry.id === requestId);
      if (!submission || submission.requestedBy !== actor || (submission.runId && submission.runId !== runId)) {
        throw new ConflictError('The send request cannot be bound by this creator.', 'MKTG_REDRAFT_REQUEST_CONFLICT');
      }
      if (submission.state === 'failed') throw this.failedRequest();
      if (submission.state === 'reserved' && !this.busy(submission)) throw new ConflictError('The start reservation expired.', 'MKTG_REDRAFT_REQUEST_EXPIRED');
      if (submission.state !== 'reserved' && submission.state !== 'uncertain') return { record: null, result: submission };
      const updated: MktgDocumentCommentSubmission = { ...submission, runId, state: submission.state };
      if (started) updated.state = 'started';
      const ids = new Set(submission.commentIds);
      const next: MktgDocumentCommentsRecord = {
        ...record,
        submissions: record.submissions.map((entry) => (entry.id === requestId ? updated : entry)),
        threads: record.threads.map((entry) =>
          ids.has(entry.id) &&
          this.owns(record, submission, entry) &&
          (entry.status === 'open' || (entry.status === 'sent' && entry.sentInRun === null)) &&
          entry.revisionId === submission.baseRevisionId
            ? { ...entry, status: 'sent', sentInRun: runId, resultRevisionId: null, resolution: null }
            : entry
        ),
      };
      return { record: next, result: updated };
    });
  }

  /** Creator-only state change after a committed start; retained hash can NEVER bind a different session. */
  public async endStart(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    requestId: string,
    uncertain: boolean,
    releaseOnly = false
  ): Promise<MktgDocumentCommentSubmission | null> {
    const actor = this.creator(req);
    const agent = this.commentAgent(type);
    return this.change<MktgDocumentCommentSubmission | null>(req, project, agent, documentId, (record) => {
      const submission = record.submissions.find((row) => row.id === requestId);
      if (releaseOnly && (!submission || submission.requestedBy !== actor)) {
        logger.debug(req, 'mktg_document_redraft_release', 'No creator-owned reservation to release', { agent, reservation_found: !!submission });
        return { record: null, result: null };
      }
      if (!submission || submission.requestedBy !== actor)
        throw new ConflictError('Only the send creator may change its reservation.', 'MKTG_REDRAFT_REQUEST_CONFLICT');
      if (
        releaseOnly &&
        submission.state !== 'uncertain' &&
        submission.state !== 'failed' &&
        !(submission.state === 'reserved' && Date.now() - Date.parse(submission.createdAt) > MKTG_RUN_POLL.timeoutMs)
      )
        throw new ConflictError('This send is still active.', 'MKTG_REDRAFT_COMMENTS_BUSY');
      if (uncertain && submission.state === 'started') return { record: null, result: submission };
      if (submission.state === 'completed' || submission.state === 'failed') return { record: null, result: submission };
      const updated: MktgDocumentCommentSubmission = { ...submission, state: uncertain ? 'uncertain' : 'failed' };
      return {
        record: {
          ...record,
          submissions: record.submissions.map((row) => (row.id === requestId ? updated : row)),
          threads: record.threads.map((row) => {
            if (!submission.commentIds.includes(row.id) || !this.owns(record, submission, row)) return row;
            return { ...row, status: uncertain ? 'sent' : 'open', sentInRun: uncertain ? submission.runId : null, resultRevisionId: null, resolution: null };
          }),
        },
        result: updated,
      };
    });
  }
  public async release(req: Request, project: string, type: MktgDocumentType, documentId: string, requestId: string): Promise<MktgReleaseRedraftResponse> {
    const submission = await this.endStart(req, project, type, documentId, requestId, false, true);
    return submission ? { success: true } : { state: 'unknown' };
  }
  /**
   * Internal sign-off correlation/proof only. Caller resolves canonical access first; optional authorizeRelease
   * must enforce role-actor/project-writer release permission. Absence is NOT a start fence: the pointer CAS is.
   * Never expose this method/ledger through HTTP, impersonate the original creator, or expire a reservation here.
   */
  public async signOffSubmissionProof(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    input: MktgSignOffCommentScope,
    authorizeRelease?: () => void | Promise<void>
  ): Promise<MktgSignOffSubmissionProof> {
    if (
      !MKTG_ARTIFACT_PARTITION_REGEX.test(project) ||
      documentId !== 'living' ||
      !MKTG_REVISION_ID_REGEX.test(input.revisionId) ||
      !input.requestedBy?.trim() ||
      !MKTG_DOCUMENT_COMMENT_ID_REGEX.test(input.requestId) ||
      !MKTG_DOCUMENT_COMMENT_ID_REGEX.test(input.commentRequestId)
    )
      throw this.invalid('signOff', 'Invalid sign-off correlation.');
    await authorizeRelease?.();
    return this.change<MktgSignOffSubmissionProof>(req, project, this.commentAgent(type), documentId, async (record) => {
      const row = record.submissions.find((entry) => entry.id === input.requestId);
      if (!row) return { record: null, result: { state: 'absent', commentId: null } };
      const thread = record.threads.find(
        (entry) => entry.clientRequestId === input.commentRequestId && entry.authorId === input.requestedBy && entry.revisionId === input.revisionId
      );
      if (
        !thread ||
        row.requestedBy !== input.requestedBy ||
        row.baseRevisionId !== input.revisionId ||
        row.commentIds.length !== 1 ||
        row.commentIds[0] !== thread.id
      )
        throw new ConflictError('Sign-off correlation does not match this submission.', 'MKTG_SIGN_OFF_CORRELATION_CONFLICT');
      const context = row.runId ? await this.contexts.forRun(req, row.runId) : null;
      if (
        context &&
        (context.project !== project ||
          context.agentKey !== type.agentKey ||
          context.documentId !== documentId ||
          context.requestId !== input.requestId ||
          context.basedOnId !== input.revisionId ||
          !isDeepStrictEqual(context.comments, this.frozen(record, row)))
      )
        throw new ConflictError('The redraft descriptor does not match this sign-off.', 'MKTG_SIGN_OFF_CORRELATION_CONFLICT');
      if (context || row.state === 'started' || row.state === 'completed') return { record: null, result: { state: 'accepted', commentId: thread.id } };
      if (row.state === 'failed') return { record: null, result: { state: 'failed', commentId: thread.id } };
      if (row.state !== 'uncertain') {
        if (authorizeRelease) throw new ConflictError('The redraft is still starting. Recover it before releasing.', 'MKTG_REDRAFT_COMMENTS_BUSY');
        return { record: null, result: { state: 'in-flight', commentId: thread.id } };
      }
      if (!authorizeRelease) return { record: null, result: { state: 'uncertain', commentId: thread.id } };
      return {
        record: {
          ...record,
          submissions: record.submissions.map((entry) => (entry.id === row.id ? { ...entry, state: 'failed' as const } : entry)),
          threads: record.threads.map((entry) =>
            entry.id === thread.id && this.owns(record, row, entry)
              ? { ...entry, status: 'open' as const, sentInRun: null, resultRevisionId: null, resolution: null }
              : entry
          ),
        },
        result: { state: 'released', commentId: thread.id },
      };
    });
  }

  public failedRequest(): ConflictError {
    return new ConflictError('This send failed or was released. Send explicitly with a NEW request ID.', 'MKTG_REDRAFT_REQUEST_FAILED');
  }
  /** Called only with authoritative run context and a conclusive result, never a timeout/budget marker. */
  public async settle(req: Request, context: MktgDocumentRedraftContext, result: MktgRunResultResponse): Promise<void> {
    const type = findMktgDocumentType(context.agentKey);
    if (!type) throw this.corrupt();
    const location = mktgDocumentLocationOfReceipt(result.persistence);
    let resolutions: string[] = [];
    if (result.status === 'ready') {
      if (
        !location ||
        result.persistence?.project !== context.project ||
        location.agentKey !== context.agentKey ||
        location.documentId !== context.documentId ||
        location.revisionId === context.basedOnId
      )
        return;
      const view = await this.requireRevision(req, context.project, type, context.documentId, location.revisionId);
      const echo = validateMktgRedraftResult(context, view.sidecar);
      if (!echo.valid) throw this.corrupt();
      resolutions = echo.resolutions;
    } else if (result.status !== 'failed' && result.status !== 'refused') return;
    await this.change(req, context.project, context.agentKey, context.documentId, (record) => {
      const submission = record.submissions.find((row) => row.id === context.requestId);
      if (
        !submission ||
        submission.runId !== context.runId ||
        submission.baseRevisionId !== context.basedOnId ||
        JSON.stringify(submission.commentIds) !== JSON.stringify(context.comments.map((row) => row.id))
      )
        throw this.corrupt();
      if (submission.state === 'completed' || submission.state === 'failed') return { record: null, result: undefined };
      const completed = result.status === 'ready';
      const id = completed ? (location?.revisionId ?? null) : null;
      const updated: MktgDocumentCommentsRecord = {
        ...record,
        submissions: record.submissions.map((row) =>
          row.id === submission.id ? { ...row, state: completed ? 'completed' : 'failed', resultRevisionId: id } : row
        ),
        threads: record.threads.map((row) => {
          const index = context.comments.findIndex((input) => input.id === row.id);
          if (index < 0 || row.sentInRun !== context.runId) return row;
          return {
            ...row,
            status: completed ? 'resolved' : 'open',
            sentInRun: completed ? row.sentInRun : null,
            resultRevisionId: id,
            resolution: completed ? (resolutions[index] ?? null) : null,
          };
        }),
      };
      return { record: updated, result: undefined };
    });
  }

  private busy(submission: MktgDocumentCommentSubmission): boolean {
    return isMktgRedraftSubmissionBusy(submission);
  }
  private owns(record: MktgDocumentCommentsRecord, submission: MktgDocumentCommentSubmission, row: MktgStoredDocumentComment): boolean {
    const index = record.submissions.findIndex((entry) => entry.id === submission.id);
    return (
      !record.submissions.slice(index + 1).some((entry) => entry.commentIds.includes(row.id)) && (row.sentInRun === submission.runId || row.sentInRun === null)
    );
  }
  private creator(req: Request): string {
    const actor = this.authors.captureAuthorId(req);
    if (!actor) throw new AuthenticationError('A signed-in subject is required to own a redraft session.');
    return actor;
  }
  private frozen(record: MktgDocumentCommentsRecord, submission: MktgDocumentCommentSubmission): MktgRedraftReservation['comments'] {
    return submission.commentIds.map((id) => {
      const entry = record.threads.find((thread) => thread.id === id && thread.revisionId === submission.baseRevisionId);
      if (!entry) throw this.corrupt();
      return { id: entry.id, anchor: { ...entry.anchor }, text: entry.text, createdAt: entry.createdAt };
    });
  }
  private async change<T>(
    req: Request,
    project: string,
    agent: MktgCommentAgentKey,
    documentId: string,
    apply: (record: MktgDocumentCommentsRecord) => MktgDocumentCommentsMutation<T> | Promise<MktgDocumentCommentsMutation<T>>
  ): Promise<T> {
    for (let attempt = 0; attempt < MKTG_DOCUMENT_WRITE_ATTEMPTS; attempt++) {
      const snapshot = await this.read(req, project, agent, documentId);
      const mutation = await apply(snapshot.record);
      if (!mutation.record) return mutation.result;
      const body = Buffer.from(JSON.stringify(mutation.record));
      if (body.byteLength > MKTG_DOCUMENT_COMMENT_STORE_MAX_BYTES) throw this.invalid('comments', 'The comment history is full; no comments were removed.');
      if (
        await this.store.putConditionalObject(req, 'marketing-os-artifacts', this.key(project, agent, documentId), {
          body,
          contentType: 'application/json; charset=utf-8',
          cacheControl: 'private, no-store',
          ...(snapshot.etag ? { ifMatch: snapshot.etag } : { ifNoneMatch: '*' as const }),
        })
      )
        return mutation.result;
    }
    throw new PreconditionFailedError('The comments changed while saving. Try again.');
  }

  private commentAgent(type: MktgDocumentType): MktgCommentAgentKey {
    if (type.kind !== 'living' || !Object.hasOwn(MKTG_DOCUMENT_COMMENT_LIMITS, type.agentKey)) {
      throw this.invalid('agentKey', 'This asset does not support field comments.');
    }
    return type.agentKey as MktgCommentAgentKey;
  }

  private input(raw: unknown): MktgAddDocumentCommentRequest {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw this.invalid('body', 'A comment request is required.');
    const body = raw as Record<string, unknown>;
    if (Object.keys(body).some((key) => !['project', 'revisionId', 'anchor', 'text', 'clientRequestId'].includes(key))) {
      throw this.invalid('body', 'Only the comment fields are accepted.');
    }
    const anchor = body['anchor'];
    if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor) || Object.keys(anchor).some((key) => !['kind', 'key'].includes(key))) {
      throw this.invalid('anchor', 'An anchor kind and key are required.');
    }
    const value = anchor as Record<string, unknown>;
    if (!(MKTG_DOCUMENT_COMMENT_ANCHOR_KINDS as readonly string[]).includes(String(value['kind'])) || typeof value['key'] !== 'string')
      throw this.invalid('anchor', 'An anchor kind and key are required.');
    if (typeof body['text'] !== 'string' || !body['text'].trim() || body['text'].length > MKTG_DOCUMENT_COMMENT_MAX_CHARS) {
      throw this.invalid('text', 'A comment must contain text within the allowed length.');
    }
    if (typeof body['clientRequestId'] !== 'string' || !MKTG_DOCUMENT_COMMENT_ID_REGEX.test(body['clientRequestId'])) {
      throw this.invalid('clientRequestId', 'A bounded opaque request id is required.');
    }
    // The controller validates revision/project shape before authorization; preserve text verbatim.
    return {
      project: String(body['project']),
      revisionId: String(body['revisionId']),
      anchor: { kind: value['kind'] as MktgDocumentCommentAnchorKind, key: value['key'] },
      text: body['text'],
      clientRequestId: body['clientRequestId'],
    };
  }

  private async requireRevision(req: Request, project: string, type: MktgDocumentType, documentId: string, revisionId: string): Promise<MktgRevisionResponse> {
    const revision = await this.documents.getRevision(req, project, type, documentId, revisionId);
    if (!revision) throw new ResourceNotFoundError('Marketing OS document revision', revisionId);
    return revision;
  }

  private source(revision: MktgRevisionResponse, agentKey: MktgCommentAgentKey): unknown {
    if (agentKey === 'brand-kit') return { kit: revision.sidecar?.['kit'], chapters: revision.sidecar?.['chapters'] };
    if (revision.revision.format !== 'json') throw this.invalid('revisionId', 'This revision has no structured asset fields.');
    try {
      return JSON.parse(revision.markdown) as unknown;
    } catch {
      throw this.invalid('revisionId', 'This revision has no readable structured asset.');
    }
  }

  private key(project: string, agentKey: MktgCommentAgentKey, documentId: string): string {
    return `${MKTG_DOCUMENT_COMMENTS_PREFIX}/${project}/${agentKey}/${documentId}.json`;
  }

  private async read(req: Request, project: string, agentKey: MktgCommentAgentKey, documentId: string): Promise<MktgDocumentCommentsSnapshot> {
    const object = await this.store.getObject(req, 'marketing-os-artifacts', this.key(project, agentKey, documentId));
    if (!object) return { record: { schema: MKTG_DOCUMENT_COMMENTS_SCHEMA, project, agentKey, documentId, threads: [], submissions: [] } };
    if (!object.etag || Buffer.byteLength(object.body) > MKTG_DOCUMENT_COMMENT_STORE_MAX_BYTES) throw this.corrupt();
    let value: MktgDocumentCommentsRecord;
    try {
      value = JSON.parse(object.body) as MktgDocumentCommentsRecord;
    } catch {
      throw this.corrupt();
    }
    if (
      !value ||
      value.schema !== MKTG_DOCUMENT_COMMENTS_SCHEMA ||
      value.project !== project ||
      value.agentKey !== agentKey ||
      value.documentId !== documentId ||
      !Array.isArray(value.threads) ||
      value.threads.length > MKTG_DOCUMENT_COMMENT_MAX_THREADS ||
      !value.threads.every((entry) => this.validThread(entry)) ||
      new Set(value.threads.map((entry) => entry.id)).size !== value.threads.length ||
      new Set(value.threads.map((entry) => entry.clientRequestId)).size !== value.threads.length ||
      !Array.isArray(value.submissions) ||
      !value.submissions.every((entry) => this.validSubmission(entry, agentKey))
    )
      throw this.corrupt();
    return { record: value, etag: object.etag };
  }

  private validSubmission(value: MktgDocumentCommentSubmission, agent: MktgCommentAgentKey): boolean {
    return (
      !!value &&
      Object.keys(value).every((key) => (MKTG_REDRAFT_SUBMISSION_KEYS as readonly string[]).includes(key)) &&
      typeof value.id === 'string' &&
      MKTG_DOCUMENT_COMMENT_ID_REGEX.test(value.id) &&
      typeof value.requestedBy === 'string' &&
      !!value.requestedBy.trim() &&
      typeof value.createdAt === 'string' &&
      Number.isFinite(Date.parse(value.createdAt)) &&
      typeof value.baseRevisionId === 'string' &&
      MKTG_REVISION_ID_REGEX.test(value.baseRevisionId) &&
      Array.isArray(value.commentIds) &&
      value.commentIds.length > 0 &&
      value.commentIds.length <= MKTG_DOCUMENT_COMMENT_LIMITS[agent] &&
      value.commentIds.every((id) => typeof id === 'string' && MKTG_DOCUMENT_COMMENT_ID_REGEX.test(id)) &&
      new Set(value.commentIds).size === value.commentIds.length &&
      (MKTG_DOCUMENT_COMMENT_SUBMISSION_STATES as readonly string[]).includes(value.state) &&
      (value.runId === null || (typeof value.runId === 'string' && MKTG_STARTED_RUN_ID_REGEX.test(value.runId))) &&
      (value.resultRevisionId === null || (typeof value.resultRevisionId === 'string' && MKTG_REVISION_ID_REGEX.test(value.resultRevisionId)))
    );
  }

  private validThread(value: MktgStoredDocumentComment): boolean {
    return (
      !!value &&
      typeof value.id === 'string' &&
      MKTG_DOCUMENT_COMMENT_ID_REGEX.test(value.id) &&
      typeof value.clientRequestId === 'string' &&
      MKTG_DOCUMENT_COMMENT_ID_REGEX.test(value.clientRequestId) &&
      typeof value.revisionId === 'string' &&
      MKTG_REVISION_ID_REGEX.test(value.revisionId) &&
      !!value.anchor &&
      (MKTG_DOCUMENT_COMMENT_ANCHOR_KINDS as readonly string[]).includes(value.anchor.kind) &&
      typeof value.anchor.key === 'string' &&
      (value.anchor.passage === undefined || typeof value.anchor.passage === 'string') &&
      (value.authorId === null || typeof value.authorId === 'string') &&
      typeof value.text === 'string' &&
      value.text.length <= MKTG_DOCUMENT_COMMENT_MAX_CHARS &&
      typeof value.createdAt === 'string' &&
      !Number.isNaN(Date.parse(value.createdAt)) &&
      (MKTG_DOCUMENT_COMMENT_STATUSES as readonly string[]).includes(value.status) &&
      (value.sentInRun === null || (typeof value.sentInRun === 'string' && MKTG_STARTED_RUN_ID_REGEX.test(value.sentInRun))) &&
      (value.resultRevisionId === null || (typeof value.resultRevisionId === 'string' && MKTG_REVISION_ID_REGEX.test(value.resultRevisionId))) &&
      (value.resolution === null || typeof value.resolution === 'string')
    );
  }

  /** Explicit projection: never spread a private thread, even when stored data has extra fields. */
  private async project(req: Request, record: MktgDocumentCommentsRecord, revisionId: string): Promise<MktgDocumentCommentsResponse> {
    const selected = record.threads.filter((entry) => entry.revisionId === revisionId || entry.resultRevisionId === revisionId);
    const threads: MktgDocumentCommentsResponse['threads'] = [];
    for (let offset = 0; offset < selected.length; offset += MKTG_DOCUMENT_READ_CONCURRENCY) {
      threads.push(
        ...(await Promise.all(
          selected.slice(offset, offset + MKTG_DOCUMENT_READ_CONCURRENCY).map(async (entry) => {
            const author = await this.authors.resolveAuthor(req, entry.authorId, 'mktg_document_comment_author', 'Comment author lookup unavailable');
            return {
              id: entry.id,
              anchor: { kind: entry.anchor.kind, key: entry.anchor.key, ...(entry.anchor.passage !== undefined && { passage: entry.anchor.passage }) },
              revisionId: entry.revisionId,
              author,
              text: entry.text,
              createdAt: entry.createdAt,
              status: entry.status,
              sentInRun: entry.sentInRun,
              resultRevisionId: entry.resultRevisionId,
              resolution: entry.resolution,
            };
          })
        ))
      );
    }
    return { revisionId, threads };
  }

  private invalid(field: string, message: string): ServiceValidationError {
    return ServiceValidationError.forField(field, message);
  }
  private corrupt(): MicroserviceError {
    return new MicroserviceError('Stored comments are unreadable; no data was overwritten.', 502, 'MKTG_COMMENTS_CORRUPT');
  }
}
