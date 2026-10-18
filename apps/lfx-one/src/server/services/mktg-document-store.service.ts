// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MKTG_ARTIFACT_DEFAULT_DRAFT_VERSION,
  MKTG_ARTIFACT_INTAKE_MODES,
  MKTG_ARTIFACT_PARTITION_REGEX,
  MKTG_ARTIFACT_SPECS,
  MKTG_DOCUMENT_CURRENT_KEY,
  MKTG_DOCUMENT_READ_CONCURRENCY,
  MKTG_DOCUMENT_TYPES,
  MKTG_DOCUMENT_WRITE_ATTEMPTS,
  MKTG_LIVING_DOCUMENT_ID,
  MKTG_REVISION_CONTENT_TYPE,
  MKTG_REVISION_SCHEMA,
  MKTG_RUN_DOCUMENT_ID_PREFIX,
} from '@lfx-one/shared/constants';
import {
  MktgArtifactEnvelope,
  MktgArtifactIntakeMode,
  MktgArtifactJsonEnvelope,
  MktgArtifactPersistReceipt,
  MktgArtifactSpec,
  MktgArtifactStoredResponse,
  MktgDocumentAgentKey,
  MktgDocumentCurrentRecord,
  MktgDocumentCurrentSelection,
  MktgDocumentCurrentSnapshot,
  MktgDocumentDetailResponse,
  MktgDocumentGroup,
  MktgDocumentsResponse,
  MktgDocumentType,
  MktgLegacyDocument,
  MktgListedRevision,
  MktgRevisionAuthor,
  MktgRevisionContentSource,
  MktgRevisionFormat,
  MktgRevisionRecord,
  MktgRevisionRecordFields,
  MktgRevisionResponse,
  MktgRevisionSummary,
  MktgRunPersistReceipt,
  MktgStoredRevision,
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
} from '@lfx-one/shared/utils';
import { Request } from 'express';
import { createHash } from 'node:crypto';

import { AuthenticationError, MicroserviceError, PreconditionFailedError, ServiceValidationError } from '../errors';
import { getEffectiveSub } from '../utils/auth-helper';
import { logger } from './logger.service';
import { MktgArtifactService } from './mktg-artifact.service';
import { ObjectStoreService } from './object-store.service';
import { UserService } from './user.service';

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
  private readonly artifactService = new MktgArtifactService();
  private readonly authors = new WeakMap<Request, Map<string, Promise<MktgRevisionAuthor>>>();
  private userService?: UserService;

  /** Persist the compatibility artifact, then publish its revision before returning a receipt. */
  public async persistGeneration(
    req: Request,
    spec: MktgArtifactSpec,
    envelope: MktgArtifactEnvelope,
    projectUid: string | undefined,
    sessionId: string
  ): Promise<MktgArtifactPersistReceipt | null> {
    const receipt = await this.artifactService.persist(req, spec, envelope, projectUid, { revisionManaged: true });
    return receipt ? this.recordPersisted(req, spec.agentKey, receipt, envelope, sessionId) : null;
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
      await this.recordGeneration(req, type, receipt.project, envelope, sessionId);
      return receipt;
    } catch (error) {
      logger.warning(req, 'mktg_document_store_record', 'Revision write failed — returning the document without a receipt; retried on next poll', {
        agent: type.agentKey,
        project: receipt.project,
        err: error,
      });
      return null;
    }
  }

  /** One shared append path for runs now and the future comment-and-revise writer. */
  public async recordGeneration(
    req: Request,
    type: MktgDocumentType,
    project: string,
    envelope: MktgArtifactEnvelope | MktgRevisionContentSource,
    sessionId: string
  ): Promise<MktgStoredRevision> {
    const documentId = type.kind === 'run' ? `${MKTG_RUN_DOCUMENT_ID_PREFIX}${this.sha256(sessionId).slice(0, 24)}` : MKTG_LIVING_DOCUMENT_ID;
    const source = 'document_markdown' in envelope ? this.markdownSource(envelope) : envelope;
    return this.recordRevision(
      req,
      project,
      type,
      documentId,
      {
        createdAt: new Date().toISOString(),
        origin: 'generated',
        restoredFromId: null,
        source: { sessionId, draftVersion: source.version, intakeMode: source.intakeMode },
        bundle: { markdown: source.text, contentSha256: source.contentSha256, format: source.format, sidecar: source.sidecar, brandFile: null },
      },
      this.sha256(type.kind === 'run' ? sessionId : `${sessionId}:${source.contentSha256}`)
    );
  }

  /**
   * A CAS publishes a revision and moves current together. Losing writers retry
   * against the committed listing; overlapping polls find the winner's token.
   * An explicitly supplied basedOnId survives a retry (the writer's actual base).
   * Pre-revision documents become revision 1; same-generation polls are no-ops
   * under If-None-Match.
   */
  public async recordRevision(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    fields: MktgRevisionRecordFields,
    generation?: string
  ): Promise<MktgStoredRevision> {
    let basedOnId = fields.basedOnId;
    for (let attempt = 0; attempt < MKTG_DOCUMENT_WRITE_ATTEMPTS; attempt++) {
      const snapshot = await this.readCurrent(req, project, type, documentId);
      const entries = await this.listRevisions(req, project, type, documentId, snapshot);
      const existing = type.kind === 'run' ? entries[0] : entries.find((entry) => generation && entry.metadata?.['generation'] === generation);
      if (existing) {
        const stored = await this.loadRevision(req, existing, project);
        if (!stored) throw this.corruptDocument('Committed revision is unreadable');
        return stored;
      }
      if (entries.length === 0 && type.kind === 'living') {
        const legacy = await this.readLegacyDocument(req, type, project);
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
      if (basedOnId === undefined) basedOnId = snapshot.record?.revisionId ?? entries.at(-1)?.id ?? null;
      if (basedOnId && !entries.some((entry) => entry.id === basedOnId)) {
        throw ServiceValidationError.forField('basedOnId', 'The base revision does not belong to this document.');
      }
      const next = entries.reduce((maximum, entry) => Math.max(maximum, entry.sequence), 0) + 1;
      const revision = await this.writeRevision(req, project, type, documentId, next, { ...fields, basedOnId }, generation);
      if (await this.writeCurrent(req, project, type, documentId, snapshot, revision.id, [...entries.map((entry) => entry.id), revision.id])) {
        logger.info(req, 'mktg_document_store_record', 'Committed a new document revision', { project, agent: type.agentKey, revision: revision.id });
        return revision;
      }
    }
    throw new PreconditionFailedError('The document changed while saving. Try again.');
  }

  /** Navigation uses metadata, with bounded body fallback for historical writers. */
  public async listDocuments(req: Request, project: string): Promise<MktgDocumentsResponse> {
    const prefix = buildMktgDocumentProjectPrefix(project);
    const listed = await this.objectStore.listObjects(req, 'marketing-os-artifacts', prefix);
    const groups: MktgDocumentGroup[] = [];
    for (const type of MKTG_DOCUMENT_TYPES) {
      const ids = new Set(
        listed.flatMap((object) => {
          const entry = parseMktgRevisionKey(object.key, prefix);
          if (!entry || entry.agentKey !== type.agentKey) return [];
          return [entry.documentId];
        })
      );
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
              if (!(err instanceof MicroserviceError) || err.statusCode < 500) throw err;
              logger.warning(req, 'mktg_document_store_list', 'Document unreadable — omitting', { project, documentId: id, err });
              return null;
            })
          )
        );
        for (const detail of details) {
          if (!detail) continue;
          const current = detail.revisions.find((revision) => revision.latest);
          if (!current) {
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
            currentRevisionNumber: current.number,
            updatedAt: current.createdAt,
            createdAt: detail.revisions.at(-1)?.createdAt ?? null,
          });
        }
      }
      documents.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      groups.push({ type, documents });
    }
    return { project, groups };
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
    return this.readDocument(req, project, type, documentId, snapshot, readConcurrency);
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
    return detail ? this.readRevision(req, detail, revisionId) : null;
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
    let current = await this.currentSelection(req, snapshot.record);
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
      current = await this.currentSelection(req, committed);
    }
    const revisions = view.revisions.map((entry) => ({ ...entry, latest: entry.id === view.revision.id }));
    return { detail: { project, type, documentId, revisions, current }, revision: { ...view.revision, latest: true } };
  }

  /** Dependent agents consume current, never a newer but noncurrent revision. */
  public async readLatest(req: Request, spec: MktgArtifactSpec, project: string, options: { withSidecar?: boolean } = {}): Promise<MktgArtifactStoredResponse | null> {
    const withSidecar = options.withSidecar === true;
    const type = findMktgDocumentType(spec.agentKey);
    if (!type || !MKTG_ARTIFACT_PARTITION_REGEX.test(project)) return withSidecar ? null : this.artifactService.readLatest(req, spec, project);
    try {
      const detail = withSidecar
        ? await this.readDocument(req, project, type, MKTG_LIVING_DOCUMENT_ID, await this.readCurrent(req, project, type, MKTG_LIVING_DOCUMENT_ID), MKTG_DOCUMENT_READ_CONCURRENCY, false)
        : await this.getDocument(req, project, type, MKTG_LIVING_DOCUMENT_ID);
      const summary = detail?.revisions.find((revision) => revision.latest);
      if (!detail || !summary) return null;
      const view = await this.readRevision(req, detail, summary.id);
      if (!view) return null;
      return {
        documentMarkdown: view.markdown,
        ...(withSidecar && { revisionNumber: view.revision.number, sidecar: this.envelopeSidecar(view.markdown, view.revision.format, view.sidecar) }),
        format: view.revision.format,
        storedAt: view.revision.createdAt ?? undefined,
        receipt: {
          s3_key: view.revision.format === 'json'
            ? `${buildMktgDocumentPrefix(project, type.agentKey, MKTG_LIVING_DOCUMENT_ID)}${view.revision.id}.json`
            : buildMktgArtifactObjectKey(spec, project, view.revision.contentSha256),
          content_sha256: view.revision.contentSha256,
          project,
          version: view.revision.draftVersion ?? MKTG_ARTIFACT_DEFAULT_DRAFT_VERSION,
          intake_mode: view.revision.intakeMode ?? 'form',
        },
      };
    } catch (error) {
      if (withSidecar) {
        logger.warning(req, 'mktg_document_store_read_latest', 'Current revision read failed — rethrowing for the caller to handle', { project, agent: type.agentKey, err: error });
        throw error;
      }
      logger.warning(req, 'mktg_document_store_read_latest', 'Current document could not be read — serving no stored document', { project, agent: type.agentKey, err: error });
      return null;
    }
  }

  /** Export selectors retain their public shape, loading a matching stored body; default is current. */
  public async readExportRevision(req: Request, project: string, type: MktgDocumentType, documentId: string,
    selector: { revisionId?: string; contentSha256?: string }): Promise<{ revision: MktgStoredRevision; summary: MktgRevisionSummary } | null> {
    const detail = await this.readDocument(req, project, type, documentId, await this.readCurrent(req, project, type, documentId), MKTG_DOCUMENT_READ_CONCURRENCY, false);
    if (!detail) return null;
    const legacySha = selector.revisionId ? parseMktgLegacyRevisionId(selector.revisionId) : null;
    let candidates = detail.revisions;
    if (selector.revisionId) candidates = candidates.filter((entry) => entry.id === selector.revisionId || (legacySha && entry.origin === 'legacy' && entry.contentSha256 === legacySha));
    else if (selector.contentSha256) candidates = candidates.filter((entry) => entry.contentSha256 === selector.contentSha256);
    else candidates = candidates.filter((entry) => entry.latest);
    for (const summary of candidates) {
      const revision = await this.loadSummaryRevision(req, detail, summary);
      if (revision) return { revision, summary: { ...summary, status: this.recordStatus(revision.record) } };
    }
    return null;
  }

  /** Explicit newest-identity lookup for export comparison; never returns a pre-revision artifact. */
  public async readNewestRevisionRef(req: Request, project: string, type: MktgDocumentType, documentId: string): Promise<{ id: string; number: number; contentSha256: string } | null> {
    const detail = await this.readDocument(req, project, type, documentId, await this.readCurrent(req, project, type, documentId), MKTG_DOCUMENT_READ_CONCURRENCY, false);
    if (!detail) return null;
    for (const summary of detail.revisions) {
      const revision = await this.loadSummaryRevision(req, detail, summary);
      if (revision) return { id: revision.id, number: summary.number, contentSha256: revision.record.bundle.contentSha256 };
    }
    return null;
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
    } catch { /* Preserve the stored sidecar when content cannot be decoded. */ }
    return sidecar;
  }

  /** Build a detail using the caller's already-observed current pointer. */
  private async readDocument(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    snapshot: MktgDocumentCurrentSnapshot,
    readConcurrency = MKTG_DOCUMENT_READ_CONCURRENCY,
    allowLegacy = true
  ): Promise<MktgDocumentDetailResponse | null> {
    const entries = await this.listRevisions(req, project, type, documentId, snapshot, readConcurrency);
    if (entries.length) {
      const summaries: MktgRevisionSummary[] = [];
      // Directory lookups share the metadata/body read bound, including serial project listings.
      for (let offset = 0; offset < entries.length; offset += readConcurrency) {
        summaries.push(
          ...(await Promise.all(
            entries.slice(offset, offset + readConcurrency).map(async (entry, index) => ({
              ...this.summary(entry, offset + index + 1),
              author: await this.resolveAuthor(req, entry.metadata?.['author-id']),
            }))
          ))
        );
      }
      const numberById = new Map(summaries.map((summary) => [summary.id, summary.number]));
      summaries.forEach((summary, index) => {
        summary.latest = summary.id === (snapshot.record?.revisionId ?? entries.at(-1)?.id);
        const metadata = entries[index].metadata ?? {};
        summary.basedOnNumber = numberById.get(entries[index].record?.basedOnId ?? metadata['based-on'] ?? '') ?? null;
        summary.restoredFromNumber = numberById.get(entries[index].record?.restoredFromId ?? metadata['restored-from'] ?? '') ?? null;
      });
      return { project, type, documentId, revisions: summaries.reverse(), current: await this.currentSelection(req, snapshot.record) };
    }
    // A committed pointer with no readable entries is not a pre-revision document.
    if (snapshot.record || !allowLegacy) return null;
    const legacy = documentId === MKTG_LIVING_DOCUMENT_ID ? await this.findLegacyDocument(req, type, project) : null;
    return legacy ? { project, type, documentId, revisions: [this.legacySummary(legacy)], current: null } : null;
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
      return legacy?.sha === parseMktgLegacyRevisionId(revision.id) ? { ...detail, revision, markdown: legacy.markdown, sidecar: null } : null;
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
    return { ...detail, revision: selected, markdown: stored.record.bundle.markdown, sidecar: stored.record.bundle.sidecar };
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
      return { record, etag: object.etag };
    } catch (error) {
      if (error instanceof MicroserviceError) throw error;
      throw this.corruptDocument('Current record is not valid JSON');
    }
  }

  /** Commit selection and visible revision IDs atomically, returning null on a lost comparison. */
  private async writeCurrent(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    snapshot: MktgDocumentCurrentSnapshot,
    revisionId: string,
    revisionIds: string[]
  ): Promise<MktgDocumentCurrentRecord | null> {
    const record = { revisionId, revisionIds, changedAt: new Date().toISOString(), changedBy: this.author(req) };
    const written = await this.objectStore.putConditionalObject(req, 'marketing-os-artifacts', this.currentKey(project, type, documentId), {
      body: Buffer.from(JSON.stringify(record)),
      contentType: MKTG_REVISION_CONTENT_TYPE,
      cacheControl: 'private',
      ...(snapshot.etag ? { ifMatch: snapshot.etag } : { ifNoneMatch: '*' as const }),
    });
    return written ? record : null;
  }

  /** Resolve selection attribution without leaking the stored subject or revision manifest. */
  private async currentSelection(req: Request, record: MktgDocumentCurrentRecord | null): Promise<MktgDocumentCurrentSelection | null> {
    if (!record) return null;
    return { revisionId: record.revisionId, changedAt: record.changedAt, changedBy: await this.resolveAuthor(req, record.changedBy) };
  }

  private currentKey(project: string, type: MktgDocumentType, documentId: string): string {
    return `${buildMktgDocumentPrefix(project, type.agentKey, documentId)}${MKTG_DOCUMENT_CURRENT_KEY}`;
  }

  /** List committed revisions with bounded HEADs and body fallback for historical metadata. */
  private async listRevisions(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    snapshot: MktgDocumentCurrentSnapshot,
    readConcurrency = MKTG_DOCUMENT_READ_CONCURRENCY
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
          const entry = { ...parsed, ...object, metadata };
          if (!metadata['content-sha']) {
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
      return { id: entry.id, key: entry.key, record };
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
    generation?: string
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
    const authorId = record.origin === 'legacy' ? null : this.author(req);
    const metadata: Record<string, string> = {
      managed: 'true',
      origin: record.origin,
      'content-sha': record.bundle.contentSha256,
      'created-at': record.createdAt,
      'intake-mode': record.source.intakeMode,
      'draft-version': String(record.source.draftVersion),
      format: this.format(record.bundle.format),
      status: Buffer.from(this.recordStatus(record)).toString('base64'),
      'comment-count': String(record.comments.length),
      'based-on': record.basedOnId ?? '',
      'restored-from': record.restoredFromId ?? '',
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
      commentCount: entry.record?.comments?.length ?? Number(metadata['comment-count'] ?? 0),
      draftVersion: entry.record?.source.draftVersion ?? (Number(metadata['draft-version']) || undefined),
      latest: false,
      basedOnNumber: null,
    };
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
      draftVersion: legacy.draftVersion,
    };
  }

  /** Stop as soon as the newest eligible pre-revision artifact is found. */
  private async findLegacyDocument(req: Request, type: MktgDocumentType, project: string): Promise<MktgLegacyDocument | null> {
    if (!type.legacyArtifactKey) return null;
    const prefix = buildMktgArtifactPartitionPrefix(MKTG_ARTIFACT_SPECS[type.legacyArtifactKey], project);
    const objects = await this.objectStore.listObjects(req, 'marketing-os-artifacts', prefix);
    objects.sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0));
    for (const candidate of objects) {
      const hash = extractMktgArtifactKeySha(candidate.key, prefix);
      if (!hash) continue;
      const metadata = await this.objectStore.headObject(req, 'marketing-os-artifacts', candidate.key);
      if (!metadata || metadata['revision-managed'] === 'true') continue;
      const version = Number(metadata['version']);
      return {
        sha: hash,
        key: candidate.key,
        markdown: '',
        storedAt: candidate.lastModified?.toISOString() ?? null,
        draftVersion: Number.isInteger(version) && version >= 1 ? version : MKTG_ARTIFACT_DEFAULT_DRAFT_VERSION,
        intakeMode: this.intakeMode(metadata['intake-mode']),
      };
    }
    return null;
  }

  /** Objects written by the new revision path can never become pre-revision history. */
  private async readLegacyDocument(req: Request, type: MktgDocumentType, project: string): Promise<MktgLegacyDocument | null> {
    const candidate = await this.findLegacyDocument(req, type, project);
    if (candidate) {
      const object = await this.objectStore.getObject(req, 'marketing-os-artifacts', candidate.key);
      if (object && this.sha256(object.body) === candidate.sha) return { ...candidate, markdown: object.body };
    }
    return null;
  }

  private markdownSource(envelope: MktgArtifactEnvelope): MktgRevisionContentSource {
    const { document_markdown: markdown, ...sidecar } = envelope as MktgArtifactEnvelope & Record<string, unknown>;
    return { text: markdown, contentSha256: envelope.content_sha256, format: 'markdown', sidecar, version: envelope.version, intakeMode: envelope.intake.mode };
  }

  private jsonSource<T extends object>(envelope: MktgArtifactJsonEnvelope<T>): MktgRevisionContentSource {
    const { content, ...sidecar } = envelope as MktgArtifactJsonEnvelope<T> & Record<string, unknown>;
    return { text: JSON.stringify(content), contentSha256: envelope.content_sha256, format: 'json', sidecar, version: envelope.version, intakeMode: envelope.intake.mode };
  }

  /** Structured assets have no Markdown review-status line. */
  private recordStatus(record: MktgRevisionRecord): string {
    return record.bundle.format === 'json' ? '' : findMktgDocumentStatus(record.bundle.markdown);
  }

  private format(value: unknown): MktgRevisionFormat {
    return value === 'json' ? 'json' : 'markdown';
  }

  /** Store only the effective opaque subject; an incomplete impersonation identity fails closed. */
  private author(req: Request): string {
    // The stored ID must be opaque: the operator rejected usernames and names on #3773.
    // getEffectiveSub's deprecation concerns upstream API arguments, not a stored opaque key.
    const userId = getEffectiveSub(req);
    if (!userId) throw new AuthenticationError('The requesting writer could not be identified.');
    return userId;
  }

  /** Request-scoped promise memoization prevents repeat lookups/warnings, including failed directory reads. */
  private async resolveAuthor(req: Request, userId: string | null | undefined): Promise<MktgRevisionAuthor | null> {
    if (!userId) return null;
    let authors = this.authors.get(req);
    if (!authors) {
      authors = new Map();
      this.authors.set(req, authors);
    }
    let author = authors.get(userId);
    if (!author) {
      author = (async () => {
        try {
          this.userService ??= new UserService();
          const response = await this.userService.getUserInfo(req, userId);
          if (!response.success) {
            logger.warning(req, 'mktg_document_store_author', 'Author lookup failed — showing no name');
            return { name: null };
          }
          return { name: response.data?.name || null };
        } catch (err) {
          logger.warning(req, 'mktg_document_store_author', 'Author lookup failed — showing no name', { err });
          return { name: null };
        }
      })();
      authors.set(userId, author);
    }
    return author;
  }

  private corruptDocument(message: string): MicroserviceError {
    return new MicroserviceError(message, 500, 'MKTG_DOCUMENT_CORRUPT', { service: 'mktg_document_store' });
  }

  private recordedIntakeMode(value: unknown): MktgArtifactIntakeMode | null {
    return MKTG_ARTIFACT_INTAKE_MODES.includes(value as MktgArtifactIntakeMode) ? (value as MktgArtifactIntakeMode) : null;
  }

  private intakeMode(value: unknown): MktgArtifactIntakeMode {
    return MKTG_ARTIFACT_INTAKE_MODES.includes(value as MktgArtifactIntakeMode) ? (value as MktgArtifactIntakeMode) : 'form';
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
