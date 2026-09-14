// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ARTIFACT_SPECS } from '@lfx-one/shared/constants';
import { BrandKitEnvelope, BrandKitPersistReceipt, BrandKitResultResponse, BrandKitStoredResponse } from '@lfx-one/shared/interfaces';
import { extractBrandKitEnvelopeCandidates, renderBrandKitFormMessage, validateBrandKitEnvelope } from '@lfx-one/shared/utils';
import { createHash } from 'node:crypto';
import { Request } from 'express';

import { GuildService } from './guild.service';
import { logger } from './logger.service';
import { MktgArtifactService } from './mktg-artifact.service';

/**
 * Brand Kit generation flow — the BFF drives the Guild session, validates the
 * typed output, and persists the validated document to versioned object
 * storage (the dec-brand-kit-storage-v2 write path).
 *
 * Flow: the one-page form answers are rendered into the agent's batch-intake
 * message (dec-brand-kit-intake-form) and submitted as a new Guild form-mode
 * session; the client then polls for the result. The authoritative typed
 * output is the `finalize_brand_kit` tool RESULT riding raw system events
 * (live-smoke A3 verdict) — the `__submit__`-ed text may be prose or abridged
 * and is never trusted. Every candidate envelope is schema-validated and the
 * document sha256 is recomputed server-side before anything reaches the user.
 *
 * On a ready result the raw `document_markdown` bytes are written to the
 * shared private marketing artifacts bucket under the content-addressed key
 * `brand-kit/{project}/{content_sha256}.md`, where `{project}` is the
 * SERVER-RESOLVED LFX project uid the caller holds the writer grant on — the
 * same identifier the stored-document read path lists. All graph writes stay
 * deferred (wi-lfx-one-service-actor): the response carries a receipt with
 * exactly the fields needed for later Artifact minting.
 */
export class BrandKitService {
  private readonly guildService = new GuildService();

  /**
   * The SHARED agent-artifact persistence layer — the Brand Kit's own write
   * and read path, generalized so every Marketing OS agent uses one
   * implementation. This service supplies only the Brand Kit's artifact spec
   * and envelope; the entitlement boundary, key layout, size gate, metadata
   * refresh rule and degrade-to-null semantics all live there.
   */
  private readonly artifactService = new MktgArtifactService();

  /** Brand Kit knobs for the shared persistence layer: key prefix, size cap, log namespace. */
  private readonly artifactSpec = MKTG_ARTIFACT_SPECS['brand-kit'];

  /**
   * Start a one-shot form-mode generation session. Returns the session id;
   * the caller binds it to the requesting user via the owner token.
   */
  public async startGeneration(req: Request, answers: Record<string, string>, guildAgentHandle: string): Promise<string> {
    const message = renderBrandKitFormMessage(answers);
    return this.guildService.createSession(req, { message, handle: guildAgentHandle });
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
  public async getResult(req: Request, sessionId: string, projectUid?: string): Promise<BrandKitResultResponse> {
    const payloads = await this.guildService.getRawEventPayloads(req, sessionId);
    const envelope = this.findAuthoritativeEnvelope(req, payloads);

    if (!envelope) {
      return { status: 'pending' };
    }

    logger.info(req, 'brand_kit_result', 'Brand Kit document ready', {
      project: envelope.project,
      version: envelope.version,
      intake_mode: envelope.intake.mode,
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
   * Fetch the project's LATEST persisted Brand Kit document from the
   * content-addressed partition `brand-kit/{project uid}/` (the
   * dec-agent-dependency-gating read path). Delegated verbatim to the shared
   * agent-artifact layer: newest by store write time, each candidate's bytes
   * re-hashed against its content-addressed key before it can be served, and a
   * storage failure degraded to null at WARN — see
   * {@link MktgArtifactService.readLatest} for why store write time, not the
   * envelope `version`, is the ordering signal.
   */
  public async getStoredBrandKit(req: Request, project: string): Promise<BrandKitStoredResponse | null> {
    return this.artifactService.readLatest(req, this.artifactSpec, project);
  }

  /**
   * Persist the validated envelope's raw document bytes through the shared
   * agent-artifact layer. The envelope is passed only after
   * {@link findAuthoritativeEnvelope} has schema-validated it AND recomputed
   * its `content_sha256` against the document bytes — the storage layer
   * addresses objects by that sha and does not re-derive it.
   *
   * `projectUid` is the run's LFX project scope, untrusted: the shared layer
   * resolves it server-side and requires the caller's writer grant before the
   * document can enter that project's partition (the envelope's own `project`
   * slug is never trusted to address storage). Every refusal and every storage
   * failure degrades to null at WARN — the document still reaches the user,
   * without a receipt, and the next poll retries the idempotent write.
   */
  private async persistEnvelope(req: Request, envelope: BrandKitEnvelope, projectUid?: string): Promise<BrandKitPersistReceipt | null> {
    return this.artifactService.persist(req, this.artifactSpec, envelope, projectUid);
  }

  /**
   * Scan raw event payloads (chronologically ordered by the Guild service)
   * for envelope candidates and return the authoritative one: the highest
   * `version` among valid candidates, with the latest occurrence winning ties
   * (later events supersede earlier drafts within a session).
   *
   * The sha256 integrity gate runs PER CANDIDATE, before version selection —
   * a newer candidate that fails the recompute must not shadow an older
   * hash-valid envelope (it is simply not a valid candidate).
   */
  private findAuthoritativeEnvelope(req: Request, payloads: string[]): BrandKitEnvelope | null {
    let best: BrandKitEnvelope | null = null;
    let candidateCount = 0;
    let invalidCount = 0;

    for (const payload of payloads) {
      for (const candidate of extractBrandKitEnvelopeCandidates(payload)) {
        candidateCount++;
        const result = validateBrandKitEnvelope(candidate);
        if (result.valid) {
          // Safe: validateBrandKitEnvelope passed every schema gate.
          const envelope = candidate as BrandKitEnvelope;

          // Contract §3 step 2 (kept from the persistence path): recompute the
          // sha over the UTF-8 bytes and require equality — envelope integrity
          // rests wholly on the BFF (A2/A3 verdicts). A mismatch disqualifies
          // THIS candidate only; older hash-valid envelopes stay eligible.
          const recomputedSha = createHash('sha256').update(Buffer.from(envelope.document_markdown, 'utf8')).digest('hex');
          if (recomputedSha !== envelope.content_sha256) {
            invalidCount++;
            logger.warning(req, 'brand_kit_result', 'Envelope content_sha256 does not match the document bytes — discarding candidate', {
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
          logger.debug(req, 'brand_kit_result', 'Rejected envelope candidate', { errors: result.errors });
        }
      }
    }

    logger.debug(req, 'brand_kit_result', 'Envelope scan complete', {
      events: payloads.length,
      candidates: candidateCount,
      invalid: invalidCount,
      found: !!best,
    });

    return best;
  }
}
