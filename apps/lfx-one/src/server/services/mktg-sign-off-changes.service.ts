// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_DOCUMENT_COMMENT_DOCUMENT_ROOTS } from '@lfx-one/shared/constants';
import type {
  MktgCommentAgentKey,
  MktgDocumentSignOffAnnotation,
  MktgRevisionResponse,
  MktgSignOffChangeCommand,
  MktgSignOffChangeResult,
  MktgSignOffChangeScope,
} from '@lfx-one/shared/interfaces';
import { mktgSignOffRequestIds } from '@lfx-one/shared/utils';
import type { Request } from 'express';

import { AuthenticationError, AuthorizationError, ConflictError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { isImpersonating } from '../utils/auth-helper';
import { MktgDocumentAuthorService } from './mktg-document-author.service';
import { MktgDocumentCommentsService } from './mktg-document-comments.service';
import { MktgDocumentRedraftService } from './mktg-document-redraft.service';
import type { MktgDocumentRunService } from './mktg-document-run.service';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { ProjectService } from './project.service';

/** Internal only. Future handlers resolve the canonical writer scope; decide stays unmounted pending B1–B3/B6. */
export class MktgSignOffChangesService {
  private readonly documents = new MktgDocumentStoreService();
  private readonly comments = new MktgDocumentCommentsService();
  private readonly redrafts = new MktgDocumentRedraftService();
  private readonly authors = new MktgDocumentAuthorService();
  private readonly projects = new ProjectService();

  public async requestChanges(req: Request, scope: MktgSignOffChangeScope, note: string, runs: MktgDocumentRunService): Promise<MktgRevisionResponse> {
    this.actor(req);
    const { project, type, documentId, revisionId, role, nonce } = scope;
    const ids = mktgSignOffRequestIds(revisionId, role, nonce);
    if (!ids) throw ServiceValidationError.forField('nonce', 'A stored revision, role and bounded nonce are required.');
    const prepared = await this.transition(req, scope, { operation: 'reserve', role, nonce, note });
    if (!prepared.intent) {
      if (prepared.view.revision.signOff?.roles[role]?.decision !== 'changes-requested')
        throw new ConflictError('This role did not own the terminal request.', 'MKTG_SIGN_OFF_INTENT_CHANGED');
      return prepared.view; // FAQ atomically stores its note, or this exact role's terminal action was replayed.
    }
    const intentId = prepared.intent.id;
    const root = MKTG_DOCUMENT_COMMENT_DOCUMENT_ROOTS[type.agentKey as MktgCommentAgentKey];
    if (!root) throw ServiceValidationError.forField('agentKey', 'A prepared CR intent requires a comment root.');
    const receipt = await this.comments.addWithReceipt(req, project, type, documentId, {
      project,
      revisionId,
      anchor: { kind: 'document', key: root },
      text: prepared.intent.note,
      clientRequestId: ids.commentRequestId,
    });
    // The hook is fresh-reservation-only. Same-ID ACK recovery never creates another Guild POST.
    await this.redrafts.send(
      req,
      project,
      type,
      documentId,
      { project, revisionId, commentIds: [receipt.commentId], clientRequestId: ids.requestId },
      runs,
      async () => {
        await this.transition(req, scope, { operation: 'start', role, nonce, intentId });
      }
    );
    return (
      await this.transition(req, scope, {
        operation: 'finish',
        role,
        nonce,
        intentId,
        receipt: { commentId: receipt.commentId, submissionId: ids.requestId },
      })
    ).view; // Never return/store sessionId or ownerToken.
  }

  /** Same frozen actor recovers the stored input; never replace it with caller-supplied previous JSON or a new nonce. */
  public async recover(req: Request, scope: MktgSignOffChangeScope, runs: MktgDocumentRunService): Promise<MktgRevisionResponse> {
    const by = this.actor(req);
    const annotation = await this.annotation(req, scope);
    if (annotation.roles[scope.role] !== by) throw new AuthorizationError('Only the original role actor may recover this request.');
    const intent = annotation.changeRequestIntent;
    if (intent?.role === scope.role && intent.nonce === scope.nonce) return this.requestChanges(req, scope, intent.note, runs);
    if (
      annotation.state === 'changes-requested' &&
      annotation.changeRequestNonce === scope.nonce &&
      annotation.decisions[scope.role]?.decision === 'changes-requested'
    )
      return this.view(req, scope);
    throw new ConflictError('No matching recoverable intent exists.', 'MKTG_SIGN_OFF_INTENT_CHANGED');
  }

  /** Prepared closure uses the start fence; after starting, require CR proof and never timed theft. */
  public async release(req: Request, scope: MktgSignOffChangeScope): Promise<MktgRevisionResponse> {
    this.actor(req);
    const annotation = await this.annotation(req, scope);
    const authorize = () => this.authorizeRelease(req, scope, annotation);
    await authorize();
    const intent = annotation.changeRequestIntent;
    if (!intent) return this.view(req, scope); // Already closed; no write and no claim about an unknown CR nonce.
    if (intent.role !== scope.role || intent.nonce !== scope.nonce)
      throw new ConflictError('Another request owns this intent.', 'MKTG_SIGN_OFF_INTENT_CHANGED');
    if (intent.phase === 'prepared') {
      // No session can precede a successful start CAS. The store rechecks phase/UUID before fencing this worker.
      return (
        await this.transition(
          req,
          scope,
          {
            operation: 'release',
            role: scope.role,
            nonce: scope.nonce,
            intentId: intent.id,
            proof: 'unstarted',
          },
          authorize
        )
      ).view;
    }
    const ids = mktgSignOffRequestIds(scope.revisionId, scope.role, scope.nonce);
    const originalActor = annotation.roles[scope.role];
    if (!ids || !originalActor) throw ServiceValidationError.forField('intent', 'A correlated original role actor is required.');
    const proof = await this.comments.signOffSubmissionProof(
      req,
      scope.project,
      scope.type,
      scope.documentId,
      {
        revisionId: scope.revisionId,
        requestedBy: originalActor,
        requestId: ids.requestId,
        commentRequestId: ids.commentRequestId,
      },
      authorize
    );
    if (proof.state === 'accepted')
      return (
        await this.transition(
          req,
          scope,
          {
            operation: 'finish',
            role: scope.role,
            nonce: scope.nonce,
            intentId: intent.id,
            receipt: { commentId: proof.commentId, submissionId: ids.requestId },
          },
          authorize
        )
      ).view;
    if (proof.state !== 'failed' && proof.state !== 'released')
      throw new ConflictError('Recover the in-flight redraft before releasing.', 'MKTG_SIGN_OFF_RELEASE_UNSAFE');
    return (
      await this.transition(
        req,
        scope,
        {
          operation: 'release',
          role: scope.role,
          nonce: scope.nonce,
          intentId: intent.id,
          proof: proof.state,
        },
        authorize
      )
    ).view;
  }

  private actor(req: Request): string {
    if (isImpersonating(req)) throw new AuthorizationError('Sign-off is unavailable while impersonating.');
    const actor = this.authors.captureAuthorId(req);
    if (!actor) throw new AuthenticationError('A signed-in subject is required.');
    return actor;
  }
  private async authorizeRelease(req: Request, scope: MktgSignOffChangeScope, annotation: MktgDocumentSignOffAnnotation): Promise<void> {
    if (this.actor(req) === annotation.roles[scope.role]) return;
    const project = await this.projects.getProjectById(req, scope.project, true);
    if (!project.writer || project.uid !== scope.project) throw new AuthorizationError('Only the role actor or a project writer may release this intent.');
  }
  private async annotation(req: Request, scope: MktgSignOffChangeScope): Promise<MktgDocumentSignOffAnnotation> {
    const annotation = await this.documents.signOffAnnotation(req, scope.project, scope.type, scope.documentId, scope.revisionId);
    if (!annotation) throw new ResourceNotFoundError('Sign-off request', scope.revisionId);
    return annotation;
  }
  private async transition(
    req: Request,
    scope: MktgSignOffChangeScope,
    command: MktgSignOffChangeCommand,
    authorize?: () => Promise<void>
  ): Promise<MktgSignOffChangeResult> {
    const result = await this.documents.changeRequestTransition(req, scope.project, scope.type, scope.documentId, scope.revisionId, command, authorize);
    if (!result) throw new ResourceNotFoundError('Marketing OS revision', scope.revisionId);
    return result;
  }
  private async view(req: Request, scope: MktgSignOffChangeScope): Promise<MktgRevisionResponse> {
    const view = await this.documents.getRevision(req, scope.project, scope.type, scope.documentId, scope.revisionId);
    if (!view) throw new ResourceNotFoundError('Marketing OS revision', scope.revisionId);
    return view;
  }
}
