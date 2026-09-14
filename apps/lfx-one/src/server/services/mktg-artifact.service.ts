// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ARTIFACT_CONTENT_TYPE, MKTG_ARTIFACT_DEFAULT_DRAFT_VERSION, MKTG_ARTIFACT_PARTITION_REGEX } from '@lfx-one/shared/constants';
import {
  MktgArtifactEnvelope,
  MktgArtifactIntakeMode,
  MktgArtifactPersistReceipt,
  MktgArtifactSpec,
  MktgArtifactStoredResponse,
} from '@lfx-one/shared/interfaces';
import { buildMktgArtifactObjectKey, buildMktgArtifactPartitionPrefix, extractMktgArtifactKeySha } from '@lfx-one/shared/utils';
import { createHash } from 'node:crypto';
import { Request } from 'express';

import { logger } from './logger.service';
import { ObjectStoreService } from './object-store.service';
import { ProjectService } from './project.service';

/**
 * ONE document-persistence layer for EVERY Marketing OS agent
 * (dec-brand-kit-storage-v2, generalized). The Brand Kit proved this write and
 * read path; the four things that differ between agents — key prefix, size
 * cap, log namespace, envelope type — arrive as a {@link MktgArtifactSpec} and
 * a structurally-typed envelope, so a ninth agent persists its document by
 * registering a spec and wiring two endpoints, never by copying this file.
 *
 * Everything here is deliberately identical for all agents:
 * - the storage partition is the entitlement-checked, SERVER-RESOLVED project
 *   uid (never an envelope's own project slug — that is a security boundary,
 *   see {@link resolveWritablePartition});
 * - the size gate;
 * - content-addressed keys in the ONE shared `marketing-os-artifacts` bucket;
 * - version + intake-mode object metadata, and the strictly-newer-draft
 *   metadata refresh rule;
 * - degrade-to-null on every refusal and every storage failure, at WARN;
 * - the list+get read path and its write-time ordering.
 */
export class MktgArtifactService {
  private readonly objectStore = new ObjectStoreService();
  private readonly projectService = new ProjectService();

  /**
   * Persist a validated envelope's raw document bytes to the shared private
   * marketing artifacts bucket (size gate, key derived from validated fields
   * only). Idempotent under polling — content-addressed keys make the repeat
   * write a HEAD no-op, with one deliberate exception: a strictly newer draft
   * that reproduces an already-stored document verbatim rewrites it, so the
   * stored draft label and store timestamp describe the latest draft that
   * produced those bytes rather than the first.
   *
   * WRITE BOUNDARY. The partition is the SERVER-RESOLVED LFX project uid and
   * the caller must hold that project's writer grant (the same entitlement
   * that gates the read path) — an envelope's own `project` slug is derived
   * from the free-text project name and is never trusted to address storage.
   * That would both scatter documents into partitions the read path never
   * lists and let any authenticated caller name their way into another
   * project's partition.
   *
   * The envelope must ALREADY be schema-validated with its `content_sha256`
   * recomputed against the document bytes by the calling agent service — this
   * layer addresses storage by that sha and does not re-derive it. An
   * unvalidated sha is a caller CONTRACT VIOLATION and THROWS (from the key
   * builder, before any storage call): it is a programming error in the agent
   * service, not a storage outage, so it must reach the central error handler
   * at ERROR rather than degrade to a WARN the next poll would retry forever.
   *
   * Every other reason not to write degrades identically: the document was
   * already fully validated, so the user still gets it; the receipt is simply
   * omitted (WARN says which reason). A storage failure is retried by the
   * next poll.
   */
  public async persist(req: Request, spec: MktgArtifactSpec, envelope: MktgArtifactEnvelope, projectUid?: string): Promise<MktgArtifactPersistReceipt | null> {
    const operation = this.persistOperation(spec);
    const partition = await this.resolveWritablePartition(req, spec, projectUid);
    if (!partition) {
      return null;
    }

    const documentBytes = Buffer.from(envelope.document_markdown, 'utf8');

    // Size gate (defense in depth — also checked byte-accurately by each
    // agent's shared validator via TextEncoder before the envelope got here).
    // Checked before the operation starts so the log timeline stays balanced.
    if (documentBytes.length > spec.maxDocumentBytes) {
      logger.warning(req, operation, 'Document exceeds the object size cap — not persisted', {
        project: partition,
        bytes: documentBytes.length,
        max_bytes: spec.maxDocumentBytes,
      });
      return null;
    }

    // Key derived from the server-resolved partition plus validated envelope
    // fields only — the sha was recomputed against the document bytes by the
    // agent service before selection. Built BEFORE the operation starts and
    // OUTSIDE the storage try/catch on purpose: the builder throws on an
    // unvalidated sha, and that throw is a caller contract violation, not a
    // transient write failure — it must not be logged as one and retried.
    const key = buildMktgArtifactObjectKey(spec, partition, envelope.content_sha256);

    const startTime = logger.startOperation(req, operation, { project: partition, version: envelope.version });
    try {
      // The version / intake mode ride as object metadata so the stored-document
      // read path can rebuild the receipt without re-parsing the envelope —
      // content-addressed keys carry only the sha.
      const written = await this.objectStore.putContentAddressedObject(
        req,
        'marketing-os-artifacts',
        key,
        documentBytes,
        MKTG_ARTIFACT_CONTENT_TYPE,
        'private',
        { version: String(envelope.version), 'intake-mode': envelope.intake.mode },
        // The bytes are immutable, but their metadata is not content: when a
        // later draft of the run reproduces this document verbatim, the stored
        // labels still describe the draft that wrote it first, and — because
        // the object is skipped as a no-op — its store timestamp still dates
        // that first write, which is what the read path orders by. So a
        // strictly newer draft rewrites the identical bytes to advance both.
        // Strictly newer, never equal: the repeat write of every subsequent
        // poll must stay a HEAD-only no-op, and a draft label must never move
        // backwards when an older run re-emits the same document.
        { refreshMetadataWhen: (stored) => this.storedDraftVersion(stored) < envelope.version }
      );

      logger.success(req, operation, startTime, {
        key,
        written,
        project: partition,
        version: envelope.version,
        intake_mode: envelope.intake.mode,
      });

      return {
        s3_key: key,
        content_sha256: envelope.content_sha256,
        project: partition,
        version: envelope.version,
        intake_mode: envelope.intake.mode,
      };
    } catch (error) {
      // Deliberate degrade: surface the validated document even when storage is
      // down; the content-addressed write is retried on the next poll (the
      // client keeps polling while the receipt is missing). WARN, not ERROR —
      // graceful-degradation failures per logging-patterns.md, and the bucket
      // env var is intentionally absent in deployed environments for now.
      logger.warning(req, operation, 'Object-store write failed — returning document without a receipt; retried on next poll', {
        project: partition,
        version: envelope.version,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Fetch a project's LATEST persisted document for one agent from the
   * content-addressed partition `{spec.keyPrefix}/{project uid}/` (the
   * dec-agent-dependency-gating read path). Objects are ordered by store
   * LastModified (newest first) and each candidate's sha256 is recomputed
   * against the sha embedded in its key before it can be served — a corrupted
   * object is skipped, never surfaced. Returns null when the partition holds
   * nothing servable.
   *
   * LATEST IS WRITE TIME, DELIBERATELY — NOT the envelope `version` riding in
   * object metadata. This partition is PROJECT-scoped and shared by every
   * writer of the project, while `version` is a draft counter scoped to one
   * run: every agent contract defines it per session lifecycle, and the client
   * only carries it across sessions through a browser-local stored run (keyed
   * to the effective user, TTL-pruned). It therefore restarts at 1 for a
   * second writer, a second browser, cleared storage, or an expired record.
   * Ordering this partition by it would let one writer's v5 permanently
   * outrank every later document anyone else stores — trading a rare race for
   * deterministic, permanent staleness. Server write time is the only ordering
   * signal that is monotonic across writers, browsers and sessions. `version`
   * stays what it is: a label on the returned receipt.
   *
   * Storage failures degrade to null (WARN, not ERROR) — the caller treats
   * "store unreachable" exactly like "nothing stored" (404), and the client
   * falls back to its browser-stored run; same graceful-degradation contract
   * as the write path, whose bucket env var is intentionally absent in some
   * deployed environments.
   */
  public async readLatest(req: Request, spec: MktgArtifactSpec, projectUid: string): Promise<MktgArtifactStoredResponse | null> {
    const operation = this.storedOperation(spec);

    // The partition uid comes from the server-resolved project — but it must
    // still be a single safe key segment before it can form a key.
    if (!MKTG_ARTIFACT_PARTITION_REGEX.test(projectUid)) {
      return null;
    }

    const prefix = buildMktgArtifactPartitionPrefix(spec, projectUid);
    const startTime = logger.startOperation(req, operation, { project: projectUid });

    try {
      const objects = await this.objectStore.listObjects(req, 'marketing-os-artifacts', prefix);

      // Content-addressed document objects only ({prefix}/{project}/{sha}.md),
      // newest first. Undated entries sort last — a dated object always wins.
      const candidates = objects
        .filter((object) => extractMktgArtifactKeySha(object.key, prefix) !== null)
        .sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0));

      for (const candidate of candidates) {
        // Non-null by the filter above.
        const keySha = extractMktgArtifactKeySha(candidate.key, prefix) as string;
        const object = await this.objectStore.getObject(req, 'marketing-os-artifacts', candidate.key);
        if (!object) {
          continue;
        }

        // Same integrity gate as the result path: the served bytes must hash
        // to the content-addressed key's sha.
        const recomputedSha = createHash('sha256').update(Buffer.from(object.body, 'utf8')).digest('hex');
        if (recomputedSha !== keySha) {
          logger.warning(req, operation, 'Stored object bytes do not match the content-addressed key — skipping', {
            key: candidate.key,
            recomputed: recomputedSha,
          });
          continue;
        }

        const intakeMode: MktgArtifactIntakeMode = object.metadata['intake-mode'] === 'conversational' ? 'conversational' : 'form';

        logger.success(req, operation, startTime, { project: projectUid, key: candidate.key });
        return {
          documentMarkdown: object.body,
          receipt: {
            s3_key: candidate.key,
            content_sha256: keySha,
            project: projectUid,
            version: this.storedDraftVersion(object.metadata),
            intake_mode: intakeMode,
          },
          ...(candidate.lastModified && { storedAt: candidate.lastModified.toISOString() }),
        };
      }

      logger.success(req, operation, startTime, { project: projectUid, found: false });
      return null;
    } catch (error) {
      logger.warning(req, operation, 'Object-store read failed — reporting no stored document', {
        project: projectUid,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Resolve the storage partition a document may be written to: the LFX
   * project uid, as the PROJECTS SERVICE reports it, for a project the caller
   * holds the writer grant on. Null means "do not write" — no project scope,
   * a uid that is not one safe segment, an unresolvable uid, or a caller
   * without the writer grant.
   *
   * The CALLER'S raw uid is shape-gated before it is spent upstream:
   * `getProjectById` interpolates it unencoded into `/projects/{uid}`, so a
   * value carrying `/`, `?` or `#` could reshape the authenticated lookup
   * whose answer the writer check is read from. The resolved uid is gated
   * again below, because only that one becomes a storage key segment.
   *
   * Called only once a ready envelope exists, so `pending` polls (the vast
   * majority of a multi-minute generation) cost no upstream lookups.
   *
   * Every refusal is a WARN, never an ERROR: the caller degrades by returning
   * the validated document without a receipt, exactly like a storage outage
   * (graceful-degradation logging discipline).
   */
  private async resolveWritablePartition(req: Request, spec: MktgArtifactSpec, projectUid?: string): Promise<string | null> {
    const operation = this.persistOperation(spec);
    const uid = projectUid?.trim();
    if (!uid) {
      logger.warning(req, operation, 'No project scope on the result request — document returned but not persisted', {});
      return null;
    }
    if (!MKTG_ARTIFACT_PARTITION_REGEX.test(uid)) {
      logger.warning(req, operation, 'Run project scope is not a single-segment project uid — not resolved, not persisted', {});
      return null;
    }

    try {
      // `access: true` annotates the caller's grants on the resolved project —
      // the same ProjectService + `project.writer` precedent the stored-document
      // read endpoints and writer.guard use.
      const project = await this.projectService.getProjectById(req, uid, true);
      if (!project.writer) {
        logger.warning(req, operation, 'Caller lacks the project writer grant — document returned but not persisted', {
          project: project.uid,
        });
        return null;
      }
      // Partition from the SERVER-resolved uid (never the client's echo), and
      // only when it is one safe key segment.
      if (!MKTG_ARTIFACT_PARTITION_REGEX.test(project.uid)) {
        logger.warning(req, operation, 'Resolved project uid is not a valid storage partition — not persisted', { project: project.uid });
        return null;
      }
      return project.uid;
    } catch (error) {
      logger.warning(req, operation, 'Could not resolve the run’s project — document returned without a receipt', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * The draft version an object's metadata reports. Objects persisted before
   * metadata was written — and anything unparseable — report the documented
   * default of 1, so this is safe to compare on the write path: an unlabelled
   * object is treated as the oldest possible draft, never as a newer one.
   */
  private storedDraftVersion(metadata: Record<string, string>): number {
    const version = Number.parseInt(metadata['version'] ?? '', 10);
    if (!Number.isInteger(version) || version < MKTG_ARTIFACT_DEFAULT_DRAFT_VERSION) {
      return MKTG_ARTIFACT_DEFAULT_DRAFT_VERSION;
    }
    return version;
  }

  /** Log operation for this agent's write path, e.g. `brand_kit_persist`. */
  private persistOperation(spec: MktgArtifactSpec): string {
    return `${spec.logNamespace}_persist`;
  }

  /** Log operation for this agent's stored-document read path, e.g. `brand_kit_stored`. */
  private storedOperation(spec: MktgArtifactSpec): string {
    return `${spec.logNamespace}_stored`;
  }
}
