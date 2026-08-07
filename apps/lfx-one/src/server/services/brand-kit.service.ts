// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BrandKitEnvelope, BrandKitResultResponse } from '@lfx-one/shared/interfaces';
import { extractBrandKitEnvelopeCandidates, renderBrandKitFormMessage, validateBrandKitEnvelope } from '@lfx-one/shared/utils';
import { createHash } from 'node:crypto';
import { Request } from 'express';

import { logger } from './logger.service';
import { GuildService } from './guild.service';

/**
 * Brand Kit generation flow — agent invocation WITHOUT persistence (the
 * dec-brand-kit-storage-v1 write path is deferred; this service only drives
 * the session and surfaces the validated document for display).
 *
 * Flow: the one-page form answers are rendered into the agent's batch-intake
 * message (dec-brand-kit-intake-form) and submitted as a new Guild form-mode
 * session; the client then polls for the result. The authoritative typed
 * output is the `finalize_brand_kit` tool RESULT riding raw system events
 * (live-smoke A3 verdict) — the `__submit__`-ed text may be prose or abridged
 * and is never trusted. Every candidate envelope is schema-validated and the
 * document sha256 is recomputed server-side before anything reaches the user.
 */
export class BrandKitService {
  private readonly guildService = new GuildService();

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
   * appears in the event stream, then `ready` with the validated document.
   */
  public async getResult(req: Request, sessionId: string): Promise<BrandKitResultResponse> {
    const payloads = await this.guildService.getRawEventPayloads(req, sessionId);
    const envelope = this.findAuthoritativeEnvelope(req, payloads);

    if (!envelope) {
      return { status: 'pending' };
    }

    // Contract §3 step 2 (kept from the persistence path): recompute the sha
    // over the UTF-8 bytes and require equality — envelope integrity rests
    // wholly on the BFF (A2/A3 verdicts). A mismatch means the candidate is
    // not trustworthy; treat as still pending rather than surfacing bad data.
    const recomputedSha = createHash('sha256').update(Buffer.from(envelope.document_markdown, 'utf8')).digest('hex');
    if (recomputedSha !== envelope.content_sha256) {
      logger.warning(req, 'brand_kit_result', 'Envelope content_sha256 does not match the document bytes — discarding candidate', {
        expected: envelope.content_sha256,
        recomputed: recomputedSha,
      });
      return { status: 'pending' };
    }

    logger.info(req, 'brand_kit_result', 'Brand Kit document ready', {
      project: envelope.project,
      version: envelope.version,
      intake_mode: envelope.intake.mode,
      document_chars: envelope.document_markdown.length,
    });

    return {
      status: 'ready',
      documentMarkdown: envelope.document_markdown,
      projectName: envelope.project_name,
      project: envelope.project,
      version: envelope.version,
      intakeMode: envelope.intake.mode,
    };
  }

  /**
   * Scan raw event payloads (chronologically ordered by the Guild service)
   * for envelope candidates and return the authoritative one: the highest
   * `version` among valid candidates, with the latest occurrence winning ties
   * (later events supersede earlier drafts within a session).
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
          if (!best || candidate.version >= best.version) {
            best = candidate;
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
