// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_MAX_DOCUMENT_BYTES } from '@lfx-one/shared/constants';
import { BrandKitEnvelope, BrandKitPersistReceipt, BrandKitResultResponse } from '@lfx-one/shared/interfaces';
import { buildBrandKitObjectKey, extractBrandKitEnvelopeCandidates, renderBrandKitFormMessage, validateBrandKitEnvelope } from '@lfx-one/shared/utils';
import { createHash } from 'node:crypto';
import { Request } from 'express';

import { GuildService } from './guild.service';
import { logger } from './logger.service';
import { ObjectStoreService } from './object-store.service';

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
 * `brand-kit/{project}/{content_sha256}.md`. All graph writes stay deferred
 * (wi-lfx-one-service-actor): the response carries a receipt with exactly the
 * fields needed for later Artifact minting.
 */
export class BrandKitService {
  private readonly guildService = new GuildService();
  private readonly objectStore = new ObjectStoreService();

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
   */
  public async getResult(req: Request, sessionId: string): Promise<BrandKitResultResponse> {
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

    const persistence = await this.persistEnvelope(req, envelope);

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
   * marketing artifacts bucket (contract §3 steps 4–5: size gate, key derived
   * from validated fields only). Idempotent under polling — content-addressed
   * keys make the repeat write a HEAD no-op.
   *
   * A persistence failure degrades gracefully: the document was already fully
   * validated, so the user still gets it; the receipt is simply omitted and
   * the next poll retries the write.
   */
  private async persistEnvelope(req: Request, envelope: BrandKitEnvelope): Promise<BrandKitPersistReceipt | null> {
    const documentBytes = Buffer.from(envelope.document_markdown, 'utf8');

    // Size gate (defense in depth — also checked byte-accurately by the
    // shared validator via TextEncoder before the envelope got here). Checked
    // before the operation starts so the log timeline stays balanced.
    if (documentBytes.length > BRAND_KIT_MAX_DOCUMENT_BYTES) {
      logger.warning(req, 'brand_kit_persist', 'Document exceeds the 20 MB object size cap — not persisted', {
        project: envelope.project,
        bytes: documentBytes.length,
      });
      return null;
    }

    const startTime = logger.startOperation(req, 'brand_kit_persist', { project: envelope.project, version: envelope.version });
    try {
      // Key derived from validated fields only — the sha was recomputed against
      // the document bytes in findAuthoritativeEnvelope before selection.
      const key = buildBrandKitObjectKey(envelope.project, envelope.content_sha256);

      const written = await this.objectStore.putObjectIfAbsent(req, 'marketing-os-artifacts', key, documentBytes, 'text/markdown; charset=utf-8', 'private');

      logger.success(req, 'brand_kit_persist', startTime, {
        key,
        written,
        project: envelope.project,
        version: envelope.version,
        intake_mode: envelope.intake.mode,
      });

      return {
        s3_key: key,
        content_sha256: envelope.content_sha256,
        project: envelope.project,
        version: envelope.version,
        intake_mode: envelope.intake.mode,
      };
    } catch (error) {
      // Deliberate degrade: surface the validated document even when storage is
      // down; the content-addressed write is retried on the next poll.
      logger.error(req, 'brand_kit_persist', startTime, error, { project: envelope.project, version: envelope.version });
      return null;
    }
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
