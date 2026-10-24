// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MKTG_ARTIFACT_DEFAULT_DRAFT_VERSION,
  MKTG_ARTIFACT_INTAKE_MODES,
  MKTG_ARTIFACT_PARTITION_REGEX,
  MKTG_ARTIFACT_SPECS,
  MKTG_ASSET_APPROVAL_REQUIRED_MESSAGE,
  MKTG_DOCUMENT_CURRENT_KEY,
  MKTG_DOCUMENT_READ_CONCURRENCY,
  MKTG_DOCUMENT_TYPES,
  MKTG_DOCUMENT_COMMENT_LIMITS,
  MKTG_DOCUMENT_WRITE_ATTEMPTS,
  MKTG_LIVING_DOCUMENT_ID,
  MKTG_REVISION_CONTENT_TYPE,
  MKTG_REVISION_SCHEMA,
  MKTG_REVISION_STATUS_METADATA_MAX_CHARS,
  MKTG_KIT_FRAMEWORK_KEY,
  MKTG_GENERATION_PROVENANCE_KEY_PREFIX,
  MKTG_REBUILD_DOWNSTREAM_KEYS,
  MKTG_REBUILD_UPSTREAM_METADATA_KEY,
  MKTG_REBUILD_UPSTREAM_SIDECAR_KEY,
} from '@lfx-one/shared/constants';
import { LINKEDIN_AGENT_KEY } from '@lfx-one/shared/constants/linkedin-post.constants';
import {
  LinkedinShareLinkResponse,
  MktgArtifactEnvelope,
  MktgArtifactIntakeMode,
  MktgArtifactJsonEnvelope,
  MktgArtifactPersistReceipt,
  MktgArtifactSpec,
  MktgArtifactStoredResponse,
  MktgDocumentAgentKey,
  MktgDocumentApprovalAnnotation,
  MktgDocumentCurrentRecord,
  MktgDocumentCurrentSelection,
  MktgDocumentCurrentSnapshot,
  MktgDocumentDetailResponse,
  MktgDocumentGroup,
  MktgDocumentsResponse,
  MktgDocumentType,
  MktgGenerationProvenance,
  MktgGenerationAttribution,
  MktgLegacyDocument,
  MktgListedRevision,
  MktgRevisionRef,
  MktgRevisionApproval,
  MktgRevisionAuthor,
  MktgProjectRole,
  MktgRedraftRevisionMetadata,
  MktgDocumentRedraftContext,
  MktgRevisionContentSource,
  MktgRevisionFormat,
  MktgRevisionRecord,
  MktgRevisionRecordFields,
  MktgRevisionResponse,
  MktgRevisionSummary,
  MktgRunPersistReceipt,
  MktgStoredRevision,
  MktgDocumentSignOffAnnotation,
  MktgSignOffAction,
  MktgSignOffAttribution,
  MktgSignOffWrite,
  MktgSignOffChangeCommand,
  MktgSignOffChangeResult,
} from '@lfx-one/shared/interfaces';
import {
  buildMktgArtifactObjectKey,
  buildMktgArtifactPartitionPrefix,
  buildMktgDocumentPrefix,
  buildMktgDocumentProjectPrefix,
  buildMktgLegacyRevisionId,
  buildMktgRevisionId,
  buildMktgRevisionKey,
  extractMktgArtifactKeySha,
  findMktgDocumentStatus,
  findMktgDocumentType,
  parseMktgLegacyRevisionId,
  parseMktgRevisionKey,
  readLinkedinDocumentContent,
  readMktgFrameworkRef,
  projectMktgRebuildStaleness,
  validateMktgRedraftResult,
} from '@lfx-one/shared/utils';
import { envelopeSchema as member360Schema } from '@lfx-one/shared/server';
import { Request } from 'express';
import { createHash, randomUUID } from 'node:crypto';
// Main-owned service: untouched specs mock shared barrels with explicit leaf lists.
import { MKTG_DOCUMENT_COMMENT_ROOTS } from '@lfx-one/shared/constants/mktg-document-comments.constants';
import {
  MKTG_SIGN_OFF_NOTE_MAX_CHARS,
  MKTG_SIGN_OFF_NONCE_REGEX,
  MKTG_SIGN_OFF_RELEASED_NONCE_LIMIT,
  MKTG_SIGN_OFF_UUID_REGEX,
  MKTG_SIGN_OFF_NOTE_ONLY_AGENT_KEYS,
} from '@lfx-one/shared/constants/mktg-sign-off.constants';
import { mktgSignOffRequestIds } from '@lfx-one/shared/utils/mktg-sign-off.utils';
import { isDeepStrictEqual } from 'node:util';

import { AuthorizationError, ConflictError, MicroserviceError, PreconditionFailedError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { getEffectiveSub, isImpersonating } from '../utils/auth-helper';
import { buildMktgRunDocumentId } from '../utils/mktg-document-store.util';
import { LinkedinDocumentPresentationService } from './linkedin-document-presentation.service';
import { logger } from './logger.service';
import { MktgArtifactService } from './mktg-artifact.service';
import { MktgSignOffSettingsService } from './mktg-sign-off-settings.service';
import { MktgProjectRolesService } from './mktg-project-roles.service';
import { ObjectStoreService } from './object-store.service';
import { MktgDocumentAuthorService } from './mktg-document-author.service';
import { MktgDocumentRedraftContextService } from './mktg-document-redraft-context.service';

/**
 * Immutable revision bundles, mutable current pointer. The pointer is also the
 * commit boundary: its revisionIds exclude orphan objects from interrupted or
 * losing concurrent writes. No pointer means the historical listing is current.
 * Attribution stores an opaque user ID only, outside the hashed revision body.
 * Names, usernames and emails are never stored as attribution in these objects:
 * names are resolved at read time so erasure never requires rewriting history.
 */
export class MktgDocumentStoreService {
  private readonly objectStore = new ObjectStoreService();
  private readonly redrafts = new MktgDocumentRedraftContextService();
  private readonly artifactService = new MktgArtifactService();
  private readonly signOffSettings = new MktgSignOffSettingsService();
  private readonly projectRoles = new MktgProjectRolesService();
  private readonly revisionSubjects = new WeakMap<Request, Map<string, Map<string, string | null>>>();
  private readonly linkedinPresentation = new LinkedinDocumentPresentationService();

  /** A per-generation context only; never change the visiting Request or share an override across runs. */
  public constructor(
    private readonly generationAttribution?: MktgGenerationAttribution,
    private readonly authors = new MktgDocumentAuthorService()
  ) {}

  /** Persist the compatibility artifact, then publish its revision before returning a receipt. */
  public async persistGeneration(
    req: Request,
    spec: MktgArtifactSpec,
    envelope: MktgArtifactEnvelope,
    projectUid: string | undefined,
    sessionId: string
  ): Promise<MktgArtifactPersistReceipt | null> {
    try {
      const context = await this.redrafts.forSession(req, sessionId);
      if (context || (envelope as MktgArtifactEnvelope & Record<string, unknown>)['mode'] === 'redraft') {
        const project = await this.artifactService.resolveWritablePartition(req, spec, projectUid);
        this.assertRedraftSource(context, project ?? undefined, spec.agentKey, envelope);
      }
      const receipt = await this.artifactService.persist(req, spec, envelope, projectUid, { revisionManaged: true });
      return receipt ? await this.recordPersisted(req, spec.agentKey, receipt, envelope, sessionId) : null;
    } catch (error) {
      logger.warning(req, 'mktg_document_store_persist', 'Asset was not persisted; returning no receipt', { err: error });
      return null;
    }
  }

  /** Persist structured content through the same CAS writer; JSON has no pre-revision Markdown twin. */
  public async persistJsonGeneration<T extends object>(
    req: Request,
    spec: MktgArtifactSpec,
    envelope: MktgArtifactJsonEnvelope<T>,
    projectUid: string | undefined,
    sessionId: string
  ): Promise<MktgArtifactPersistReceipt | null> {
    const partition = await this.artifactService.resolveWritablePartition(req, spec, projectUid);
    const type = findMktgDocumentType(spec.agentKey);
    if (!partition || !type) return null;
    try {
      const revision = await this.recordGeneration(req, type, partition, this.jsonSource(envelope), sessionId);
      return {
        s3_key: revision.key,
        content_sha256: envelope.content_sha256,
        project: partition,
        version: envelope.version,
        intake_mode: envelope.intake.mode,
        document_location: { agent_key: type.agentKey, document_id: revision.record.documentId, revision_id: revision.id },
      };
    } catch (error) {
      logger.warning(req, 'mktg_document_store_record', 'Revision write failed — returning the asset without a receipt; retried on next poll', {
        agent: type.agentKey,
        project: partition,
        err: error,
      });
      return null;
    }
  }

  /** A failed revision write drops the receipt so the next result poll retries. */
  public async recordPersisted<T extends MktgRunPersistReceipt>(
    req: Request,
    agentKey: MktgDocumentAgentKey,
    receipt: T,
    envelope: MktgArtifactEnvelope | MktgRevisionContentSource,
    sessionId: string
  ): Promise<T | null> {
    const type = findMktgDocumentType(agentKey);
    if (!type) return receipt;
    try {
      const revision = await this.recordGeneration(req, type, receipt.project, envelope, sessionId);
      return {
        ...receipt,
        s3_key: revision.key,
        document_location: { agent_key: agentKey, document_id: revision.record.documentId, revision_id: revision.id },
      };
    } catch (error) {
      logger.warning(req, 'mktg_document_store_record', 'Revision write failed — returning the document without a receipt; retried on next poll', {
        agent: type.agentKey,
        project: receipt.project,
        err: error,
      });
      return null;
    }
  }

  /** Capture the exact approved input BEFORE starting a session; content mismatch means unknown provenance. */
  public async captureFramework(req: Request, project: string | undefined, supplied: unknown, expected?: MktgRevisionRef): Promise<MktgRevisionRef | null> {
    if (!project || !MKTG_ARTIFACT_PARTITION_REGEX.test(project)) {
      if (expected) throw ServiceValidationError.forField('project', 'A valid project is required for the rebuild input.');
      return null;
    }
    try {
      const partition = await this.artifactService.resolveWritablePartition(req, MKTG_ARTIFACT_SPECS[MKTG_KIT_FRAMEWORK_KEY], project);
      if (!partition) {
        if (expected) throw new MicroserviceError('The approved framework input could not be verified for this project.', 503, 'MKTG_PROVENANCE_UNAVAILABLE');
        return null;
      }
      const type = findMktgDocumentType(MKTG_KIT_FRAMEWORK_KEY);
      if (!type) return null;
      const detail = await this.getDocument(req, partition, type, MKTG_LIVING_DOCUMENT_ID);
      const summary = this.approvedCurrentOf(detail);
      if (!detail || !summary) {
        if (expected) throw new ConflictError('The framework is no longer approved. Reload before rebuilding.', 'MKTG_APPROVED_CURRENT_CHANGED');
        return null;
      }
      if (expected && (expected.revisionId !== summary.id || expected.contentSha256 !== summary.contentSha256))
        throw new ConflictError('The approved framework changed. Reload before rebuilding.', 'MKTG_APPROVED_CURRENT_CHANGED');
      const stored = await this.loadApprovedRevision(req, detail, summary);
      if (stored.record.bundle.format !== 'json' || !isDeepStrictEqual(JSON.parse(stored.record.bundle.markdown), supplied)) {
        if (expected) throw new ConflictError('The rebuild input does not match the approved framework.', 'MKTG_FRAMEWORK_INPUT_MISMATCH');
        return null;
      }
      return { agentKey: type.agentKey, revisionId: summary.id, revisionNumber: summary.number, contentSha256: summary.contentSha256 };
    } catch (err) {
      if (expected) throw err;
      // A run-page generation still starts as on main; unverified input must never become false provenance.
      logger.warning(req, 'mktg_generation_provenance', 'Framework input could not be verified; provenance remains unknown', { project, err });
      return null;
    }
  }

  /** Publish capture before returning the session capability. Storage failure must not return an untracked new session. */
  public async rememberGenerationFramework(
    req: Request,
    agentKey: MktgDocumentAgentKey,
    project: string | undefined,
    sessionId: string,
    framework: MktgRevisionRef | null
  ): Promise<void> {
    if (!framework) return;
    if (!project || !MKTG_ARTIFACT_PARTITION_REGEX.test(project))
      throw new MicroserviceError('No writable provenance partition.', 503, 'MKTG_PROVENANCE_UNAVAILABLE');
    const partition = await this.artifactService.resolveWritablePartition(req, MKTG_ARTIFACT_SPECS[MKTG_KIT_FRAMEWORK_KEY], project);
    if (!partition) throw new MicroserviceError('No writable provenance partition.', 503, 'MKTG_PROVENANCE_UNAVAILABLE');
    const key = this.generationProvenanceKey(partition, agentKey, sessionId);
    const capture: MktgGenerationProvenance = { project: partition, agentKey, framework };
    const body = JSON.stringify(capture);
    const written = await this.objectStore.putConditionalObject(req, 'marketing-os-artifacts', key, {
      body: Buffer.from(body),
      contentType: MKTG_REVISION_CONTENT_TYPE,
      cacheControl: 'private',
      ifNoneMatch: '*',
    });
    if (!written && (await this.objectStore.getObject(req, 'marketing-os-artifacts', key))?.body !== body)
      throw new PreconditionFailedError('The generation input was already recorded differently. Start a new run.');
  }

  /** One shared append path for runs now and the future comment-and-revise writer. */
  public async recordGeneration(
    req: Request,
    type: MktgDocumentType,
    project: string,
    envelope: MktgArtifactEnvelope | MktgRevisionContentSource,
    sessionId: string
  ): Promise<MktgStoredRevision> {
    const documentId = type.kind === 'run' ? buildMktgRunDocumentId(sessionId) : MKTG_LIVING_DOCUMENT_ID;
    const source = 'document_markdown' in envelope ? this.markdownSource(envelope) : envelope;
    const redraft = await this.redrafts.forSession(req, sessionId);
    this.assertRedraftSource(redraft, project, type.agentKey, source.sidecar);
    if (redraft && redraft.documentId !== documentId) throw ServiceValidationError.forField('redraft', 'The redraft does not name this document.');
    let sidecar = source.sidecar;
    if (type.kind === 'living' && MKTG_REBUILD_DOWNSTREAM_KEYS.includes(type.agentKey)) {
      const framework = await this.generationFramework(req, project, type.agentKey, sessionId);
      // An agent envelope cannot manufacture host provenance. Only our captured identity is authoritative.
      if (sidecar) {
        sidecar = { ...sidecar };
        delete sidecar[MKTG_REBUILD_UPSTREAM_SIDECAR_KEY];
      }
      if (framework) sidecar = { ...sidecar, [MKTG_REBUILD_UPSTREAM_SIDECAR_KEY]: framework };
    }
    return this.recordRevision(
      req,
      project,
      type,
      documentId,
      {
        createdAt: new Date().toISOString(),
        origin: redraft ? 'revised' : 'generated',
        restoredFromId: null,
        ...(redraft && { basedOnId: redraft.basedOnId }),
        source: { sessionId, draftVersion: source.version, intakeMode: source.intakeMode },
        bundle: { markdown: source.text, contentSha256: source.contentSha256, format: source.format, sidecar, brandFile: null },
      },
      this.sha256(type.kind === 'run' ? sessionId : `${sessionId}:${source.contentSha256}`),
      source.contentSha256,
      redraft ? { redraftRunId: redraft.runId, commentCount: redraft.comments.length } : undefined
    );
  }

  /**
   * A CAS publishes a revision and moves current together. Losing writers retry
   * against the committed listing; overlapping polls find the winner's token.
   * Each attempt re-derives its automatic base from the fresh committed snapshot.
   * New drafts extend the manifest without replacing an approved current selection.
   * An explicitly supplied basedOnId (including null) survives retries: it is the writer's actual base.
   * Pre-revision documents become revision 1; same-generation polls are no-ops
   * under If-None-Match, including historical records without generation metadata.
   */
  public async recordRevision(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    fields: MktgRevisionRecordFields,
    generation?: string,
    excludeLegacySha?: string,
    redraftMetadata?: MktgRedraftRevisionMetadata
  ): Promise<MktgStoredRevision> {
    for (let attempt = 0; attempt < MKTG_DOCUMENT_WRITE_ATTEMPTS; attempt++) {
      const snapshot = await this.readCurrent(req, project, type, documentId);
      const entries = await this.listRevisions(req, project, type, documentId, snapshot);
      const existing =
        type.kind === 'run'
          ? entries[0]
          : entries.find(
              (entry) =>
                generation &&
                (entry.metadata?.['generation'] === generation ||
                  (entry.record && this.sha256(`${entry.record.source.sessionId}:${entry.record.bundle.contentSha256}`) === generation))
            );
      if (existing) {
        const stored = await this.loadRevision(req, existing, project);
        if (!stored) throw this.corruptDocument('Committed revision is unreadable');
        return stored;
      }
      if (entries.length === 0 && type.kind === 'living') {
        const legacy = await this.readLegacyDocument(req, type, project, excludeLegacySha);
        if (legacy) {
          const migrated = await this.writeRevision(req, project, type, documentId, 1, {
            createdAt: legacy.storedAt ?? fields.createdAt,
            origin: 'legacy',
            restoredFromId: null,
            basedOnId: null,
            source: { sessionId: null, draftVersion: legacy.draftVersion, intakeMode: legacy.intakeMode },
            bundle: { markdown: legacy.markdown, contentSha256: legacy.sha, sidecar: null, brandFile: null },
          });
          const parsed = parseMktgRevisionKey(migrated.key, buildMktgDocumentProjectPrefix(project));
          if (!parsed) throw this.corruptDocument('Migrated revision has an invalid key');
          entries.push({ ...parsed, key: migrated.key });
        }
      }
      const basedOnId = fields.basedOnId === undefined ? (snapshot.record?.revisionId ?? entries.at(-1)?.id ?? null) : fields.basedOnId;
      if (basedOnId && !entries.some((entry) => entry.id === basedOnId)) {
        throw ServiceValidationError.forField('basedOnId', 'The base revision does not belong to this document.');
      }
      const next = entries.reduce((maximum, entry) => Math.max(maximum, entry.sequence), 0) + 1;
      const revision = await this.writeRevision(req, project, type, documentId, next, { ...fields, basedOnId }, generation, redraftMetadata);
      // A generated Draft commits to the manifest without displacing approved current.
      const keepSelection = Boolean(
        type.kind === 'living' && snapshot.record && Object.hasOwn(this.approvalsOf(snapshot.record.approvals), snapshot.record.revisionId)
      );
      if (
        await this.writeCurrent(req, project, type, documentId, snapshot, revision.id, [...entries.map((entry) => entry.id), revision.id], false, keepSelection)
      ) {
        logger.info(req, 'mktg_document_store_record', 'Committed a new document revision', { project, agent: type.agentKey, revision: revision.id });
        return revision;
      }
    }
    throw new PreconditionFailedError('The document changed while saving. Try again.');
  }

  /** Navigation uses metadata, with bounded body fallback for historical writers. */
  public async listDocuments(req: Request, project: string, strictAgentKey?: string | readonly string[]): Promise<MktgDocumentsResponse> {
    const prefix = buildMktgDocumentProjectPrefix(project);
    const listed = await this.objectStore.listObjects(req, 'marketing-os-artifacts', prefix);
    const groups: MktgDocumentGroup[] = [];
    for (const type of MKTG_DOCUMENT_TYPES) {
      const strict = typeof strictAgentKey === 'string' ? type.agentKey === strictAgentKey : strictAgentKey?.includes(type.agentKey);
      const listedIds = new Set(
        listed.flatMap((object) => {
          const entry = parseMktgRevisionKey(object.key, prefix);
          if (!entry || entry.agentKey !== type.agentKey) return [];
          return [entry.documentId];
        })
      );
      const ids = new Set(listedIds);
      if (type.kind === 'living') ids.add(MKTG_LIVING_DOCUMENT_ID);
      const documents: MktgDocumentGroup['documents'] = [];
      const documentIds = [...ids];
      for (let offset = 0; offset < documentIds.length; offset += MKTG_DOCUMENT_READ_CONCURRENCY) {
        // Four documents in flight; each uses serial metadata/body reads so the
        // total I/O fan-out, not just the per-document fan-out, stays at four.
        const details = await Promise.all(
          documentIds.slice(offset, offset + MKTG_DOCUMENT_READ_CONCURRENCY).map((id) =>
            this.getDocument(req, project, type, id, 1).catch((err: unknown) => {
              // Access failures must still fail the request, not masquerade as missing documents.
              if (strict || !(err instanceof MicroserviceError) || err.statusCode < 500) throw err;
              logger.warning(req, 'mktg_document_store_list', 'Document unreadable — omitting', { project, documentId: id, err });
              return null;
            })
          )
        );
        for (const [index, detail] of details.entries()) {
          if (!detail) {
            if (strict && (typeof strictAgentKey === 'string' || listedIds.has(documentIds[offset + index])))
              throw new MicroserviceError('A listed document is unreadable.', 503, 'MKTG_DOCUMENT_UNREADABLE');
            continue;
          }
          const current = detail.revisions.find((revision) => revision.latest);
          if (!current) {
            if (strict) throw new MicroserviceError('A listed document is unreadable.', 503, 'MKTG_DOCUMENT_UNREADABLE');
            logger.warning(req, 'mktg_document_store_list', 'Current revision is missing — omitting document', {
              project,
              agent: type.agentKey,
              documentId: detail.documentId,
            });
            continue;
          }
          documents.push({
            agentKey: type.agentKey,
            documentId: detail.documentId,
            revisionCount: detail.revisions.length,
            latestRevisionId: current.id,
            approvedCurrent: detail.approvedCurrent,
            currentRevisionNumber: current.number,
            contentSha256: current.contentSha256,
            upstreamFramework: current.upstreamFramework ?? null,
            updatedAt: current.createdAt,
            createdAt: detail.revisions.at(-1)?.createdAt ?? null,
          });
        }
      }
      documents.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      groups.push({ type, documents });
    }
    return projectMktgRebuildStaleness({ project, groups });
  }

  /** Read summaries and the current selection with bounded I/O, without downloading new revision bodies. */
  public async getDocument(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    readConcurrency = MKTG_DOCUMENT_READ_CONCURRENCY
  ): Promise<MktgDocumentDetailResponse | null> {
    const snapshot = await this.readCurrent(req, project, type, documentId);
    const detail = await this.readDocument(req, project, type, documentId, snapshot, readConcurrency);
    const current = snapshot.record;
    if (
      type.kind === 'living' &&
      current &&
      Object.hasOwn(current.approvals ?? {}, current.revisionId) &&
      !detail?.revisions.some((revision) => revision.id === current.revisionId)
    ) {
      throw new MicroserviceError('The approved current revision could not be read.', 502, 'MKTG_APPROVED_REVISION_UNREADABLE');
    }
    return detail;
  }

  /**
   * Approved-current identity through the normal listing path: content-sha metadata
   * avoids body reads; historical revisions without it are hydrated as in any listing.
   */
  public async readApprovedCurrentSummary(req: Request, project: string, type: MktgDocumentType, documentId: string): Promise<MktgRevisionSummary | null> {
    return this.approvedCurrentOf(await this.getDocument(req, project, type, documentId));
  }

  /** Read one integrity-checked revision body with its document's navigation summaries. */
  public async getRevision(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    revisionId: string
  ): Promise<MktgRevisionResponse | null> {
    const detail = await this.getDocument(req, project, type, documentId);
    const view = detail ? await this.readRevision(req, detail, revisionId) : null;
    if (!view || type.agentKey !== 'member-360') return view;
    const candidate = view.sidecar?.['member360'];
    const parsed = member360Schema.safeParse(candidate);
    const member360 =
      parsed.success && this.sha256(JSON.stringify((candidate as typeof parsed.data).tabs)) === parsed.data.content_sha256
        ? (candidate as typeof parsed.data)
        : undefined;
    const sidecar = { ...view.sidecar };
    if (!member360) delete sidecar['member360'];
    return { ...view, sidecar, member360 };
  }

  /** Compatibility endpoint name; the action moves current and never adds a revision. */
  public async restoreRevision(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    revisionId: string
  ): Promise<{ detail: MktgDocumentDetailResponse; revision: MktgRevisionSummary } | null> {
    if (type.kind === 'run') throw ServiceValidationError.forField('documentId', 'Make current is not available for one-off run documents.');
    const snapshot = await this.readCurrent(req, project, type, documentId);
    const detail = await this.readDocument(req, project, type, documentId, snapshot);
    const view = detail ? await this.readRevision(req, detail, revisionId) : null;
    if (!view) return null;
    let record = snapshot.record;
    if (!view.revision.latest) {
      const committed = await this.writeCurrent(
        req,
        project,
        type,
        documentId,
        snapshot,
        view.revision.id,
        view.revisions.map((entry) => entry.id)
      );
      if (!committed) throw new PreconditionFailedError('The document changed while making a revision current. Reload and try again.');
      record = committed;
    }
    const revisions = view.revisions.map((entry) => ({ ...entry, latest: entry.id === view.revision.id }));
    const updated = await this.withApprovals(req, { project, type, documentId, revisions, current: null, approvedCurrent: null }, record);
    return { detail: updated, revision: { ...view.revision, latest: true } };
  }

  /** Approve and select an immutable stored revision in a single fail-fast CAS. */
  public async approveRevision(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    revisionId: string
  ): Promise<MktgRevisionResponse | null> {
    if (type.kind === 'run') throw ServiceValidationError.forField('documentId', 'Approve is not available for one-off run documents.');
    if ((await this.signOffSettings.modeOf(req, project)) === 'two-role') {
      throw new ConflictError('This project requires two-role sign-off.', 'MKTG_SIGN_OFF_REQUIRED');
    }
    const snapshot = await this.readCurrent(req, project, type, documentId);
    if (snapshot.record?.signOff?.[revisionId]?.changeRequestIntent) throw new ConflictError('A change request is in progress.', 'MKTG_SIGN_OFF_CHANGE_BUSY');
    const detail = await this.readDocument(req, project, type, documentId, snapshot);
    const view = detail ? await this.readRevision(req, detail, revisionId) : null;
    if (!view) return null;
    if (parseMktgLegacyRevisionId(view.revision.id)) {
      throw ServiceValidationError.forField('revisionId', 'A revision must be stored before it can be approved.');
    }
    if (view.revision.latest && view.approval) return view;
    const committed = await this.writeCurrent(
      req,
      project,
      type,
      documentId,
      snapshot,
      view.revision.id,
      view.revisions.map((entry) => entry.id),
      true
    );
    if (!committed) throw new PreconditionFailedError('The document changed while making a revision current. Reload and try again.');
    const updated = await this.withApprovals(
      req,
      {
        ...detail,
        project,
        type,
        documentId,
        revisions: view.revisions.map((entry) => ({ ...entry, latest: entry.id === view.revision.id })),
        current: null,
        approvedCurrent: null,
      },
      committed
    );
    const revision = updated.revisions.find((entry) => entry.id === view.revision.id);
    return revision ? { ...updated, revision, approval: revision.approval, markdown: view.markdown, sidecar: view.sidecar } : null;
  }

  /**
   * Internal send/approve seam; request changes uses the guarded intent seam below.
   * It must enforce project-writer entitlement and pre-send checks; no client may supply frozen identities.
   */
  public async transitionSignOff(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    revisionId: string,
    action: MktgSignOffAction
  ): Promise<MktgRevisionResponse | null> {
    if (isImpersonating(req)) throw new AuthorizationError('Sign-off is not available while impersonating a user');
    const by = this.author(req);
    if (type.kind !== 'living') throw ServiceValidationError.forField('documentId', 'Sign-off is only available for living documents.');
    if ((await this.signOffSettings.modeOf(req, project)) !== 'two-role') {
      throw new ConflictError('Two-role sign-off is switched off.', 'MKTG_SIGN_OFF_DISABLED');
    }
    const snapshot = await this.readCurrent(req, project, type, documentId);
    const detail = await this.readDocument(req, project, type, documentId, snapshot);
    const view = detail ? await this.readRevision(req, detail, revisionId) : null;
    if (!view) return null;
    if (parseMktgLegacyRevisionId(revisionId)) throw ServiceValidationError.forField('revisionId', 'Sign-off requires a stored revision.');
    const signOff = this.signOffOf(snapshot.record?.signOff, type);
    const approvals = this.approvalsOf(snapshot.record?.approvals);
    const at = new Date().toISOString();
    let annotation = signOff[revisionId];
    if ('roles' in action) {
      if (Object.entries(signOff).some(([id, entry]) => entry.state === 'pending' && !Object.hasOwn(approvals, id))) {
        throw new ConflictError('This document already has a pending sign-off request.', 'MKTG_SIGN_OFF_PENDING');
      }
      if (annotation || view.approval) throw new ConflictError('Send requires a new Draft revision.', 'MKTG_SIGN_OFF_TERMINAL');
      if (!action.roles.ed?.trim() || !action.roles.tocChair?.trim()) throw ServiceValidationError.forField('roles', 'Both sign-off roles must resolve.');
      annotation = { state: 'pending', requestedAt: at, requestedBy: by, roles: { ed: action.roles.ed, tocChair: action.roles.tocChair }, decisions: {} };
    } else {
      if (action.role !== 'ed' && action.role !== 'tocChair') throw ServiceValidationError.forField('role', 'Unknown sign-off role');
      if (!annotation || annotation.state !== 'pending' || Object.hasOwn(approvals, revisionId))
        throw new ConflictError('There is no pending request for this revision.', 'MKTG_SIGN_OFF_NOT_PENDING');
      if (!by || annotation.roles[action.role] !== by) throw new AuthorizationError('Only the frozen approver may decide for this role');
      if (annotation.decisions[action.role]) throw new ConflictError('This role already decided.', 'MKTG_SIGN_OFF_ALREADY_DECIDED');
      if (annotation.changeRequestIntent) throw new ConflictError('A change request is in progress.', 'MKTG_SIGN_OFF_CHANGE_BUSY');
      if (action.decision !== 'approved') throw ServiceValidationError.forField('decision', 'Request changes requires the intent workflow.');
      annotation.decisions[action.role] = { at, by, decision: action.decision };
      if (annotation.decisions.ed?.decision === 'approved' && annotation.decisions.tocChair?.decision === 'approved') {
        annotation = { ...annotation, state: 'approved', approvedAt: at };
      }
    }
    signOff[revisionId] = annotation;
    const ed = annotation.decisions.ed;
    const tocChair = annotation.decisions.tocChair;
    const approval =
      annotation.state === 'approved' && ed && tocChair ? { ed: { at: ed.at, by: ed.by }, tocChair: { at: tocChair.at, by: tocChair.by } } : undefined;
    const selected = approval ? revisionId : (snapshot.record?.revisionId ?? view.revisions.find((entry) => entry.latest)?.id ?? revisionId);
    const committed = await this.writeCurrent(
      req,
      project,
      type,
      documentId,
      snapshot,
      selected,
      view.revisions.map((entry) => entry.id),
      !!approval,
      !approval,
      { signOff, approval }
    );
    if (!committed) throw new PreconditionFailedError('The document changed during sign-off. Reload and try again.');
    logger.info(req, 'mktg_document_sign_off', 'Committed sign-off transition', { state: annotation.state });
    return this.signOffResult(req, view, committed);
  }

  /** Server-only frozen metadata; caller supplies canonical scope/access, never expose this through HTTP. */
  public async signOffAnnotation(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    revisionId: string
  ): Promise<MktgDocumentSignOffAnnotation | null> {
    if (typeof project !== 'string' || !MKTG_ARTIFACT_PARTITION_REGEX.test(project) || type.kind !== 'living' || documentId !== MKTG_LIVING_DOCUMENT_ID)
      throw ServiceValidationError.forField('document', 'A canonical living document is required.');
    const snapshot = await this.readCurrent(req, project, type, documentId);
    return snapshot.record?.revisionIds.includes(revisionId) ? (snapshot.record.signOff?.[revisionId] ?? null) : null;
  }

  /** All intent/terminal mutations share the existing writeCurrent CAS. Callback is server authorization, not a client flag. */
  public async changeRequestTransition(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    revisionId: string,
    command: MktgSignOffChangeCommand,
    authorizeWriter?: () => void | Promise<void>
  ): Promise<MktgSignOffChangeResult | null> {
    if (isImpersonating(req)) throw new AuthorizationError('Sign-off is unavailable while impersonating.');
    const by = this.author(req);
    const ids = mktgSignOffRequestIds(revisionId, command.role, command.nonce);
    if (
      !ids ||
      !['reserve', 'start', 'finish', 'release'].includes(command.operation) ||
      type.kind !== 'living' ||
      documentId !== MKTG_LIVING_DOCUMENT_ID ||
      typeof project !== 'string' ||
      !MKTG_ARTIFACT_PARTITION_REGEX.test(project)
    )
      throw ServiceValidationError.forField('changeRequest', 'A canonical stored revision, role and bounded nonce are required.');
    for (let attempt = 0; ; attempt++) {
      const snapshot = await this.readCurrent(req, project, type, documentId);
      const detail = await this.readDocument(req, project, type, documentId, snapshot);
      const view = detail ? await this.readRevision(req, detail, revisionId) : null;
      if (!view) return null;
      const signOff = this.signOffOf(snapshot.record?.signOff, type);
      const annotation = signOff[revisionId];
      if (!annotation || Object.hasOwn(this.approvalsOf(snapshot.record?.approvals), revisionId))
        throw new ConflictError('There is no pending request for this revision.', 'MKTG_SIGN_OFF_NOT_PENDING');
      if (!by || by !== annotation.roles[command.role]) {
        if (!authorizeWriter || (command.operation !== 'finish' && command.operation !== 'release'))
          throw new AuthorizationError('Only the frozen role actor may request changes.');
        await authorizeWriter();
      }
      const intent = annotation.changeRequestIntent;
      if (
        annotation.state === 'changes-requested' &&
        annotation.changeRequestNonce === command.nonce &&
        annotation.decisions[command.role]?.decision === 'changes-requested'
      ) {
        if (command.operation === 'reserve' && annotation.changeRequest?.note === command.note) return { view, intent: null };
        if (
          command.operation === 'finish' &&
          annotation.changeRequestId === command.intentId &&
          annotation.changeRequest?.commentId === command.receipt.commentId &&
          annotation.changeRequest?.submissionId === command.receipt.submissionId
        )
          return { view, intent: null };
      }
      if (annotation.state !== 'pending') throw new ConflictError('This sign-off request is terminal.', 'MKTG_SIGN_OFF_TERMINAL');
      const commentCapable = Object.hasOwn(MKTG_DOCUMENT_COMMENT_ROOTS, type.agentKey);
      if (!commentCapable && !MKTG_SIGN_OFF_NOTE_ONLY_AGENT_KEYS.has(type.agentKey))
        throw ServiceValidationError.forField('agentKey', 'This asset has no registered request-changes workflow.');
      const at = new Date().toISOString();
      if (command.operation === 'reserve') {
        if (typeof command.note !== 'string' || !command.note.trim() || command.note.length > MKTG_SIGN_OFF_NOTE_MAX_CHARS)
          throw ServiceValidationError.forField('note', 'A bounded nonblank note is required.');
        if (intent) {
          if (intent.role !== command.role || intent.nonce !== command.nonce || intent.note !== command.note)
            throw new ConflictError('Another change request owns this intent.', 'MKTG_SIGN_OFF_CHANGE_BUSY');
          return { view, intent: { ...intent } }; // Same actor/input recovery; mode may have changed since send.
        }
        const released = annotation.releasedChangeRequests ?? [];
        if (released.some((entry) => entry.role === command.role && entry.nonce === command.nonce))
          throw new ConflictError('This nonce was released; use an explicit new request.', 'MKTG_SIGN_OFF_REQUEST_RELEASED');
        if (released.length >= MKTG_SIGN_OFF_RELEASED_NONCE_LIMIT)
          throw new ConflictError('Change-request history is full; operator recovery is required.', 'MKTG_SIGN_OFF_RELEASE_HISTORY_FULL');
        if (annotation.decisions[command.role]) throw new ConflictError('This role already decided.', 'MKTG_SIGN_OFF_ALREADY_DECIDED');
        if ((await this.signOffSettings.modeOf(req, project)) !== 'two-role')
          throw new ConflictError('Two-role sign-off is switched off.', 'MKTG_SIGN_OFF_DISABLED');
        if (commentCapable)
          annotation.changeRequestIntent = { id: randomUUID(), role: command.role, nonce: command.nonce, startedAt: at, phase: 'prepared', note: command.note };
        else {
          annotation.state = 'changes-requested';
          annotation.changeRequestNonce = command.nonce;
          annotation.changeRequestId = randomUUID();
          annotation.decisions[command.role] = { at, by: annotation.roles[command.role], decision: 'changes-requested' };
          annotation.changeRequest = { commentId: null, submissionId: null, note: command.note };
        }
      } else {
        if (!intent || intent.id !== command.intentId || intent.role !== command.role || intent.nonce !== command.nonce)
          throw new ConflictError('The change-request intent changed.', 'MKTG_SIGN_OFF_INTENT_CHANGED');
        if (command.operation === 'start') {
          if (intent.phase !== 'prepared') throw new ConflictError('This intent already crossed the start barrier.', 'MKTG_SIGN_OFF_START_CLAIMED');
          if ((await this.signOffSettings.modeOf(req, project)) !== 'two-role')
            throw new ConflictError('Two-role sign-off is switched off.', 'MKTG_SIGN_OFF_DISABLED');
          intent.phase = 'starting';
        } else if (command.operation === 'finish') {
          const receipt = command.receipt;
          if (!commentCapable || !receipt || typeof receipt.commentId !== 'string' || !receipt.commentId.trim() || receipt.submissionId !== ids.requestId)
            throw ServiceValidationError.forField('receipt', 'A correlated accepted comment redraft is required.');
          annotation.state = 'changes-requested';
          annotation.changeRequestNonce = command.nonce;
          annotation.changeRequestId = intent.id;
          annotation.decisions[command.role] = { at, by: annotation.roles[command.role], decision: 'changes-requested' };
          annotation.changeRequest = { commentId: receipt.commentId, submissionId: receipt.submissionId, note: intent.note };
          delete annotation.changeRequestIntent;
        } else {
          if (
            !['unstarted', 'absent', 'failed', 'released'].includes(command.proof) ||
            ((command.proof === 'absent' || command.proof === 'unstarted') && intent.phase !== 'prepared')
          )
            throw new ConflictError('No definitive release proof exists.', 'MKTG_SIGN_OFF_RELEASE_UNSAFE');
          const released = annotation.releasedChangeRequests ?? [];
          if (released.length < MKTG_SIGN_OFF_RELEASED_NONCE_LIMIT)
            annotation.releasedChangeRequests = [...released, { role: command.role, nonce: command.nonce }];
          delete annotation.changeRequestIntent;
        }
      }
      const committed = await this.writeCurrent(
        req,
        project,
        type,
        documentId,
        snapshot,
        snapshot.record?.revisionId ?? revisionId,
        view.revisions.map((row) => row.id),
        false,
        true,
        { signOff }
      );
      if (!committed) {
        // Only a definitive start comparison loss is retryable; each pass reloads and rechecks the frozen intent.
        if (command.operation === 'start' && attempt + 1 < MKTG_DOCUMENT_WRITE_ATTEMPTS) continue;
        throw new PreconditionFailedError('The change-request intent changed. Reload and recover the same request.');
      }
      logger.info(req, 'mktg_sign_off_change', 'Committed change-request transition', { operation: command.operation });
      const updated = await this.signOffResult(req, view, committed);
      return updated ? { view: updated, intent: annotation.changeRequestIntent ? { ...annotation.changeRequestIntent } : null } : null;
    }
  }

  /** Result endpoints call before fetching/persisting any output. Absence only permits ordinary generations. */
  public async assertRedraftScope(req: Request, spec: MktgArtifactSpec, sessionId: string, projectUid?: string): Promise<MktgDocumentRedraftContext | null> {
    const context = await this.redrafts.forSession(req, sessionId);
    if (!context) return null;
    const project = await this.artifactService.resolveWritablePartition(req, spec, projectUid);
    this.redrafts.assertScope(context, project ?? undefined, spec.agentKey);
    return context;
  }

  /** Private history join from already-authorized immutable revision bytes, never a public descriptor DTO. */
  public async redraftForRevision(req: Request, view: MktgRevisionResponse): Promise<MktgDocumentRedraftContext | null> {
    const key = `${buildMktgDocumentPrefix(view.project, view.type.agentKey, view.documentId)}${view.revision.id}.json`;
    const parsed = parseMktgRevisionKey(key, buildMktgDocumentProjectPrefix(view.project));
    const stored = parsed ? await this.loadRevision(req, { ...parsed, key }, view.project) : null;
    if (!stored || stored.record.origin !== 'revised' || !stored.record.source.sessionId) return null;
    const context = await this.redrafts.forSession(req, stored.record.source.sessionId);
    if (!context) throw new MicroserviceError('The redraft history context is unavailable.', 503, 'MKTG_REDRAFT_CONTEXT_UNAVAILABLE');
    this.redrafts.assertScope(context, view.project, view.type.agentKey);
    if (context.documentId !== view.documentId) throw this.corruptDocument('Invalid redraft history context.');
    return context;
  }

  /** Plain and sidecar attachments consume approved current; only true pre-revision plain fallback remains. */
  public async readLatest(
    req: Request,
    spec: MktgArtifactSpec,
    project: string,
    options: { withSidecar?: boolean } = {}
  ): Promise<MktgArtifactStoredResponse | null> {
    const withSidecar = options.withSidecar === true;
    const type = findMktgDocumentType(spec.agentKey);
    if (!type || !MKTG_ARTIFACT_PARTITION_REGEX.test(project)) return withSidecar ? null : this.artifactService.readLatest(req, spec, project);
    try {
      const detail = await this.getDocument(req, project, type, MKTG_LIVING_DOCUMENT_ID);
      const summary = this.approvedCurrentOf(detail);
      if (!detail || !summary) {
        const legacy = detail?.revisions.length === 1 && parseMktgLegacyRevisionId(detail.revisions[0].id);
        return !withSidecar && legacy ? this.artifactService.readLatest(req, spec, project, { legacyOnly: true }) : null;
      }
      const revision = await this.loadApprovedRevision(req, detail, summary);
      const { bundle, source } = revision.record;
      const format = this.format(bundle.format);
      return {
        documentMarkdown: bundle.markdown,
        revisionNumber: summary.number,
        ...(withSidecar && { sidecar: this.envelopeSidecar(bundle.markdown, format, bundle.sidecar) }),
        format,
        storedAt: revision.record.createdAt,
        receipt: {
          s3_key: format === 'json' ? revision.key : buildMktgArtifactObjectKey(spec, project, bundle.contentSha256),
          content_sha256: bundle.contentSha256,
          project,
          version: source.draftVersion ?? MKTG_ARTIFACT_DEFAULT_DRAFT_VERSION,
          intake_mode: this.intakeMode(source.intakeMode),
        },
      };
    } catch (error) {
      logger.warning(req, 'mktg_document_store_read_latest', 'Approved current read failed — rethrowing for the caller', {
        project,
        agent: type.agentKey,
        err: error,
      });
      throw error;
    }
  }

  /** Update only the run's mutable presentation object, never its immutable revision. */
  public async saveLinkedinShareLink(
    req: Request,
    project: string,
    documentId: string,
    value: unknown,
    initialize = false
  ): Promise<LinkedinShareLinkResponse> {
    const type = findMktgDocumentType(LINKEDIN_AGENT_KEY);
    const detail = type ? await this.getDocument(req, project, type, documentId) : null;
    const summary = detail?.revisions[0];
    const stored = detail && summary ? await this.loadSummaryRevision(req, detail, summary) : null;
    const cards = stored ? readLinkedinDocumentContent(stored.record.bundle.sidecar) : null;
    if (!stored || !cards) throw new ResourceNotFoundError('LinkedIn document', documentId);
    // A late first supplied answer may seed an absent overlay, never replace supplied or edited answers.
    if (initialize && stored.record.bundle.sidecar && 'answers' in stored.record.bundle.sidecar) return { share_link: cards.answers['share_link'] };
    return this.linkedinPresentation.save(req, project, documentId, value, initialize);
  }

  /** A run's document id: stable per Guild session, so repeated result polls address one document. */
  public runDocumentId(sessionId: string): string {
    return buildMktgRunDocumentId(sessionId);
  }

  /** Export approved current only; stale explicit selectors fail instead of silently selecting different bytes. */
  public async readExportRevision(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    selector: { revisionId?: string; contentSha256?: string }
  ): Promise<{ revision: MktgStoredRevision; summary: MktgRevisionSummary } | null> {
    const detail = await this.getDocument(req, project, type, documentId);
    const summary = this.approvedCurrentOf(detail);
    if (!detail || !summary) throw new ConflictError(MKTG_ASSET_APPROVAL_REQUIRED_MESSAGE, 'MKTG_ASSET_NOT_APPROVED');
    if ((selector.revisionId && selector.revisionId !== summary.id) || (selector.contentSha256 && selector.contentSha256 !== summary.contentSha256)) {
      throw new ConflictError('The approved current changed. Reload and try again.', 'MKTG_APPROVED_CURRENT_CHANGED');
    }
    const revision = await this.loadApprovedRevision(req, detail, summary);
    return { revision, summary: { ...summary, status: this.recordStatus(revision.record) } };
  }

  /** Finish an already-started export against its exact integrity-checked revision, not today's approval. */
  public async readExportedRevision(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    revisionId: string
  ): Promise<MktgRevisionSummary | null> {
    const snapshot = await this.readCurrent(req, project, type, documentId);
    const detail = await this.readDocument(req, project, type, documentId, snapshot);
    return detail ? ((await this.readRevision(req, detail, revisionId))?.revision ?? null) : null;
  }

  private generationProvenanceKey(project: string, agentKey: MktgDocumentAgentKey, sessionId: string): string {
    return `${MKTG_GENERATION_PROVENANCE_KEY_PREFIX}/${project}/${agentKey}/${this.sha256(sessionId)}.json`;
  }

  private async generationFramework(req: Request, project: string, agentKey: MktgDocumentAgentKey, sessionId: string): Promise<MktgRevisionRef | null> {
    const saved = await this.objectStore.getObject(req, 'marketing-os-artifacts', this.generationProvenanceKey(project, agentKey, sessionId));
    if (!saved) return null; // Sessions from before provenance support remain unknown.
    try {
      const value: unknown = JSON.parse(saved.body);
      if (
        value &&
        typeof value === 'object' &&
        'framework' in value &&
        'project' in value &&
        value.project === project &&
        'agentKey' in value &&
        value.agentKey === agentKey
      ) {
        if (value.framework === null) return null;
        const framework = readMktgFrameworkRef(value.framework);
        if (framework) return framework;
      }
    } catch {
      /* Corrupt server capture must fail closed, not be guessed from today's approval. */
    }
    throw new MicroserviceError('The generation input record could not be read.', 502, 'MKTG_PROVENANCE_UNREADABLE');
  }

  /** The sole selection policy; public DTOs keep dependency/export consumers independent of storage. */
  private approvedCurrentOf(detail: MktgDocumentDetailResponse | null): MktgRevisionSummary | null {
    if (detail?.type.kind !== 'living' || !detail.approvedCurrent) return null;
    return detail.revisions.find((revision) => revision.id === detail.approvedCurrent?.revisionId && Boolean(revision.approval)) ?? null;
  }

  /** Adapt to versioning's integrity-checked body loader without another current-record read. */
  private async loadApprovedRevision(req: Request, detail: MktgDocumentDetailResponse, summary: MktgRevisionSummary): Promise<MktgStoredRevision> {
    const revision = await this.loadSummaryRevision(req, detail, summary);
    if (!revision) throw new MicroserviceError('The approved current revision could not be read.', 502, 'MKTG_APPROVED_REVISION_UNREADABLE');
    return revision;
  }

  private async loadSummaryRevision(req: Request, detail: MktgDocumentDetailResponse, summary: MktgRevisionSummary): Promise<MktgStoredRevision | null> {
    const key = `${buildMktgDocumentPrefix(detail.project, detail.type.agentKey, detail.documentId)}${summary.id}.json`;
    const parsed = parseMktgRevisionKey(key, buildMktgDocumentProjectPrefix(detail.project));
    return parsed ? this.loadRevision(req, { ...parsed, key }, detail.project) : null;
  }

  private envelopeSidecar(text: string, format: MktgRevisionFormat, sidecar: Record<string, unknown> | null): Record<string, unknown> | null {
    if (format !== 'json') return sidecar;
    try {
      const content: unknown = JSON.parse(text);
      if (content !== null && typeof content === 'object' && !Array.isArray(content)) return { ...(sidecar ?? {}), content };
    } catch {
      /* Preserve the stored sidecar when content cannot be decoded. */
    }
    return sidecar;
  }

  /** Build a detail using the caller's already-observed current pointer. */
  private async readDocument(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    snapshot: MktgDocumentCurrentSnapshot,
    readConcurrency = MKTG_DOCUMENT_READ_CONCURRENCY
  ): Promise<MktgDocumentDetailResponse | null> {
    let eligibleCount = 0;
    const entries = await this.listRevisions(req, project, type, documentId, snapshot, readConcurrency, true, () => {
      eligibleCount++;
    });
    if (entries.length) {
      const subjects = this.revisionAuthorSubjects(req, project, type, documentId);
      // Keep IDs request-private; defer all names to the final snapshot's shared attribution projection.
      const summaries = entries.map((entry, index) => {
        subjects.set(entry.id, entry.metadata?.['author-id'] ?? null);
        return this.summary(entry, index + 1);
      });
      const numberById = new Map(summaries.map((summary) => [summary.id, summary.number]));
      summaries.forEach((summary, index) => {
        summary.latest = summary.id === (snapshot.record?.revisionId ?? entries.at(-1)?.id);
        const metadata = entries[index].metadata ?? {};
        summary.basedOnNumber = numberById.get(entries[index].record?.basedOnId ?? metadata['based-on'] ?? '') ?? null;
        summary.restoredFromNumber = numberById.get(entries[index].record?.restoredFromId ?? metadata['restored-from'] ?? '') ?? null;
      });
      const detail: MktgDocumentDetailResponse = {
        project,
        type,
        documentId,
        revisions: summaries.reverse(),
        current: null,
        approvedCurrent: null,
      };
      return this.withApprovals(req, detail, snapshot.record, readConcurrency);
    }
    // Unreadable revision history must never serve an older pre-revision copy.
    if (snapshot.record) return null;
    if (eligibleCount > 0) {
      logger.warning(req, 'mktg_document_store_read_document', 'No stored revision could be read — serving no stored document', {
        project,
        agent: type.agentKey,
        documentId,
      });
      return null;
    }
    const legacy = documentId === MKTG_LIVING_DOCUMENT_ID ? await this.findLegacyDocument(req, type, project) : null;
    return legacy ? { project, type, documentId, revisions: [this.legacySummary(legacy)], current: null, approvedCurrent: null } : null;
  }

  /** Reuse the same current snapshot instead of resolving the document again. */
  private async readRevision(req: Request, detail: MktgDocumentDetailResponse, revisionId: string): Promise<MktgRevisionResponse | null> {
    const { project, type, documentId } = detail;
    const legacySha = parseMktgLegacyRevisionId(revisionId);
    const revision = detail.revisions.find(
      (entry) => entry.id === revisionId || (legacySha && entry.origin === 'legacy' && (!entry.contentSha256 || entry.contentSha256 === legacySha))
    );
    if (!revision) return null;
    if (parseMktgLegacyRevisionId(revision.id)) {
      const legacy = await this.readLegacyDocument(req, type, project);
      return legacy?.sha === parseMktgLegacyRevisionId(revision.id)
        ? { ...detail, revision: { ...revision, status: findMktgDocumentStatus(legacy.markdown) }, approval: null, markdown: legacy.markdown, sidecar: null }
        : null;
    }
    const key = `${buildMktgDocumentPrefix(project, type.agentKey, documentId)}${revision.id}.json`;
    const parsed = parseMktgRevisionKey(key, buildMktgDocumentProjectPrefix(project));
    const stored = parsed ? await this.loadRevision(req, { ...parsed, key }, project) : null;
    if (!stored || (legacySha && stored.record.bundle.contentSha256 !== legacySha)) return null;
    const selected = {
      ...revision,
      contentSha256: stored.record.bundle.contentSha256,
      draftVersion: stored.record.source.draftVersion,
      intakeMode: this.recordedIntakeMode(stored.record.source.intakeMode),
      restoredFromNumber: detail.revisions.find((entry) => entry.id === stored.record.restoredFromId)?.number ?? null,
      status: this.recordStatus(stored.record),
    };
    const cards = type.agentKey === LINKEDIN_AGENT_KEY ? readLinkedinDocumentContent(stored.record.bundle.sidecar) : null;
    const presentation = cards ? await this.linkedinPresentation.read(req, project, documentId, cards) : null;
    const linkedinPost = presentation
      ? { ...presentation, ...(stored.authorId && selected.author ? { author: selected.author, isAuthor: getEffectiveSub(req) === stored.authorId } : {}) }
      : null;
    return {
      ...detail,
      revision: selected,
      approval: selected.approval,
      markdown: stored.record.bundle.markdown,
      sidecar: stored.record.bundle.sidecar,
      ...(linkedinPost ? { linkedinPost } : {}),
    };
  }

  /** Capture the manifest and CAS token together; corrupt pointers must never select another revision. */
  private async readCurrent(req: Request, project: string, type: MktgDocumentType, documentId: string): Promise<MktgDocumentCurrentSnapshot> {
    const object = await this.objectStore.getObject(req, 'marketing-os-artifacts', this.currentKey(project, type, documentId));
    if (!object) return { record: null };
    if (!object.etag) throw this.corruptDocument('Current record has no conditional-write token');
    try {
      const record = JSON.parse(object.body) as MktgDocumentCurrentSnapshot['record'];
      if (!record || !Array.isArray(record.revisionIds) || !record.revisionIds.includes(record.revisionId)) {
        throw this.corruptDocument('Invalid current record');
      }
      return { record: { ...record, approvals: this.approvalsOf(record.approvals), signOff: this.signOffOf(record.signOff, type) }, etag: object.etag };
    } catch (error) {
      if (error instanceof MicroserviceError) throw error;
      throw this.corruptDocument('Current record is not valid JSON');
    }
  }

  /** Optional annotations must never make an otherwise valid current pointer unreadable. */
  private approvalsOf(value: unknown): Record<string, MktgDocumentApprovalAnnotation> {
    const approvals: Record<string, MktgDocumentApprovalAnnotation> = Object.create(null);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return approvals;
    for (const [id, entry] of Object.entries(value)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const annotation = entry as Record<string, unknown>;
      const { approvedAt, approvedBy } = annotation;
      if (typeof approvedAt !== 'string' || !Number.isFinite(Date.parse(approvedAt))) continue;
      if (approvedBy !== null && (typeof approvedBy !== 'string' || !approvedBy.trim())) continue;
      const source = annotation['signOff'] as Record<string, unknown> | null | undefined;
      const ed = this.signOffAttributionOf(source?.['ed']);
      const tocChair = this.signOffAttributionOf(source?.['tocChair']);
      approvals[id] = { approvedAt, approvedBy, ...(ed && tocChair ? { signOff: { ed, tocChair } } : {}) };
    }
    return approvals;
  }

  private signOffAttributionOf(value: unknown): MktgSignOffAttribution | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { at, by } = value as Record<string, unknown>;
    return typeof at === 'string' && Number.isFinite(Date.parse(at)) && (by === null || (typeof by === 'string' && !!by.trim())) ? { at, by } : null;
  }

  /** Unknown optional shapes are ignored; they never corrupt the otherwise valid pointer. */
  private signOffOf(value: unknown, type: MktgDocumentType): Record<string, MktgDocumentSignOffAnnotation> {
    const result: Record<string, MktgDocumentSignOffAnnotation> = Object.create(null);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    for (const [id, raw] of Object.entries(value)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const entry = raw as Partial<MktgDocumentSignOffAnnotation>;
      if (!this.signOffAttributionOf({ at: entry.requestedAt, by: entry.requestedBy })) continue;
      if (!entry.roles || typeof entry.roles !== 'object' || Array.isArray(entry.roles)) continue;
      const { ed, tocChair } = entry.roles;
      if ([ed, tocChair].some((subject) => subject !== null && (typeof subject !== 'string' || !subject.trim()))) continue;
      if (!entry.decisions || typeof entry.decisions !== 'object' || Array.isArray(entry.decisions)) continue;
      const decisions: MktgDocumentSignOffAnnotation['decisions'] = {};
      let valid = true;
      for (const role of ['ed', 'tocChair'] as const) {
        const decision = entry.decisions[role];
        if (decision === undefined) continue;
        const attribution = this.signOffAttributionOf(decision);
        if (!attribution || !attribution.by || attribution.by !== entry.roles[role] || !['approved', 'changes-requested'].includes(decision.decision)) {
          valid = false;
          break;
        }
        decisions[role] = { ...attribution, decision: decision.decision };
      }
      if (!valid) continue;
      const both = decisions.ed?.decision === 'approved' && decisions.tocChair?.decision === 'approved';
      const changes = Object.values(decisions).some((decision) => decision.decision === 'changes-requested');
      if (entry.state !== 'pending' && entry.state !== 'approved' && entry.state !== 'changes-requested') continue;
      if (entry.state === 'pending' && (both || changes)) continue;
      if (entry.state === 'approved' && !both) continue;
      if (entry.state === 'changes-requested' && !changes) continue;
      if (entry.state === 'approved' && (typeof entry.approvedAt !== 'string' || !Number.isFinite(Date.parse(entry.approvedAt)))) continue;
      const change = entry.changeRequest;
      const note = change?.note;
      const validNote = typeof note === 'string' && !!note.trim() && note.length <= MKTG_SIGN_OFF_NOTE_MAX_CHARS;
      const noteOnly =
        MKTG_SIGN_OFF_NOTE_ONLY_AGENT_KEYS.has(type.agentKey) &&
        !Object.hasOwn(MKTG_DOCUMENT_COMMENT_ROOTS, type.agentKey) &&
        change?.commentId === null &&
        change.submissionId === null &&
        validNote;
      if (
        entry.state === 'changes-requested' &&
        (!change ||
          (!noteOnly && (typeof change.commentId !== 'string' || !change.commentId.trim())) ||
          (change.submissionId !== null && (typeof change.submissionId !== 'string' || !change.submissionId.trim())))
      )
        continue;
      const released = entry.releasedChangeRequests;
      if (
        released !== undefined &&
        (!Array.isArray(released) ||
          released.length > MKTG_SIGN_OFF_RELEASED_NONCE_LIMIT ||
          released.some(
            (row) => !row || (row.role !== 'ed' && row.role !== 'tocChair') || typeof row.nonce !== 'string' || !MKTG_SIGN_OFF_NONCE_REGEX.test(row.nonce)
          ) ||
          new Set(released.map((row) => `${row.role}:${row.nonce}`)).size !== released.length)
      )
        continue;
      const intent = entry.changeRequestIntent;
      if (
        intent !== undefined &&
        (!intent ||
          typeof intent !== 'object' ||
          Array.isArray(intent) ||
          entry.state !== 'pending' ||
          !Object.hasOwn(MKTG_DOCUMENT_COMMENT_ROOTS, type.agentKey) ||
          !mktgSignOffRequestIds(id, intent.role, intent.nonce) ||
          typeof intent.id !== 'string' ||
          !MKTG_SIGN_OFF_UUID_REGEX.test(intent.id) ||
          typeof intent.startedAt !== 'string' ||
          !Number.isFinite(Date.parse(intent.startedAt)) ||
          !entry.roles[intent.role] ||
          decisions[intent.role] ||
          (intent.phase !== 'prepared' && intent.phase !== 'starting') ||
          typeof intent.note !== 'string' ||
          !intent.note.trim() ||
          intent.note.length > MKTG_SIGN_OFF_NOTE_MAX_CHARS)
      )
        continue;
      result[id] = {
        state: entry.state,
        requestedAt: entry.requestedAt as string,
        requestedBy: entry.requestedBy ?? null,
        roles: { ed, tocChair },
        decisions,
        ...(entry.state === 'approved' ? { approvedAt: entry.approvedAt } : {}),
        ...(entry.state === 'changes-requested' && change
          ? { changeRequest: { commentId: change.commentId, submissionId: change.submissionId, ...(validNote ? { note } : {}) } }
          : {}),
        ...(typeof entry.changeRequestNonce === 'string' && MKTG_SIGN_OFF_NONCE_REGEX.test(entry.changeRequestNonce)
          ? { changeRequestNonce: entry.changeRequestNonce }
          : {}),
        ...(typeof entry.changeRequestId === 'string' && MKTG_SIGN_OFF_UUID_REGEX.test(entry.changeRequestId)
          ? { changeRequestId: entry.changeRequestId }
          : {}),
        ...(intent
          ? {
              changeRequestIntent: {
                id: intent.id,
                role: intent.role,
                nonce: intent.nonce,
                phase: intent.phase,
                startedAt: intent.startedAt,
                note: intent.note,
              },
            }
          : {}),
        ...(released ? { releasedChangeRequests: released.map((row) => ({ role: row.role, nonce: row.nonce })) } : {}),
      };
    }
    return result;
  }

  /** Never attach opaque author IDs to DTOs; cloned transition summaries reuse this request/document scope. */
  private revisionAuthorSubjects(req: Request, project: string, type: MktgDocumentType, documentId: string): Map<string, string | null> {
    let documents = this.revisionSubjects.get(req);
    if (!documents) {
      documents = new Map();
      this.revisionSubjects.set(req, documents);
    }
    const key = buildMktgDocumentPrefix(project, type.agentKey, documentId);
    let subjects = documents.get(key);
    if (!subjects) {
      subjects = new Map();
      documents.set(key, subjects);
    }
    return subjects;
  }

  /** The single gate for EVERY attribution alias, including ordinary fields holding a frozen chair subject. */
  private async projectRecordAuthor(
    req: Request,
    subject: string | null | undefined,
    chairSubjects: ReadonlySet<string>,
    readChair: () => Promise<MktgProjectRole | null>
  ): Promise<MktgRevisionAuthor | null> {
    if (!subject) return null;
    if (chairSubjects.has(subject)) return this.visibleChairAuthor(await readChair(), subject);
    return this.authors.resolveAuthor(req, subject);
  }

  /** Roster visibility and the frozen identity must both match; never fall back to directory names. */
  private visibleChairAuthor(chair: MktgProjectRole | null, subject: string | null): MktgRevisionAuthor | null {
    if (!subject) return null;
    return { name: chair?.subject === subject ? chair.name : null };
  }

  private async resolveSignOffAttribution(
    attribution: MktgDocumentApprovalAnnotation['signOff'],
    resolveAuthor: (subject: string | null | undefined) => Promise<MktgRevisionAuthor | null>
  ): Promise<MktgRevisionApproval['signOff']> {
    if (!attribution) return undefined;
    return {
      ed: { at: attribution.ed.at, by: await resolveAuthor(attribution.ed.by) },
      tocChair: { at: attribution.tocChair.at, by: await resolveAuthor(attribution.tocChair.by) },
    };
  }

  /** One final-snapshot projection for every author alias; directory and roster lookups remain request-scoped. */
  private async withApprovals(
    req: Request,
    detail: MktgDocumentDetailResponse,
    record: MktgDocumentCurrentRecord | null,
    concurrency = MKTG_DOCUMENT_READ_CONCURRENCY
  ): Promise<MktgDocumentDetailResponse> {
    const approvals = detail.type.kind === 'living' ? this.approvalsOf(record?.approvals) : {};
    const signOff = detail.type.kind === 'living' ? this.signOffOf(record?.signOff, detail.type) : {};
    const chairSubjects = new Set<string>();
    for (const entry of Object.values(record?.signOff ?? {})) {
      if (entry.roles.tocChair) chairSubjects.add(entry.roles.tocChair);
    }
    for (const entry of Object.values(record?.approvals ?? {})) {
      if (entry.signOff?.tocChair.by) chairSubjects.add(entry.signOff.tocChair.by);
    }
    let chair: Promise<MktgProjectRole | null> | undefined;
    const readChair = () => {
      if (!chair) chair = this.projectRoles.rolesOf(req, detail.project).then((roles) => roles.tocChair);
      return chair;
    };
    const resolveAuthor = (subject: string | null | undefined) => this.projectRecordAuthor(req, subject, chairSubjects, readChair);
    const subjects = this.revisionAuthorSubjects(req, detail.project, detail.type, detail.documentId);
    const revisions: MktgRevisionSummary[] = [];
    for (let offset = 0; offset < detail.revisions.length; offset += concurrency) {
      revisions.push(
        ...(await Promise.all(
          detail.revisions.slice(offset, offset + concurrency).map(async (revision) => {
            const annotation = Object.hasOwn(approvals, revision.id) ? approvals[revision.id] : null;
            let approval: MktgRevisionApproval | null = null;
            if (annotation) {
              const attribution = await this.resolveSignOffAttribution(annotation.signOff, resolveAuthor);
              approval = { approvedAt: annotation.approvedAt, approvedBy: await resolveAuthor(annotation.approvedBy) };
              if (attribution) approval.signOff = attribution;
            }
            const request = Object.hasOwn(signOff, revision.id) ? signOff[revision.id] : null;
            const names = request
              ? {
                  state: request.state,
                  requestedAt: request.requestedAt,
                  requestedBy: await resolveAuthor(request.requestedBy),
                  ...(request.changeRequestIntent
                    ? { changeRequestIntent: { role: request.changeRequestIntent.role, startedAt: request.changeRequestIntent.startedAt } }
                    : {}),
                  ...(request.changeRequest?.commentId === null && request.changeRequest.note ? { note: request.changeRequest.note } : {}),
                  roles: {
                    ed: { name: (await resolveAuthor(request.roles.ed))?.name ?? null, decision: request.decisions.ed?.decision },
                    tocChair: {
                      name: (await resolveAuthor(request.roles.tocChair))?.name ?? null,
                      decision: request.decisions.tocChair?.decision,
                    },
                  },
                }
              : null;
            return { ...revision, author: await resolveAuthor(subjects.get(revision.id)), approval, ...(request ? { signOff: names } : {}) };
          })
        ))
      );
    }
    const current = revisions.find((revision) => revision.latest && revision.approval);
    return {
      ...detail,
      current: await this.currentSelection(record, resolveAuthor),
      revisions,
      approvedCurrent: current ? { revisionId: current.id, number: current.number } : null,
    };
  }

  /** Publish the full manifest via CAS, optionally preserving the caller's observed selection and attribution. */
  private async writeCurrent(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    snapshot: MktgDocumentCurrentSnapshot,
    revisionId: string,
    revisionIds: string[],
    approve = false,
    keepSelection = false,
    signOffWrite?: MktgSignOffWrite
  ): Promise<MktgDocumentCurrentRecord | null> {
    const existingIds = snapshot.record
      ? snapshot.record.revisionIds
      : (await this.listRevisions(req, project, type, documentId, snapshot, MKTG_DOCUMENT_READ_CONCURRENCY, false)).map((entry) => entry.id);
    const committedIds = [...new Set([...existingIds, ...revisionIds])];
    const approvals = this.approvalsOf(snapshot.record?.approvals);
    const kept = keepSelection ? snapshot.record : null;
    const changedAt = kept ? kept.changedAt : new Date().toISOString();
    const changedBy = kept ? kept.changedBy : this.author(req);
    const signOff = signOffWrite?.signOff ?? this.signOffOf(snapshot.record?.signOff, type);
    if (approve && !approvals[revisionId])
      approvals[revisionId] = {
        approvedAt: signOff[revisionId]?.approvedAt ?? changedAt,
        approvedBy: changedBy,
        ...(signOffWrite?.approval ? { signOff: signOffWrite.approval } : {}),
      };
    const record: MktgDocumentCurrentRecord = {
      revisionId: kept ? kept.revisionId : revisionId,
      revisionIds: committedIds,
      changedAt,
      changedBy,
      ...(Object.keys(approvals).length ? { approvals } : {}),
      ...(Object.keys(signOff).length ? { signOff } : {}),
    };
    const written = await this.objectStore.putConditionalObject(req, 'marketing-os-artifacts', this.currentKey(project, type, documentId), {
      body: Buffer.from(JSON.stringify(record)),
      contentType: MKTG_REVISION_CONTENT_TYPE,
      cacheControl: 'private',
      ...(snapshot.etag ? { ifMatch: snapshot.etag } : { ifNoneMatch: '*' as const }),
    });
    return written ? record : null;
  }

  /** Resolve selection attribution without leaking the stored subject or revision manifest. */
  private async currentSelection(
    record: MktgDocumentCurrentRecord | null,
    resolveAuthor: (subject: string | null | undefined) => Promise<MktgRevisionAuthor | null>
  ): Promise<MktgDocumentCurrentSelection | null> {
    if (!record) return null;
    return { revisionId: record.revisionId, changedAt: record.changedAt, changedBy: await resolveAuthor(record.changedBy) };
  }

  private currentKey(project: string, type: MktgDocumentType, documentId: string): string {
    return `${buildMktgDocumentPrefix(project, type.agentKey, documentId)}${MKTG_DOCUMENT_CURRENT_KEY}`;
  }

  /**
   * List eligible keys with bounded HEADs; hydrate historical bodies for readable summaries by default.
   * First-publication manifests disable hydration so an unreadable historical object cannot erase its ID.
   */
  private async listRevisions(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    snapshot: MktgDocumentCurrentSnapshot,
    readConcurrency = MKTG_DOCUMENT_READ_CONCURRENCY,
    loadHistoricalBodies = true,
    onEligibleKey?: () => void
  ): Promise<MktgListedRevision[]> {
    const prefix = buildMktgDocumentProjectPrefix(project);
    const objects = await this.objectStore.listObjects(req, 'marketing-os-artifacts', buildMktgDocumentPrefix(project, type.agentKey, documentId));
    const listed: MktgListedRevision[] = [];
    for (let offset = 0; offset < objects.length; offset += readConcurrency) {
      const batch = await Promise.all(
        objects.slice(offset, offset + readConcurrency).map(async (object): Promise<MktgListedRevision | null> => {
          const parsed = parseMktgRevisionKey(object.key, prefix);
          if (!parsed || parsed.agentKey !== type.agentKey || parsed.documentId !== documentId) return null;
          if (snapshot.record && !snapshot.record.revisionIds.includes(parsed.id)) return null;
          const metadata = await this.objectStore.headObject(req, 'marketing-os-artifacts', object.key);
          if (!metadata || (!snapshot.record && metadata['managed'] === 'true')) return null;
          onEligibleKey?.();
          const entry = { ...parsed, ...object, metadata };
          if (loadHistoricalBodies && (!metadata['content-sha'] || (metadata['origin'] === 'revised' && metadata['comment-count'] === undefined))) {
            const stored = await this.loadRevision(req, entry, project);
            return stored ? { ...entry, record: stored.record } : null;
          }
          return entry;
        })
      );
      listed.push(...batch.filter((entry): entry is MktgListedRevision => entry !== null));
    }
    return listed.sort((a, b) => a.sequence - b.sequence || (a.lastModified?.getTime() ?? 0) - (b.lastModified?.getTime() ?? 0) || a.id.localeCompare(b.id));
  }

  private async loadRevision(req: Request, entry: MktgListedRevision, project: string): Promise<MktgStoredRevision | null> {
    const object = await this.objectStore.getObject(req, 'marketing-os-artifacts', entry.key);
    if (!object) return null;
    try {
      const record = JSON.parse(object.body) as MktgRevisionRecord;
      if (
        this.sha256(object.body) !== entry.sha ||
        record.schema !== MKTG_REVISION_SCHEMA ||
        record.project !== project ||
        record.agentKey !== entry.agentKey ||
        record.documentId !== entry.documentId ||
        record.sequence !== entry.sequence ||
        typeof record.bundle?.markdown !== 'string' ||
        this.sha256(record.bundle.markdown) !== record.bundle.contentSha256 ||
        !record.source
      ) {
        logger.warning(req, 'mktg_document_store_read', 'Stored revision bytes do not match the content-addressed key or schema — skipping', {
          key: entry.key,
          err: this.corruptDocument('Revision integrity check failed'),
        });
        return null;
      }
      return { id: entry.id, key: entry.key, record, ...(object.metadata['author-id'] ? { authorId: object.metadata['author-id'] } : {}) };
    } catch (error) {
      logger.warning(req, 'mktg_document_store_read', 'Stored revision bytes do not match the content-addressed key or schema — skipping', {
        key: entry.key,
        err: error,
      });
      return null;
    }
  }

  /** Create immutable bytes if absent; a repeated identical PUT is an idempotent success. */
  private async writeRevision(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    sequence: number,
    fields: MktgRevisionRecordFields,
    generation?: string,
    redraftMetadata?: MktgRedraftRevisionMetadata
  ): Promise<MktgStoredRevision> {
    const record: MktgRevisionRecord = {
      schema: MKTG_REVISION_SCHEMA,
      project,
      agentKey: type.agentKey,
      documentId,
      sequence,
      comments: [],
      deck: { spec: null, link: null },
      ...fields,
    };
    const body = JSON.stringify(record);
    const hash = this.sha256(body);
    const key = buildMktgRevisionKey(project, type.agentKey, documentId, sequence, hash);
    let authorId = record.origin === 'legacy' ? null : this.author(req);
    if ((record.origin === 'generated' || record.origin === 'revised') && this.generationAttribution) {
      authorId = this.generationAttribution.creatorSubject;
    }
    const status = this.recordStatus(record);
    const boundedStatus = status.length > MKTG_REVISION_STATUS_METADATA_MAX_CHARS ? `${status.slice(0, MKTG_REVISION_STATUS_METADATA_MAX_CHARS - 1)}…` : status;
    const metadata: Record<string, string> = {
      managed: 'true',
      origin: record.origin,
      'content-sha': record.bundle.contentSha256,
      'created-at': record.createdAt,
      'intake-mode': record.source.intakeMode,
      'draft-version': String(record.source.draftVersion),
      format: this.format(record.bundle.format),
      status: Buffer.from(boundedStatus).toString('base64'),
      'comment-count': String(redraftMetadata?.commentCount ?? record.comments.length),
      ...(redraftMetadata && { 'redraft-run-id': redraftMetadata.redraftRunId }),
      'based-on': record.basedOnId ?? '',
      'restored-from': record.restoredFromId ?? '',
      [MKTG_REBUILD_UPSTREAM_METADATA_KEY]: JSON.stringify(readMktgFrameworkRef(record.bundle.sidecar?.[MKTG_REBUILD_UPSTREAM_SIDECAR_KEY])),
      ...(authorId && { 'author-id': authorId }),
      ...(generation && { generation }),
    };
    const written = await this.objectStore.putConditionalObject(req, 'marketing-os-artifacts', key, {
      body: Buffer.from(body),
      contentType: MKTG_REVISION_CONTENT_TYPE,
      cacheControl: 'private',
      metadata,
      ifNoneMatch: '*',
    });
    if (!written) {
      const existing = await this.objectStore.getObject(req, 'marketing-os-artifacts', key);
      if (existing?.body !== body) throw new PreconditionFailedError('Revision write is in flight. Try again.');
    }
    return { id: buildMktgRevisionId(sequence, hash), key, record };
  }

  private summary(entry: MktgListedRevision, number: number): MktgRevisionSummary {
    const metadata = entry.metadata ?? {};
    return {
      id: entry.id,
      number,
      createdAt: entry.record?.createdAt ?? metadata['created-at'] ?? entry.lastModified?.toISOString() ?? null,
      origin: entry.record?.origin ?? ((metadata['origin'] ?? 'generated') as MktgRevisionSummary['origin']),
      restoredFromNumber: null,
      intakeMode: this.recordedIntakeMode(entry.record?.source.intakeMode ?? metadata['intake-mode']),
      status: entry.record ? this.recordStatus(entry.record) : Buffer.from(metadata['status'] ?? '', 'base64').toString('utf8'),
      contentSha256: entry.record?.bundle.contentSha256 ?? metadata['content-sha'] ?? '',
      format: this.format(entry.record?.bundle.format ?? metadata['format']),
      commentCount: this.commentCount(entry.record, metadata),
      upstreamFramework: this.summaryFramework(entry),
      draftVersion: entry.record?.source.draftVersion ?? (Number(metadata['draft-version']) || undefined),
      latest: false,
      approval: null,
      basedOnNumber: null,
    };
  }

  /** New summaries use one bounded HEAD field. Old records remain unknown without extra body reads. */
  private summaryFramework(entry: MktgListedRevision): MktgRevisionRef | null {
    if (entry.record) return readMktgFrameworkRef(entry.record.bundle.sidecar?.[MKTG_REBUILD_UPSTREAM_SIDECAR_KEY]);
    try {
      return readMktgFrameworkRef(JSON.parse(entry.metadata?.[MKTG_REBUILD_UPSTREAM_METADATA_KEY] ?? 'null'));
    } catch {
      return null;
    }
  }

  private legacySummary(legacy: MktgLegacyDocument): MktgRevisionSummary {
    return {
      id: buildMktgLegacyRevisionId(legacy.sha),
      number: 1,
      createdAt: legacy.storedAt,
      origin: 'legacy',
      restoredFromNumber: null,
      intakeMode: legacy.intakeMode,
      status: findMktgDocumentStatus(legacy.markdown),
      contentSha256: legacy.sha,
      format: 'markdown',
      commentCount: 0,
      latest: true,
      approval: null,
      draftVersion: legacy.draftVersion,
    };
  }

  /** Enumerate eligible legacy artifacts newest first, excluding this generation's own compatibility write. */
  private async *legacyCandidates(req: Request, type: MktgDocumentType, project: string, excludeSha?: string): AsyncGenerator<MktgLegacyDocument> {
    if (!type.legacyArtifactKey) return;
    const prefix = buildMktgArtifactPartitionPrefix(MKTG_ARTIFACT_SPECS[type.legacyArtifactKey], project);
    const objects = await this.objectStore.listObjects(req, 'marketing-os-artifacts', prefix);
    objects.sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0));
    for (const candidate of objects) {
      const hash = extractMktgArtifactKeySha(candidate.key, prefix);
      if (!hash || hash === excludeSha) continue;
      const metadata = await this.objectStore.headObject(req, 'marketing-os-artifacts', candidate.key);
      if (!metadata || metadata['revision-managed'] === 'true') continue;
      const version = Number(metadata['version']);
      yield {
        sha: hash,
        key: candidate.key,
        markdown: '',
        storedAt: candidate.lastModified?.toISOString() ?? null,
        draftVersion: Number.isInteger(version) && version >= 1 ? version : MKTG_ARTIFACT_DEFAULT_DRAFT_VERSION,
        intakeMode: this.intakeMode(metadata['intake-mode']),
      };
    }
  }

  /** Metadata-only legacy navigation stops at the newest eligible artifact. */
  private async findLegacyDocument(req: Request, type: MktgDocumentType, project: string): Promise<MktgLegacyDocument | null> {
    for await (const candidate of this.legacyCandidates(req, type, project)) return candidate;
    return null;
  }

  /** A missing or corrupt legacy candidate falls back to the next; storage failures still throw. */
  private async readLegacyDocument(req: Request, type: MktgDocumentType, project: string, excludeSha?: string): Promise<MktgLegacyDocument | null> {
    for await (const candidate of this.legacyCandidates(req, type, project, excludeSha)) {
      const object = await this.objectStore.getObject(req, 'marketing-os-artifacts', candidate.key);
      if (object && this.sha256(object.body) === candidate.sha) return { ...candidate, markdown: object.body };
      logger.warning(req, 'mktg_document_store_legacy', 'Legacy artifact missing or corrupt — skipping', { project, key: candidate.key });
    }
    return null;
  }

  private markdownSource(envelope: MktgArtifactEnvelope): MktgRevisionContentSource {
    const { document_markdown: markdown, ...sidecar } = envelope as MktgArtifactEnvelope & Record<string, unknown>;
    return { text: markdown, contentSha256: envelope.content_sha256, format: 'markdown', sidecar, version: envelope.version, intakeMode: envelope.intake.mode };
  }

  private jsonSource<T extends object>(envelope: MktgArtifactJsonEnvelope<T>): MktgRevisionContentSource {
    const { content, ...sidecar } = envelope as MktgArtifactJsonEnvelope<T> & Record<string, unknown>;
    return {
      text: JSON.stringify(content),
      contentSha256: envelope.content_sha256,
      format: 'json',
      sidecar,
      version: envelope.version,
      intakeMode: envelope.intake.mode,
    };
  }

  private assertRedraftSource(context: MktgDocumentRedraftContext | null, project: string | undefined, agentKey: string, evidence: unknown): void {
    if (context) {
      this.redrafts.assertScope(context, project, agentKey);
      if (!validateMktgRedraftResult(context, evidence).valid)
        throw ServiceValidationError.forField('redraft', 'The result does not match its frozen redraft input.');
    } else if (
      evidence &&
      typeof evidence === 'object' &&
      'mode' in evidence &&
      evidence.mode === 'redraft' &&
      Object.hasOwn(MKTG_DOCUMENT_COMMENT_LIMITS, agentKey)
    ) {
      throw new MicroserviceError('The redraft contract context is not available.', 503, 'MKTG_REDRAFT_CONTEXT_UNAVAILABLE');
    }
  }

  /** Optional metadata can be recovered from the validated agent sidecar without inventing hashed host fields. */
  private commentCount(record: MktgRevisionRecord | undefined, metadata: Record<string, string>): number {
    const count = Number(metadata['comment-count']);
    if (metadata['comment-count'] !== undefined && Number.isSafeInteger(count) && count >= 0) return count;
    const revision = record?.bundle.sidecar?.['revision'];
    if (record?.origin === 'revised' && revision && typeof revision === 'object' && 'comments' in revision && Array.isArray(revision.comments))
      return revision.comments.length;
    return record?.comments?.length ?? 0;
  }

  /** Structured assets have no Markdown review-status line. */
  private recordStatus(record: MktgRevisionRecord): string {
    return record.bundle.format === 'json' ? '' : findMktgDocumentStatus(record.bundle.markdown);
  }

  private format(value: unknown): MktgRevisionFormat {
    return value === 'json' ? 'json' : 'markdown';
  }

  private corruptDocument(message: string): MicroserviceError {
    return new MicroserviceError(message, 500, 'MKTG_DOCUMENT_CORRUPT', { service: 'mktg_document_store' });
  }

  /** Preserve absent/invalid historical intake metadata as unknown when displaying revisions. */
  private recordedIntakeMode(value: unknown): MktgArtifactIntakeMode | null {
    return MKTG_ARTIFACT_INTAKE_MODES.includes(value as MktgArtifactIntakeMode) ? (value as MktgArtifactIntakeMode) : null;
  }

  /** Supply the legacy artifact receipt's required default when intake metadata is unknown. */
  private intakeMode(value: unknown): MktgArtifactIntakeMode {
    return this.recordedIntakeMode(value) ?? 'form';
  }

  private author(req: Request): string | null {
    return this.authors.captureAuthorId(req);
  }

  /** Same-snapshot public projection; never expose the internal intent input/UUID/nonce. */
  private async signOffResult(req: Request, view: MktgRevisionResponse, committed: MktgDocumentCurrentRecord): Promise<MktgRevisionResponse | null> {
    const updated = await this.withApprovals(
      req,
      {
        ...view,
        current: null, // withApprovals owns the final-snapshot attribution projection, including current.
        revisions: view.revisions.map((entry) => ({ ...entry, latest: entry.id === committed.revisionId })),
      },
      committed
    );
    const revision = updated.revisions.find((entry) => entry.id === view.revision.id);
    return revision ? { ...view, ...updated, revision, approval: revision.approval } : null;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
