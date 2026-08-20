// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_MESSAGE_CONTRACT_ID } from '@lfx-one/shared/constants';
import { FoundationMessageEnvelope, FoundationMessageResultResponse } from '@lfx-one/shared/interfaces';
import { buildFoundationMessageFormPayload, extractMktgEnvelopeCandidates, validateFoundationMessageEnvelope } from '@lfx-one/shared/utils';
import { createHash } from 'node:crypto';
import { Request } from 'express';

import { GithubReadmeService } from './github-readme.service';
import { GuildService } from './guild.service';
import { logger } from './logger.service';

/**
 * Message Foundation generation flow (message-foundation-output/v1), the
 * brand-kit flow's sibling with two twists:
 *
 * 1. The batch submission is the agent's typed
 *    `message_foundation_intake_form` payload sent as the Guild session's
 *    structured `agent_input` (the agent's own zod preprocess renders it) —
 *    not a BFF-rendered text message. The README is fetched server-side
 *    (the agent has no web access) and NEVER blocks the run: a failed fetch
 *    just omits `readme_markdown` and the agent marks gaps TBD.
 * 2. Regeneration is a full resubmit on a FRESH session: the payload carries
 *    `feedback` + `prior_version`, and the agent finalizes as
 *    `prior_version + 1` — which is exactly what the result poll's
 *    strictly-newer version gate accepts.
 *
 * The authoritative typed output is the `finalize_message_foundation` tool
 * RESULT riding raw system events (the brand-kit live-smoke A3 pattern).
 * Every candidate envelope is schema-validated and the document sha256 is
 * recomputed server-side before anything reaches the user.
 */
export class FoundationMessageService {
  private readonly guildService = new GuildService();
  private readonly githubReadmeService = new GithubReadmeService();

  /**
   * Start a one-shot form-mode generation session (fresh session for first
   * runs AND regenerations). Returns the session id; the caller binds it to
   * the requesting user via the owner token.
   */
  public async startGeneration(
    req: Request,
    answers: Record<string, string>,
    options: { feedback?: string; priorVersion?: number },
    guildAgentHandle: string
  ): Promise<string> {
    // Best-effort README fetch — by contract it can never fail the run.
    const readme = await this.githubReadmeService.fetchReadme(req, answers['github_url'] ?? '');

    const payload = buildFoundationMessageFormPayload(answers, {
      readmeMarkdown: readme ?? undefined,
      feedback: options.feedback,
      priorVersion: options.priorVersion,
    });

    // The typed form payload travels as the structured agent_input; the
    // catalog handle rides as the explicit agent_id (no @mention can be
    // prepended to a non-text input).
    return this.guildService.createSession(req, { agentInput: payload as unknown as Record<string, unknown>, handle: guildAgentHandle });
  }

  /**
   * Fetch the session's current result: `pending` until a valid envelope
   * appears in the event stream, then `ready` with the validated document
   * and its five word-count-locked derivatives.
   */
  public async getResult(req: Request, sessionId: string): Promise<FoundationMessageResultResponse> {
    const payloads = await this.guildService.getRawEventPayloads(req, sessionId);
    const envelope = this.findAuthoritativeEnvelope(req, payloads);

    if (!envelope) {
      return { status: 'pending' };
    }

    logger.info(req, 'foundation_message_result', 'Message Foundation document ready', {
      project: envelope.project,
      version: envelope.version,
      intake_mode: envelope.intake.mode,
      brand_kit_provided: envelope.inputs.brand_kit_provided,
      document_chars: envelope.document_markdown.length,
    });

    return {
      status: 'ready',
      documentMarkdown: envelope.document_markdown,
      version: envelope.version,
      derivatives: { ...envelope.derivatives },
      projectName: envelope.project_name,
      project: envelope.project,
      intakeMode: envelope.intake.mode,
    };
  }

  /**
   * Scan raw event payloads (chronologically ordered by the Guild service)
   * for envelope candidates and return the authoritative one: the highest
   * `version` among valid candidates, with the latest occurrence winning
   * ties. The sha256 integrity gate runs PER CANDIDATE, before version
   * selection — a newer candidate that fails the recompute must not shadow
   * an older hash-valid envelope.
   */
  private findAuthoritativeEnvelope(req: Request, payloads: string[]): FoundationMessageEnvelope | null {
    let best: FoundationMessageEnvelope | null = null;
    let candidateCount = 0;
    let invalidCount = 0;

    for (const payload of payloads) {
      for (const candidate of extractMktgEnvelopeCandidates(payload, FOUNDATION_MESSAGE_CONTRACT_ID)) {
        candidateCount++;
        const result = validateFoundationMessageEnvelope(candidate);
        if (result.valid) {
          // Safe: validateFoundationMessageEnvelope passed every schema gate.
          const envelope = candidate as FoundationMessageEnvelope;

          // Recompute the sha over the UTF-8 bytes and require equality —
          // envelope integrity rests wholly on the BFF. A mismatch
          // disqualifies THIS candidate only.
          const recomputedSha = createHash('sha256').update(Buffer.from(envelope.document_markdown, 'utf8')).digest('hex');
          if (recomputedSha !== envelope.content_sha256) {
            invalidCount++;
            logger.warning(req, 'foundation_message_result', 'Envelope content_sha256 does not match the document bytes — discarding candidate', {
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
          logger.debug(req, 'foundation_message_result', 'Rejected envelope candidate', { errors: result.errors });
        }
      }
    }

    logger.debug(req, 'foundation_message_result', 'Envelope scan complete', {
      events: payloads.length,
      candidates: candidateCount,
      invalid: invalidCount,
      found: !!best,
    });

    return best;
  }
}
