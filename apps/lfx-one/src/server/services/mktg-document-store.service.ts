// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MKTG_ARTIFACT_DEFAULT_DRAFT_VERSION,
  MKTG_ARTIFACT_INTAKE_MODES,
  MKTG_ARTIFACT_PARTITION_REGEX,
  MKTG_ARTIFACT_SPECS,
  MKTG_DOCUMENT_TYPES,
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
  MktgDocumentDetailResponse,
  MktgDocumentGroup,
  MktgDocumentListItem,
  MktgDocumentsResponse,
  MktgDocumentType,
  MktgLegacyDocument,
  MktgLegacyListing,
  MktgListedRevision,
  MktgRevisionBundle,
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
import { createHash } from 'node:crypto';
import { Request } from 'express';

import { logger } from './logger.service';
import { MktgArtifactService } from './mktg-artifact.service';
import { ObjectStoreService } from './object-store.service';

/**
 * The Marketing OS document store: every stored agent output is a document
 * with an append-only list of revisions, per project and agent.
 *
 * A revision is one immutable JSON object (the agent's bundle, the comments
 * that produced it, the formatter's deck spec and link, and where it came
 * from) at `documents/{project}/{agentKey}/{documentId}/{sequence}-{sha256}.json`
 * in the private `marketing-os-artifacts` bucket. The key is content-addressed
 * by the record's own bytes, so it is written through the object store's
 * create-if-absent primitive and never rewritten — which keeps the store on
 * the three object-store calls every backend serves (put, list, get).
 *
 * Revision numbers are positions in write order (sequence, then store write
 * time, then id), so two writers that raced to the same sequence still get
 * distinct, stable numbers and neither revision is lost.
 *
 * Living documents (one per project and agent) that were stored before
 * revisions existed show that pre-revision object as revision 1 with its
 * Markdown only; the first revision written to the document materializes it
 * as a stored revision 1 first. One-off runs are documents with exactly one
 * revision: a new run is a new document, never an update.
 *
 * A record holds no personal identity (no user name or username): it is
 * immutable and its key is the hash of its bytes, so a value an erasure
 * request could require removing must never be stored inside it.
 *
 * Restore copies an older revision into a new, latest revision. Nothing is
 * ever deleted, and `readLatest` — what dependent agents read — always serves
 * the latest revision, restored ones included.
 */
export class MktgDocumentStoreService {
  private readonly objectStore = new ObjectStoreService();
  private readonly artifactService = new MktgArtifactService();

  /**
   * Persist a validated envelope (the shared artifact write, unchanged) and
   * record it as a new revision of its document — see {@link recordPersisted}.
   */
  public async persistGeneration(
    req: Request,
    spec: MktgArtifactSpec,
    envelope: MktgArtifactEnvelope,
    projectUid: string | undefined,
    sessionId: string
  ): Promise<MktgArtifactPersistReceipt | null> {
    const receipt = await this.artifactService.persist(req, spec, envelope, projectUid);
    return receipt ? this.recordPersisted(req, spec.agentKey, receipt, this.markdownSource(envelope), sessionId) : null;
  }

  /**
   * Persist a validated STRUCTURED envelope (an agent whose output is JSON,
   * the Messaging Framework) as a new revision of its document — the JSON
   * text of its content as the revision's content, the rest of the envelope
   * as the sidecar. Nothing is written to the pre-revision `.md` partition:
   * the revision IS the stored copy, so the receipt names the revision's key.
   * The same write boundary as the artifact layer's (the SERVER-resolved,
   * writer-checked project) decides whether anything is written at all; every
   * refusal and storage failure degrades to null at WARN, like the artifact
   * write, and the next poll retries.
   */
  public async persistJsonGeneration<T extends object>(
    req: Request,
    spec: MktgArtifactSpec,
    envelope: MktgArtifactJsonEnvelope<T>,
    projectUid: string | undefined,
    sessionId: string
  ): Promise<MktgArtifactPersistReceipt | null> {
    const partition = await this.artifactService.resolveWritablePartition(req, spec, projectUid);
    const type = findMktgDocumentType(spec.agentKey);
    if (!partition || !type) {
      return null;
    }
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

  /**
   * Record an envelope the agent's write path has just persisted (its receipt
   * names the SERVER-resolved, writer-checked project) as a revision of its
   * document. A revision write that fails drops the receipt exactly like a
   * failed artifact write, so the run shell keeps polling and the next poll
   * retries both: the artifact write is an idempotent no-op by then, and the
   * revision write is skipped once the document holds a revision from this
   * session with these bytes.
   */
  public async recordPersisted<T extends MktgRunPersistReceipt>(
    req: Request,
    agentKey: MktgDocumentAgentKey,
    receipt: T,
    source: MktgArtifactEnvelope | MktgRevisionContentSource,
    sessionId: string
  ): Promise<T | null> {
    const type = findMktgDocumentType(agentKey);
    if (!type) {
      return receipt;
    }

    try {
      await this.recordGeneration(req, type, receipt.project, source, sessionId);
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

  /**
   * Record one generation as a revision of its document. Living documents get
   * a new latest revision (after materializing a pre-revision object as
   * revision 1); a run gets its own document, keyed by its session, with a
   * single revision. Idempotent per session and document bytes. Throws on a
   * storage failure — the caller decides how to degrade.
   */
  public async recordGeneration(
    req: Request,
    type: MktgDocumentType,
    project: string,
    envelope: MktgArtifactEnvelope | MktgRevisionContentSource,
    sessionId: string
  ): Promise<MktgStoredRevision> {
    const source = 'document_markdown' in envelope ? this.markdownSource(envelope) : envelope;
    const documentId = type.kind === 'run' ? this.runDocumentId(sessionId) : MKTG_LIVING_DOCUMENT_ID;
    const revisions = await this.readRevisions(req, project, type, documentId);

    // A run is never updated: its document holds exactly one revision. A
    // living document skips a generation it already holds (a repeated poll).
    const existing =
      type.kind === 'run'
        ? revisions[0]
        : revisions.find((revision) => revision.record.source.sessionId === sessionId && revision.record.bundle.contentSha256 === source.contentSha256);
    if (existing) {
      logger.debug(req, 'mktg_document_store_record', 'Generation already recorded — no new revision', { agent: type.agentKey, revision: existing.id });
      return existing;
    }

    if (revisions.length === 0 && type.kind === 'living') {
      // The legacy object this very generation just wrote is excluded: only a
      // document stored BEFORE this one can be the pre-revision revision 1.
      const legacy = await this.readLegacyDocument(req, type, project, source.contentSha256);
      if (legacy) {
        revisions.push(await this.writeRevision(req, project, type, documentId, 1, this.legacyRecordFields(legacy)));
      }
    }

    const revision = await this.writeRevision(req, project, type, documentId, this.nextSequence(revisions), {
      createdAt: new Date().toISOString(),
      origin: 'generated',
      restoredFromId: null,
      source: { sessionId, draftVersion: source.version, intakeMode: source.intakeMode },
      bundle: { markdown: source.text, contentSha256: source.contentSha256, format: source.format, sidecar: source.sidecar, brandFile: null },
    });

    logger.info(req, 'mktg_document_store_record', 'Stored a new document revision', {
      agent: type.agentKey,
      project,
      document: documentId,
      revision: revision.id,
    });
    return revision;
  }

  /**
   * Every document of a project, grouped by type in the Documents area's
   * order, from key listings only (no object bodies): one listing of the
   * project's revisions plus, for living documents with none yet, a listing
   * of their pre-revision partition.
   */
  public async listDocuments(req: Request, project: string): Promise<MktgDocumentsResponse> {
    const projectPrefix = buildMktgDocumentProjectPrefix(project);
    const listed = this.toListed(await this.objectStore.listObjects(req, 'marketing-os-artifacts', projectPrefix), projectPrefix);

    const groups: MktgDocumentGroup[] = [];
    for (const type of MKTG_DOCUMENT_TYPES) {
      const byDocument = new Map<string, MktgListedRevision[]>();
      for (const entry of listed.filter((candidate) => candidate.agentKey === type.agentKey)) {
        byDocument.set(entry.documentId, [...(byDocument.get(entry.documentId) ?? []), entry]);
      }

      const documents: MktgDocumentListItem[] = [...byDocument.entries()].map(([documentId, entries]) => {
        const ordered = this.orderListed(entries);
        const first = ordered[0];
        const latest = ordered[ordered.length - 1];
        return {
          agentKey: type.agentKey,
          documentId,
          revisionCount: ordered.length,
          latestRevisionId: latest.id,
          updatedAt: latest.lastModified?.toISOString() ?? null,
          createdAt: first.lastModified?.toISOString() ?? null,
        };
      });

      if (type.kind === 'living' && documents.length === 0) {
        const legacy = await this.listLegacyLatest(req, type, project);
        if (legacy) {
          const storedAt = legacy.lastModified?.toISOString() ?? null;
          documents.push({
            agentKey: type.agentKey,
            documentId: MKTG_LIVING_DOCUMENT_ID,
            revisionCount: 1,
            latestRevisionId: buildMktgLegacyRevisionId(legacy.sha),
            updatedAt: storedAt,
            createdAt: storedAt,
          });
        }
      }

      documents.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      groups.push({ type, documents });
    }

    return { project, groups };
  }

  /** A document with its revisions, newest first, or null when it has none. */
  public async getDocument(req: Request, project: string, type: MktgDocumentType, documentId: string): Promise<MktgDocumentDetailResponse | null> {
    const revisions = await this.readRevisions(req, project, type, documentId);
    if (revisions.length > 0) {
      return this.detail(project, type, documentId, this.summarize(revisions));
    }

    const legacy = documentId === MKTG_LIVING_DOCUMENT_ID ? await this.readLegacyDocument(req, type, project) : null;
    return legacy ? this.detail(project, type, documentId, [this.legacySummary(legacy)]) : null;
  }

  /** One revision with its Markdown, or null when the document has no such revision. */
  public async getRevision(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    revisionId: string
  ): Promise<MktgRevisionResponse | null> {
    const revisions = await this.readRevisions(req, project, type, documentId);

    if (revisions.length > 0) {
      const found = this.findRevision(revisions, revisionId);
      if (!found) {
        return null;
      }
      const summaries = this.summarize(revisions);
      const revision = summaries.find((summary) => summary.id === found.id) as MktgRevisionSummary;
      return {
        ...this.detail(project, type, documentId, summaries),
        revision,
        markdown: found.record.bundle.markdown,
        // The rest of the envelope: the framework view reads the report and inputs from it, the Brand Kit view renders the kit from it.
        sidecar: found.record.bundle.sidecar ?? null,
      };
    }

    // No stored revisions: only a living document's pre-revision object can answer.
    const legacySha = parseMktgLegacyRevisionId(revisionId);
    const legacy = legacySha && documentId === MKTG_LIVING_DOCUMENT_ID ? await this.readLegacyDocument(req, type, project) : null;
    if (!legacy || legacy.sha !== legacySha) {
      return null;
    }
    const revision = this.legacySummary(legacy);
    return { ...this.detail(project, type, documentId, [revision]), revision, markdown: legacy.markdown, sidecar: null };
  }

  /**
   * Make an older revision the latest by copying it into a new revision (its
   * bundle; comments and deck start empty, as for any new revision).
   * Restoring the latest revision changes nothing. Returns null when the
   * document has no such revision.
   */
  public async restoreRevision(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    revisionId: string
  ): Promise<{ detail: MktgDocumentDetailResponse; revision: MktgRevisionSummary } | null> {
    const revisions = await this.readRevisions(req, project, type, documentId);
    if (revisions.length === 0) {
      // A pre-revision document has one revision, which is the latest already.
      const current = await this.getRevision(req, project, type, documentId, revisionId);
      return current ? { detail: this.detail(project, type, documentId, current.revisions), revision: current.revision } : null;
    }

    const source = this.findRevision(revisions, revisionId);
    if (!source) {
      return null;
    }
    if (source.id === revisions[revisions.length - 1].id) {
      const summaries = this.summarize(revisions);
      return { detail: this.detail(project, type, documentId, summaries), revision: summaries[0] };
    }

    const restored = await this.writeRevision(req, project, type, documentId, this.nextSequence(revisions), {
      createdAt: new Date().toISOString(),
      origin: 'restored',
      restoredFromId: source.id,
      source: { sessionId: null, draftVersion: source.record.source.draftVersion, intakeMode: source.record.source.intakeMode },
      bundle: source.record.bundle,
    });

    logger.info(req, 'mktg_document_store_restore', 'Restored a document revision as the latest', {
      agent: type.agentKey,
      project,
      document: documentId,
      from: source.id,
      revision: restored.id,
    });

    const summaries = this.summarize([...revisions, restored]);
    return { detail: this.detail(project, type, documentId, summaries), revision: summaries[0] };
  }

  /**
   * The project's latest document for an agent that dependent agents read:
   * the latest revision when the document has any, else the pre-revision
   * read path exactly as before — only when the listing succeeded and found
   * no revisions. A failed lookup, or revisions none of which load, degrade
   * to null rather than to the older pre-revision copy.
   *
   * `withSidecar`: the same latest revision — the newest one that passes its
   * integrity checks (a restore is itself the newest revision) — WITH its
   * sidecar JSON and the date it was stored, which is what
   * a consumer attaching the document as JSON takes (the Brand Kit's
   * messaging framework). The latest revision regardless of its review
   * status: LFX One has no Approve action yet, so an approved-only read
   * could never answer (product decision, 17 Oct 2026 — Approve is a later
   * item, and this is where the read narrows to the approved revision when
   * it lands).
   * Null when the agent has no document type or the project is not a valid
   * partition (nothing is listed), or when the listing succeeded and no
   * revision loads (a revision that fails its integrity checks is skipped
   * like everywhere else); the pre-revision document carries no sidecar, so
   * there is no fallback to it. A storage failure on this path is rethrown, never read as "no
   * revision": the consumer gates a run on the answer, so it must render a
   * failure state, not an absence.
   */
  public async readLatest(
    req: Request,
    spec: MktgArtifactSpec,
    project: string,
    options: { withSidecar?: boolean } = {}
  ): Promise<MktgArtifactStoredResponse | null> {
    const withSidecar = options.withSidecar === true;
    const type = findMktgDocumentType(spec.agentKey);
    if (!type || !MKTG_ARTIFACT_PARTITION_REGEX.test(project)) {
      return withSidecar ? null : this.artifactService.readLatest(req, spec, project);
    }

    // The pre-revision copy is served only when a lookup that succeeded found
    // no revisions. A failed lookup, or revisions none of which can be read,
    // serve nothing: the pre-revision copy is older than every revision (a
    // JSON generation never updates it), and a dependent agent prefers the
    // server's answer over the browser's current asset, so serving it would
    // hand that agent obsolete content.
    let listed: MktgListedRevision[];
    try {
      if (withSidecar) {
        // Every revision is read, so the one attached is named by its number
        // in Documents: the count of the revisions that pass their integrity
        // checks up to it, exactly as the Revisions table numbers them.
        const revisions = await this.readRevisions(req, project, type, MKTG_LIVING_DOCUMENT_ID);
        const latest = revisions[revisions.length - 1];
        return latest
          ? { ...this.latestResponse(spec, project, latest), revisionNumber: revisions.length, sidecar: this.envelopeSidecar(latest.record.bundle) }
          : null;
      }
      listed = await this.listRevisions(req, project, type, MKTG_LIVING_DOCUMENT_ID);
      for (const entry of [...listed].reverse()) {
        const revision = await this.loadRevision(req, entry);
        if (revision) {
          return this.latestResponse(spec, project, revision);
        }
      }
    } catch (error) {
      if (withSidecar) {
        // The consumer gates a run on this answer, so a storage failure is a
        // failure (the controller answers 5xx), never "no revision"; the
        // centralized error handler logs the ERROR.
        logger.warning(req, 'mktg_document_store_read_latest', 'Latest revision read failed — rethrowing for the caller to handle', {
          agent: type.agentKey,
          project,
          with_sidecar: true,
          err: error,
        });
        throw error;
      }
      logger.warning(req, 'mktg_document_store_read_latest', 'Revision read failed — serving no stored document', {
        agent: type.agentKey,
        project,
        err: error,
      });
      return null;
    }

    if (listed.length > 0) {
      logger.warning(req, 'mktg_document_store_read_latest', 'No stored revision could be read — serving no stored document', {
        agent: type.agentKey,
        project,
        revisions: listed.length,
      });
      return null;
    }
    // Reached only by the plain read: the sidecar read returned in the try.
    return this.artifactService.readLatest(req, spec, project);
  }

  /**
   * The revision an export names, with its summary: the revision
   * `revisionId` names, else the newest revision holding the content
   * `contentSha256` names (a run's version, which knows the hash of what it
   * stored, not the revision id), else the latest. Stored revisions only: a
   * pre-revision document is Markdown alone, with no asset to export. Null
   * when the document has no stored revision or none matches. Throws on a
   * storage failure.
   */
  public async readExportRevision(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    selector: { revisionId?: string; contentSha256?: string }
  ): Promise<{ revision: MktgStoredRevision; summary: MktgRevisionSummary } | null> {
    const revisions = await this.readRevisions(req, project, type, documentId);
    if (revisions.length === 0) {
      return null;
    }
    let found: MktgStoredRevision | undefined;
    if (selector.revisionId) {
      found = this.findRevision(revisions, selector.revisionId);
    } else if (selector.contentSha256) {
      found = [...revisions].reverse().find((revision) => revision.record.bundle.contentSha256 === selector.contentSha256);
    } else {
      found = revisions[revisions.length - 1];
    }
    if (!found) {
      return null;
    }
    const summary = this.summarize(revisions).find((candidate) => candidate.id === found.id) as MktgRevisionSummary;
    return { revision: found, summary };
  }

  /**
   * The document's newest stored revision that passes its integrity checks,
   * read from the listing and that one revision's body alone (walking back
   * past one that fails), for a caller that needs only its identity: the
   * last-export lookup, which compares hashes. `number` is the revision's
   * place in the listing — the Revisions table's number unless an earlier
   * revision fails its checks, which this read does not open. Null when the
   * document has no stored revision. Throws on a storage failure.
   */
  public async readNewestRevisionRef(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string
  ): Promise<{ id: string; number: number; contentSha256: string } | null> {
    const listed = await this.listRevisions(req, project, type, documentId);
    for (let index = listed.length - 1; index >= 0; index--) {
      const revision = await this.loadRevision(req, listed[index]);
      if (revision) {
        return { id: revision.id, number: index + 1, contentSha256: revision.record.bundle.contentSha256 };
      }
    }
    return null;
  }

  /**
   * The stored revision an id names. A legacy id names the pre-revision
   * object, which is the materialized revision 1 with the same bytes once the
   * document has stored revisions.
   */
  private findRevision(revisions: MktgStoredRevision[], revisionId: string): MktgStoredRevision | undefined {
    const legacySha = parseMktgLegacyRevisionId(revisionId);
    if (legacySha) {
      return revisions.find((revision) => revision.record.origin === 'legacy' && revision.record.bundle.contentSha256 === legacySha);
    }
    return revisions.find((revision) => revision.id === revisionId);
  }

  /** Every integrity-checked revision of a document, in write order. Throws on a storage failure. */
  private async readRevisions(req: Request, project: string, type: MktgDocumentType, documentId: string): Promise<MktgStoredRevision[]> {
    const listed = await this.listRevisions(req, project, type, documentId);
    const loaded = await Promise.all(listed.map((entry) => this.loadRevision(req, entry)));
    return loaded.filter((revision): revision is MktgStoredRevision => revision !== null);
  }

  /** A document's revision keys in write order: sequence, then store write time, then id. */
  private async listRevisions(req: Request, project: string, type: MktgDocumentType, documentId: string): Promise<MktgListedRevision[]> {
    const projectPrefix = buildMktgDocumentProjectPrefix(project);
    const documentPrefix = buildMktgDocumentPrefix(project, type.agentKey, documentId);
    const objects = await this.objectStore.listObjects(req, 'marketing-os-artifacts', documentPrefix);
    const listed = this.toListed(objects, projectPrefix).filter((entry) => entry.agentKey === type.agentKey && entry.documentId === documentId);
    return this.orderListed(listed);
  }

  /** The revision keys among listed objects; anything else under the prefix is ignored. */
  private toListed(objects: { key: string; lastModified?: Date }[], projectPrefix: string): MktgListedRevision[] {
    const listed: MktgListedRevision[] = [];
    for (const object of objects) {
      const parsed = parseMktgRevisionKey(object.key, projectPrefix);
      if (parsed) {
        listed.push({ ...parsed, key: object.key, lastModified: object.lastModified });
      }
    }
    return listed;
  }

  private orderListed(entries: MktgListedRevision[]): MktgListedRevision[] {
    return [...entries].sort(
      (a, b) => a.sequence - b.sequence || (a.lastModified?.getTime() ?? 0) - (b.lastModified?.getTime() ?? 0) || a.id.localeCompare(b.id)
    );
  }

  /**
   * Read one revision and check it: the bytes must hash to the key's sha, the
   * record must be this schema and belong to this key, and the bundle's
   * Markdown must hash to its own sha. A revision that fails is skipped, never
   * served. Throws on a storage failure.
   */
  private async loadRevision(req: Request, entry: MktgListedRevision): Promise<MktgStoredRevision | null> {
    const object = await this.objectStore.getObject(req, 'marketing-os-artifacts', entry.key);
    if (!object) {
      return null;
    }

    const bodySha = this.sha256(object.body);
    if (bodySha !== entry.sha) {
      logger.warning(req, 'mktg_document_store_read', 'Stored revision bytes do not match the content-addressed key — skipping', { key: entry.key });
      return null;
    }

    let record: MktgRevisionRecord;
    try {
      record = JSON.parse(object.body) as MktgRevisionRecord;
    } catch {
      logger.warning(req, 'mktg_document_store_read', 'Stored revision is not JSON — skipping', { key: entry.key });
      return null;
    }

    const valid =
      record?.schema === MKTG_REVISION_SCHEMA &&
      record.agentKey === entry.agentKey &&
      record.documentId === entry.documentId &&
      record.sequence === entry.sequence &&
      typeof record.bundle?.markdown === 'string' &&
      this.sha256(record.bundle.markdown) === record.bundle.contentSha256 &&
      typeof record.source === 'object' &&
      record.source !== null;
    if (!valid) {
      logger.warning(req, 'mktg_document_store_read', 'Stored revision does not match its key or schema — skipping', { key: entry.key });
      return null;
    }

    return { id: entry.id, key: entry.key, record };
  }

  /** Write one revision record, content-addressed by its own bytes. */
  private async writeRevision(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    sequence: number,
    fields: MktgRevisionRecordFields
  ): Promise<MktgStoredRevision> {
    const record: MktgRevisionRecord = {
      schema: MKTG_REVISION_SCHEMA,
      project,
      agentKey: type.agentKey,
      documentId,
      sequence,
      ...fields,
      // Stored now so later work can fill them; nothing writes them yet.
      comments: [],
      deck: { spec: null, link: null },
    };
    const body = JSON.stringify(record);
    const sha = this.sha256(body);
    const key = buildMktgRevisionKey(project, type.agentKey, documentId, sequence, sha);

    await this.objectStore.putContentAddressedObject(req, 'marketing-os-artifacts', key, Buffer.from(body, 'utf8'), MKTG_REVISION_CONTENT_TYPE, 'private', {
      origin: record.origin,
      sequence: String(sequence),
    });

    return { id: buildMktgRevisionId(sequence, sha), key, record };
  }

  /** A stored revision as the latest read serves it: its Markdown, the receipt rebuilt from its record, and its date. */
  private latestResponse(spec: MktgArtifactSpec, project: string, revision: MktgStoredRevision): MktgArtifactStoredResponse {
    const { bundle, source, createdAt } = revision.record;
    // A Markdown revision has a pre-revision twin at the artifact key; a
    // JSON revision is stored nowhere else, so its own key is the receipt's.
    return {
      documentMarkdown: bundle.markdown,
      format: bundle.format ?? 'markdown',
      receipt: {
        s3_key: bundle.format === 'json' ? revision.key : buildMktgArtifactObjectKey(spec, project, bundle.contentSha256),
        content_sha256: bundle.contentSha256,
        project,
        version: source.draftVersion,
        intake_mode: source.intakeMode,
      },
      storedAt: createdAt,
    };
  }

  /** Summaries for the Revisions table, newest first, numbered by write order. */
  private summarize(revisions: MktgStoredRevision[]): MktgRevisionSummary[] {
    const numberById = new Map(revisions.map((revision, index) => [revision.id, index + 1]));
    return revisions
      .map((revision, index) => {
        const { record } = revision;
        return {
          id: revision.id,
          number: index + 1,
          createdAt: record.createdAt ?? null,
          origin: record.origin,
          restoredFromNumber: record.restoredFromId ? (numberById.get(record.restoredFromId) ?? null) : null,
          intakeMode: this.intakeMode(record.source.intakeMode),
          // A JSON asset states no review label in its text.
          status: record.bundle.format === 'json' ? '' : findMktgDocumentStatus(record.bundle.markdown),
          contentSha256: record.bundle.contentSha256,
          format: this.format(record.bundle.format),
          commentCount: Array.isArray(record.comments) ? record.comments.length : 0,
          latest: index === revisions.length - 1,
        };
      })
      .reverse();
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
    };
  }

  private legacyRecordFields(legacy: MktgLegacyDocument): MktgRevisionRecordFields {
    return {
      createdAt: legacy.storedAt ?? new Date().toISOString(),
      origin: 'legacy',
      restoredFromId: null,
      source: { sessionId: null, draftVersion: legacy.draftVersion, intakeMode: legacy.intakeMode },
      bundle: { markdown: legacy.markdown, contentSha256: legacy.sha, sidecar: null, brandFile: null },
    };
  }

  private detail(project: string, type: MktgDocumentType, documentId: string, revisions: MktgRevisionSummary[]): MktgDocumentDetailResponse {
    return { project, type, documentId, revisions };
  }

  /** The newest pre-revision object of a living document (key listing only). */
  private async listLegacyLatest(req: Request, type: MktgDocumentType, project: string): Promise<MktgLegacyListing | null> {
    const legacy = await this.listLegacy(req, type, project);
    return legacy[0] ?? null;
  }

  /** Pre-revision objects of a living document, newest first (the pre-revision read path's order). */
  private async listLegacy(req: Request, type: MktgDocumentType, project: string, excludeSha?: string): Promise<MktgLegacyListing[]> {
    if (!type.legacyArtifactKey) {
      return [];
    }
    const prefix = buildMktgArtifactPartitionPrefix(MKTG_ARTIFACT_SPECS[type.legacyArtifactKey], project);
    const objects = await this.objectStore.listObjects(req, 'marketing-os-artifacts', prefix);
    const legacy: MktgLegacyListing[] = [];
    for (const object of objects) {
      const sha = extractMktgArtifactKeySha(object.key, prefix);
      if (sha && sha !== excludeSha) {
        legacy.push({ key: object.key, sha, lastModified: object.lastModified });
      }
    }
    return legacy.sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0));
  }

  /**
   * The pre-revision document that is (or becomes) revision 1: the newest
   * integrity-checked object of the agent's pre-revision partition — the one
   * its stored-document read served — excluding `excludeSha`. Throws on a
   * storage failure, so a revision is never written over a document that
   * could not be read.
   */
  private async readLegacyDocument(req: Request, type: MktgDocumentType, project: string, excludeSha?: string): Promise<MktgLegacyDocument | null> {
    for (const candidate of await this.listLegacy(req, type, project, excludeSha)) {
      const object = await this.objectStore.getObject(req, 'marketing-os-artifacts', candidate.key);
      if (!object || this.sha256(object.body) !== candidate.sha) {
        continue;
      }
      const version = Number.parseInt(object.metadata['version'] ?? '', 10);
      return {
        sha: candidate.sha,
        key: candidate.key,
        markdown: object.body,
        storedAt: candidate.lastModified?.toISOString() ?? null,
        draftVersion: Number.isInteger(version) && version >= 1 ? version : MKTG_ARTIFACT_DEFAULT_DRAFT_VERSION,
        intakeMode: this.intakeMode(object.metadata['intake-mode']),
      };
    }
    return null;
  }

  /** A Markdown envelope as the revision writer takes it: the document as the content, the rest as the sidecar. */
  private markdownSource(envelope: MktgArtifactEnvelope): MktgRevisionContentSource {
    const { document_markdown: markdown, ...sidecar } = envelope as MktgArtifactEnvelope & Record<string, unknown>;
    return { text: markdown, contentSha256: envelope.content_sha256, format: 'markdown', sidecar, version: envelope.version, intakeMode: envelope.intake.mode };
  }

  /**
   * A structured envelope as the revision writer takes it: the content's
   * JSON text (the bytes its sha was verified over) as the content, the rest
   * of the envelope as the sidecar.
   */
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

  /**
   * The sidecar a consumer attaching the revision as JSON takes: for a
   * Markdown revision the stored sidecar (the envelope's structured fields);
   * for a JSON revision the envelope it was stored from — the sidecar with
   * the content (the revision's JSON text) back under `content`, the shape
   * the Brand Kit's framework reader unwraps. A JSON revision whose text
   * does not parse to an object keeps its stored sidecar alone.
   */
  private envelopeSidecar(bundle: MktgRevisionBundle): Record<string, unknown> | null {
    if (bundle.format !== 'json') {
      return bundle.sidecar ?? null;
    }
    try {
      const content: unknown = JSON.parse(bundle.markdown);
      if (content !== null && typeof content === 'object' && !Array.isArray(content)) {
        return { ...(bundle.sidecar ?? {}), content };
      }
    } catch {
      // Not JSON: the stored sidecar alone, which the consumer's gate reads as no voice.
    }
    return bundle.sidecar ?? null;
  }

  private format(value: unknown): MktgRevisionFormat {
    return value === 'json' ? 'json' : 'markdown';
  }

  private nextSequence(revisions: MktgStoredRevision[]): number {
    return revisions.reduce((max, revision) => Math.max(max, revision.record.sequence), 0) + 1;
  }

  private intakeMode(value: unknown): MktgArtifactIntakeMode {
    return MKTG_ARTIFACT_INTAKE_MODES.includes(value as MktgArtifactIntakeMode) ? (value as MktgArtifactIntakeMode) : 'form';
  }

  /** A run's document id: stable per Guild session, so repeated result polls address one document. */
  private runDocumentId(sessionId: string): string {
    return `${MKTG_RUN_DOCUMENT_ID_PREFIX}${this.sha256(sessionId).slice(0, 24)}`;
  }

  private sha256(value: string): string {
    return createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
  }
}
