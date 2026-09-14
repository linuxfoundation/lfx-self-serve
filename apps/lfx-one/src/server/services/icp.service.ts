// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ICP_CONTRACT_ID, ICP_MAX_DOCUMENT_BYTES, ICP_PROJECT_UID_REGEX } from '@lfx-one/shared/constants';
import { IcpEnvelope, IcpGenerationStart, IcpResultResponse, MktgRunPersistReceipt } from '@lfx-one/shared/interfaces';
import { buildIcpFormPayload, buildIcpObjectKey, extractIcpEnvelopeCandidates, renderIcpFormText, validateIcpEnvelope } from '@lfx-one/shared/utils';
import { createHash } from 'node:crypto';
import { Request } from 'express';

import { GithubReadmeService } from './github-readme.service';
import { GuildService } from './guild.service';
import { logger } from './logger.service';
import { ObjectStoreService } from './object-store.service';
import { ProjectService } from './project.service';

/**
 * ICP & Target Markets generation flow (icp-output/v1) — the two shipped
 * sibling flows combined, deliberately and without inventing a third shape:
 *
 * 1. Submission follows the Message Foundation. The batch submission is the
 *    agent's typed `icp_intake_form` payload, transported by default as a
 *    BFF-rendered text message (`renderIcpFormText` — a verbatim mirror of
 *    the agent's own form renderer), because Guild coerces a structured
 *    `agent_input` to `{type:'text', text: JSON.stringify(payload)}` before
 *    the agent's zod preprocess runs (live-smoked 2026-08-20);
 *    `GUILD_STRUCTURED_AGENT_INPUT=true` flips to the structured transport
 *    without a redeploy once Guild passes objects through. The README is
 *    fetched server-side (the agent has no web access) and NEVER blocks the
 *    run. Regeneration is a full resubmit on a FRESH session carrying
 *    `feedback` + `prior_version`, which is exactly what the result poll's
 *    strictly-newer version gate accepts.
 * 2. Persistence follows the Brand Kit. On a ready result the raw
 *    `document_markdown` bytes are written to the SAME shared private
 *    marketing artifacts bucket under the content-addressed key
 *    `icp/{project}/{content_sha256}.md` — one bucket, per-agent key prefix
 *    (dec-brand-kit-storage-v2, wi-brand-kit-bucket-def-amend) — where
 *    `{project}` is the SERVER-RESOLVED LFX project uid the caller holds the
 *    writer grant on. All graph writes stay deferred
 *    (wi-lfx-one-service-actor): the response carries a receipt with exactly
 *    the fields needed for later Artifact minting.
 *
 * The authoritative typed output is the `finalize_icp_document` tool RESULT
 * riding raw system events (the brand-kit live-smoke A3 pattern). Every
 * candidate envelope is schema-validated — including the contract's structure
 * gates G1-G6 — and the document sha256 is recomputed server-side before
 * anything reaches the user.
 */
export class IcpService {
  private readonly guildService = new GuildService();
  private readonly githubReadmeService = new GithubReadmeService();
  private readonly objectStore = new ObjectStoreService();
  private readonly projectService = new ProjectService();

  /**
   * Whether the typed form payload is sent as the Guild session's structured
   * `agent_input` instead of the default BFF-rendered text message. Default
   * OFF for the reason in the class note; flipped by the same environment
   * switch as the Message Foundation so both agents move together.
   */
  private get structuredAgentInputEnabled(): boolean {
    return process.env['GUILD_STRUCTURED_AGENT_INPUT'] === 'true';
  }

  /**
   * Start a one-shot form-mode generation session (fresh session for first
   * runs AND regenerations). Returns the session id — which the caller binds
   * to the requesting user via the owner token — together with the README
   * fetch outcome.
   *
   * The outcome travels back with the session because the README fetch is
   * part of composing THIS submission: by the time the document is polled it
   * is long settled, and a run that generated without a README must be able
   * to say so on the result rather than leave the user with an unexplained
   * thin document.
   */
  public async startGeneration(
    req: Request,
    answers: Record<string, string>,
    options: { feedback?: string; priorVersion?: number },
    guildAgentHandle: string
  ): Promise<IcpGenerationStart> {
    // Best-effort README fetch — by contract it can never fail the run.
    const readme = await this.githubReadmeService.fetchReadme(req, answers['github_url'] ?? '');
    if (!readme.outcome.fetched) {
      logger.warning(req, 'icp_generate', 'Generating without a README — the agent will mark README-dependent gaps TBD', {
        reason: readme.outcome.skipReason,
      });
    }

    const payload = buildIcpFormPayload(answers, {
      readmeMarkdown: readme.readme ?? undefined,
      feedback: options.feedback,
      priorVersion: options.priorVersion,
    });

    logger.debug(req, 'icp_generate', 'Composed ICP batch submission', {
      brand_kit_provided: payload.brand_kit_markdown !== undefined,
      message_foundation_provided: payload.message_foundation_markdown !== undefined,
      readme_provided: payload.readme_markdown !== undefined,
    });

    if (this.structuredAgentInputEnabled) {
      const sessionId = await this.guildService.createSession(req, { agentInput: payload, handle: guildAgentHandle });
      return { sessionId, readme: readme.outcome };
    }

    const sessionId = await this.guildService.createSession(req, { message: renderIcpFormText(payload), handle: guildAgentHandle });
    return { sessionId, readme: readme.outcome };
  }

  /**
   * Fetch the session's current result: `pending` until a valid envelope
   * appears in the event stream, then `ready` with the validated document and
   * (when the object-store write succeeds) its persistence receipt.
   *
   * `projectUid` is the LFX project the run is scoped to — it decides the
   * storage partition and is entitlement-checked before anything is written
   * (see {@link persistEnvelope}). It is resolved lazily, only once a ready
   * envelope exists, so a `pending` poll costs no upstream lookups. Without
   * it the document is still returned; it is simply not persisted.
   */
  public async getResult(req: Request, sessionId: string, projectUid?: string): Promise<IcpResultResponse> {
    const payloads = await this.guildService.getRawEventPayloads(req, sessionId);
    const envelope = this.findAuthoritativeEnvelope(req, payloads);

    if (!envelope) {
      return { status: 'pending' };
    }

    logger.info(req, 'icp_result', 'ICP document ready', {
      project: envelope.project,
      version: envelope.version,
      intake_mode: envelope.intake.mode,
      brand_kit_provided: envelope.inputs.brand_kit_provided,
      message_foundation_provided: envelope.inputs.message_foundation_provided,
      document_chars: envelope.document_markdown.length,
    });

    const persistence = await this.persistEnvelope(req, envelope, projectUid);

    return {
      status: 'ready',
      documentMarkdown: envelope.document_markdown,
      projectName: envelope.project_name,
      project: envelope.project,
      version: envelope.version,
      intakeMode: envelope.intake.mode,
      ...(persistence && { persistence }),
    };
  }

  /**
   * Persist the validated envelope's raw document bytes to the shared private
   * marketing artifacts bucket under the ICP key prefix. Idempotent under
   * polling — content-addressed keys make the repeat write a HEAD no-op, with
   * one deliberate exception: a strictly newer draft that reproduces an
   * already-stored document verbatim rewrites it, so the stored draft label
   * and store timestamp describe the latest draft that produced those bytes
   * rather than the first.
   *
   * WRITE BOUNDARY. The partition is the SERVER-RESOLVED LFX project uid and
   * the caller must hold that project's writer grant — the envelope's own
   * `project` slug is derived from the free-text project name and is never
   * trusted to address storage. That would both scatter documents into
   * partitions no read path lists and let any authenticated caller name their
   * way into another project's partition.
   *
   * Every reason not to write degrades identically: the document was already
   * fully validated, so the user still gets it; the receipt is simply omitted
   * (WARN says which reason). A storage failure is retried by the next poll.
   */
  private async persistEnvelope(req: Request, envelope: IcpEnvelope, projectUid?: string): Promise<MktgRunPersistReceipt | null> {
    const partition = await this.resolveWritablePartition(req, projectUid);
    if (!partition) {
      return null;
    }

    const documentBytes = Buffer.from(envelope.document_markdown, 'utf8');

    // Size gate (defense in depth — also checked byte-accurately by the shared
    // validator via TextEncoder before the envelope got here). Checked before
    // the operation starts so the log timeline stays balanced.
    if (documentBytes.length > ICP_MAX_DOCUMENT_BYTES) {
      logger.warning(req, 'icp_persist', 'Document exceeds the 20 MB object size cap — not persisted', {
        project: partition,
        bytes: documentBytes.length,
      });
      return null;
    }

    const startTime = logger.startOperation(req, 'icp_persist', { project: partition, version: envelope.version });
    try {
      // Key derived from the server-resolved partition plus validated envelope
      // fields only — the sha was recomputed against the document bytes in
      // findAuthoritativeEnvelope before selection.
      const key = buildIcpObjectKey(partition, envelope.content_sha256);

      // The draft version rides as object metadata so a future read path can
      // rebuild the receipt without re-parsing the envelope — content-addressed
      // keys carry only the sha.
      const written = await this.objectStore.putContentAddressedObject(
        req,
        'marketing-os-artifacts',
        key,
        documentBytes,
        'text/markdown; charset=utf-8',
        'private',
        { version: String(envelope.version) },
        // The bytes are immutable, but their metadata is not content: when a
        // later draft reproduces this document verbatim, the stored labels
        // still describe the draft that wrote it first. Strictly newer, never
        // equal, so the repeat write of every subsequent poll stays a
        // HEAD-only no-op and a draft label never moves backwards.
        { refreshMetadataWhen: (stored) => this.storedDraftVersion(stored) < envelope.version }
      );

      logger.success(req, 'icp_persist', startTime, { key, written, project: partition, version: envelope.version });

      return {
        s3_key: key,
        content_sha256: envelope.content_sha256,
        project: partition,
        version: envelope.version,
      };
    } catch (error) {
      // Deliberate degrade: surface the validated document even when storage is
      // down; the content-addressed write is retried on the next poll (the
      // client keeps polling while the receipt is missing). WARN, not ERROR —
      // graceful-degradation failures per logging-patterns.md, and the bucket
      // env var is intentionally absent in some deployed environments.
      logger.warning(req, 'icp_persist', 'Object-store write failed — returning document without a receipt; retried on next poll', {
        project: partition,
        version: envelope.version,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Resolve the storage partition a document may be written to: the LFX
   * project uid, as the PROJECTS SERVICE reports it, for a project the caller
   * holds the writer grant on. Null means "do not write" — no project scope, a
   * uid that is not one safe segment, an unresolvable uid, or a caller without
   * the writer grant.
   *
   * The CALLER'S raw uid is shape-gated before it is spent upstream:
   * `getProjectById` interpolates it unencoded into `/projects/{uid}`, so a
   * value carrying `/`, `?` or `#` could reshape the authenticated lookup whose
   * answer the writer check is read from. The resolved uid is gated again
   * below, because only that one becomes a storage key segment.
   *
   * Called only once a ready envelope exists, so `pending` polls (the vast
   * majority of a multi-minute generation) cost no upstream lookups.
   */
  private async resolveWritablePartition(req: Request, projectUid?: string): Promise<string | null> {
    const uid = projectUid?.trim();
    if (!uid) {
      logger.warning(req, 'icp_persist', 'No project scope on the result request — document returned but not persisted', {});
      return null;
    }
    if (!ICP_PROJECT_UID_REGEX.test(uid)) {
      logger.warning(req, 'icp_persist', 'Run project scope is not a single-segment project uid — not resolved, not persisted', {});
      return null;
    }

    try {
      // `access: true` annotates the caller's grants on the resolved project —
      // the same ProjectService + `project.writer` precedent the Brand Kit
      // write path and writer.guard use.
      const project = await this.projectService.getProjectById(req, uid, true);
      if (!project.writer) {
        logger.warning(req, 'icp_persist', 'Caller lacks the project writer grant — document returned but not persisted', { project: project.uid });
        return null;
      }
      if (!ICP_PROJECT_UID_REGEX.test(project.uid)) {
        logger.warning(req, 'icp_persist', 'Resolved project uid is not a valid storage partition — not persisted', { project: project.uid });
        return null;
      }
      return project.uid;
    } catch (error) {
      logger.warning(req, 'icp_persist', 'Could not resolve the run’s project — document returned without a receipt', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * The draft version an object's metadata reports. Anything unparseable
   * reports the documented default of 1, so this is safe to compare on the
   * write path: an unlabelled object is treated as the oldest possible draft,
   * never as a newer one.
   */
  private storedDraftVersion(metadata: Record<string, string>): number {
    const version = Number.parseInt(metadata['version'] ?? '', 10);
    if (!Number.isInteger(version) || version < 1) {
      return 1;
    }
    return version;
  }

  /**
   * Scan raw event payloads (chronologically ordered by the Guild service) for
   * envelope candidates and return the authoritative one: the highest
   * `version` among valid candidates, with the latest occurrence winning ties.
   * The sha256 integrity gate runs PER CANDIDATE, before version selection — a
   * newer candidate that fails the recompute must not shadow an older
   * hash-valid envelope.
   */
  private findAuthoritativeEnvelope(req: Request, payloads: string[]): IcpEnvelope | null {
    let best: IcpEnvelope | null = null;
    let candidateCount = 0;
    let invalidCount = 0;

    for (const payload of payloads) {
      for (const candidate of extractIcpEnvelopeCandidates(payload)) {
        candidateCount++;
        const result = validateIcpEnvelope(candidate);
        if (result.valid) {
          // Safe: validateIcpEnvelope passed every schema and structure gate.
          const envelope = candidate as IcpEnvelope;

          // Recompute the sha over the UTF-8 bytes and require equality —
          // envelope integrity rests wholly on the BFF. A mismatch
          // disqualifies THIS candidate only.
          const recomputedSha = createHash('sha256').update(Buffer.from(envelope.document_markdown, 'utf8')).digest('hex');
          if (recomputedSha !== envelope.content_sha256) {
            invalidCount++;
            logger.warning(req, 'icp_result', 'Envelope content_sha256 does not match the document bytes — discarding candidate', {
              expected: envelope.content_sha256,
              recomputed: recomputedSha,
            });
            continue;
          }

          if (!best || envelope.version >= best.version) {
            best = envelope;
          }
        } else {
          invalidCount++;
          logger.debug(req, 'icp_result', 'Rejected envelope candidate', { errors: result.errors });
        }
      }
    }

    logger.debug(req, 'icp_result', 'Envelope scan complete', {
      contract: ICP_CONTRACT_ID,
      events: payloads.length,
      candidates: candidateCount,
      invalid: invalidCount,
      found: !!best,
    });

    return best;
  }
}
