// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_MESSAGE_CONTRACT_ID, MKTG_ARTIFACT_SPECS } from '@lfx-one/shared/constants';
import {
  FoundationMessageEnvelope,
  FoundationMessageGenerationStart,
  FoundationMessagePersistReceipt,
  FoundationMessageResultResponse,
  FoundationMessageStoredResponse,
} from '@lfx-one/shared/interfaces';
import {
  buildFoundationMessageFormPayload,
  extractMktgEnvelopeCandidates,
  renderFoundationMessageFormText,
  validateFoundationMessageEnvelope,
} from '@lfx-one/shared/utils';
import { createHash } from 'node:crypto';
import { Request } from 'express';

import { GithubReadmeService } from './github-readme.service';
import { GuildService } from './guild.service';
import { logger } from './logger.service';
import { MktgArtifactService } from './mktg-artifact.service';

/**
 * Message Foundation generation flow (message-foundation-output/v1), the
 * brand-kit flow's sibling with two twists:
 *
 * 1. The batch submission is the agent's typed
 *    `message_foundation_intake_form` payload, transported by default as a
 *    BFF-rendered text message (`renderFoundationMessageFormText` — a
 *    verbatim mirror of the agent's own form renderer). Live-smoked
 *    2026-08-20: Guild coerces a structured `agent_input` to
 *    `{type:'text', text: JSON.stringify(payload)}` before the agent's zod
 *    preprocess runs, so sending the object raw feeds the model unrendered
 *    JSON; `GUILD_STRUCTURED_AGENT_INPUT=true` flips back to the structured
 *    transport without a redeploy once Guild passes objects through. The
 *    README is fetched server-side (the agent has no web access) and NEVER
 *    blocks the run: a failed fetch just omits `readme_markdown` and the
 *    agent marks gaps TBD.
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
   * The SHARED agent-artifact persistence layer (the Brand Kit's write and
   * read path, generalized). This service supplies only the Message
   * Foundation's artifact spec and envelope; the entitlement boundary, key
   * layout, size gate, metadata refresh rule and degrade-to-null semantics all
   * live there.
   */
  private readonly artifactService = new MktgArtifactService();

  /** Message Foundation knobs for the shared persistence layer: key prefix, size cap, log namespace. */
  private readonly artifactSpec = MKTG_ARTIFACT_SPECS['foundation-message'];

  /**
   * Whether the typed form payload is sent as the Guild session's structured
   * `agent_input` instead of the default BFF-rendered text message. Default
   * OFF: the live smoke (2026-08-20) showed Guild coercing structured inputs
   * to `{type:'text', text:JSON.stringify(payload)}` before the agent's
   * preprocess, bypassing its form renderer. Flip to `true` without a
   * redeploy once Guild delivers structured inputs verbatim.
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
  ): Promise<FoundationMessageGenerationStart> {
    // Best-effort README fetch — by contract it can never fail the run.
    const readme = await this.githubReadmeService.fetchReadme(req, answers['github_url'] ?? '');
    if (!readme.outcome.fetched) {
      logger.warning(req, 'foundation_message_generate', 'Generating without a README — the agent will mark README-dependent gaps TBD', {
        reason: readme.outcome.skipReason,
      });
    }

    const payload = buildFoundationMessageFormPayload(answers, {
      readmeMarkdown: readme.readme ?? undefined,
      feedback: options.feedback,
      priorVersion: options.priorVersion,
    });

    // Structured transport (flag-gated): the typed payload travels as the
    // Guild agent_input verbatim; the handle rides only as the explicit
    // agent_id (no @mention can be prepended to a non-text input).
    if (this.structuredAgentInputEnabled) {
      const sessionId = await this.guildService.createSession(req, { agentInput: payload, handle: guildAgentHandle });
      return { sessionId, readme: readme.outcome };
    }

    // Default: render the agent's own form-mode message text (verbatim
    // mirror of its renderFormMessage) and ride the known-good text
    // transport — @handle prepend AND explicit agent_id, belt and braces.
    const sessionId = await this.guildService.createSession(req, { message: renderFoundationMessageFormText(payload), handle: guildAgentHandle });
    return { sessionId, readme: readme.outcome };
  }

  /**
   * Fetch the session's current result: `pending` until a valid envelope
   * appears in the event stream, then `ready` with the validated document,
   * its five word-count-locked derivatives and (when the object-store write
   * succeeds) its persistence receipt.
   *
   * `projectUid` is the LFX project the run is scoped to — it decides the
   * storage partition and is entitlement-checked before anything is written
   * (see {@link persistEnvelope}). It is resolved lazily, only once a ready
   * envelope exists, so a `pending` poll costs no upstream lookups. Without
   * it the document is still returned; it is simply not persisted.
   */
  public async getResult(req: Request, sessionId: string, projectUid?: string): Promise<FoundationMessageResultResponse> {
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

    const persistence = await this.persistEnvelope(req, envelope, projectUid);

    return {
      status: 'ready',
      documentMarkdown: envelope.document_markdown,
      version: envelope.version,
      derivatives: { ...envelope.derivatives },
      projectName: envelope.project_name,
      project: envelope.project,
      intakeMode: envelope.intake.mode,
      ...(persistence && { persistence }),
    };
  }

  /**
   * Fetch the project's LATEST persisted Message Foundation document from the
   * content-addressed partition `foundation-message/{project uid}/` — the
   * dec-agent-dependency-gating read path that lets a dependent agent (or any
   * other browser, or any other entitled user) reach a Message Foundation it
   * did not generate. Delegated verbatim to the shared agent-artifact layer:
   * newest by store write time, each candidate's bytes re-hashed against its
   * content-addressed key before it can be served, and a storage failure
   * degraded to null at WARN.
   */
  public async getStoredFoundationMessage(req: Request, project: string): Promise<FoundationMessageStoredResponse | null> {
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
   * slug is derived from a free-text project name and is never trusted to
   * address storage). Every refusal and every storage failure degrades to null
   * at WARN — the document still reaches the user, without a receipt, and the
   * next poll retries the idempotent write.
   */
  private async persistEnvelope(req: Request, envelope: FoundationMessageEnvelope, projectUid?: string): Promise<FoundationMessagePersistReceipt | null> {
    return this.artifactService.persist(req, this.artifactSpec, envelope, projectUid);
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
