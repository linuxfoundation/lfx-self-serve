// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_CONTRACT_ID, BRAND_KIT_FINALIZE_TOOL, MKTG_ARTIFACT_SPECS } from '@lfx-one/shared/constants';
import {
  BrandKitEnvelope,
  BrandKitLogoFile,
  BrandKitPersistReceipt,
  BrandKitResultResponse,
  BrandKitStoredResponse,
  MktgRunAnswer,
  MktgRunQuestion,
  MktgRevisionRef,
} from '@lfx-one/shared/interfaces';
import {
  brandKitQuestionsId,
  brandKitRevisionOf,
  buildBrandKitFormPayload,
  buildMktgRunActivity,
  extractBrandKitQuestions,
  extractBrandKitRefusal,
  extractMktgAgentTexts,
  extractMktgEnvelopeCandidates,
  extractMktgToolResults,
  renderBrandKitAnswersText,
  renderBrandKitFormText,
  validateBrandKitEnvelope,
} from '@lfx-one/shared/utils';
import { createHash } from 'node:crypto';
import { Request } from 'express';

import { GuildService } from './guild.service';
import { logger } from './logger.service';
import { MktgDocumentStoreService } from './mktg-document-store.service';

/**
 * Brand Kit generation flow (brand-kit-output/v2; Guild
 * linux-foundation~brand-kit 2.1.0).
 *
 * 1. The form travels as the one rendered text message the agent parses
 *    back (`renderBrandKitFormText`, a mirror of its renderer;
 *    dec-qa-form-path-only): the project, the website and the brand page as
 *    links the agent reads itself, the notes, and the uploaded logo files —
 *    an SVG as its text, a PNG or a ZIP as its base64 bytes, a link as the
 *    URL the agent fetches — and the project's messaging framework as its
 *    JSON (the run page attaches approved current; the controller validates
 *    the supplied JSON, without rechecking approval; the Voice chapter comes from it and nothing is
 *    drafted from the site in its place), in the shape the agent reads
 *    (brand-kit-output.md §2a). The agent inspects the artwork, reads the
 *    site's CSS and the brand page, and sources every colour. A run the
 *    agent refuses up front — no framework, or a JSON that is not one (§2d)
 *    — ends in one plain-text reply, which `getResult` reports as `refused`:
 *    the session is over, and the reply is the run's outcome.
 * 2. It then asks only the gaps it could not settle — a text turn carrying
 *    the brand-kit-questions/v1 block (the logo files when none were
 *    uploaded, the colours, the typeface). `getResult` reports it
 *    as `questions`; the answers come back through `sendAnswers` as the
 *    brand-kit-answers/v1 turn on the SAME session, and the run polls on.
 * 3. The authoritative output is the finalize tool RESULT riding raw session
 *    events. Every candidate is schema-validated and its document sha256
 *    recomputed before anything reaches the user; the validated envelope is
 *    stored as a revision of the project's Brand Kit document (the envelope's
 *    kit, chapters and report ride the revision's sidecar, its Markdown
 *    rendering is the document sibling agents attach), and the page gets the
 *    kit to render.
 *
 * Who wrote what matters here: the agent fetches the requester's links and
 * every page it reads comes back as a tool result in the same event stream.
 * A questions block is therefore taken only from the agent's own text turns
 * and an envelope only from the finalize tool's results — never from
 * whatever string in a payload happens to carry a contract id.
 */
export class BrandKitService {
  private readonly guildService = new GuildService();

  /**
   * The Marketing OS document store over the SHARED agent-artifact
   * persistence layer: every validated kit is written through the artifact
   * layer and recorded as a revision of the project's Brand Kit document,
   * whose approved current is what plain and sidecar stored reads serve.
   */
  private readonly documentStore = new MktgDocumentStoreService();

  /** Brand Kit knobs for the shared persistence layer: key prefix, size cap, log namespace. */
  private readonly artifactSpec = MKTG_ARTIFACT_SPECS['brand-kit'];

  /** Structured `agent_input` transport, default OFF (Guild coerces objects to JSON text before the agent's preprocess). */
  private get structuredAgentInputEnabled(): boolean {
    return process.env['GUILD_STRUCTURED_AGENT_INPUT'] === 'true';
  }

  /**
   * Start a draft on a fresh session. Returns the session id, which the
   * caller binds to the requesting user via the owner token. The LFX project
   * uid rides the form for the agent's own LFX lookups.
   */
  public async startGeneration(
    req: Request,
    answers: Record<string, string>,
    logoFiles: BrandKitLogoFile[],
    projectUid: string | undefined,
    guildAgentHandle: string,
    expectedFramework?: MktgRevisionRef
  ): Promise<string> {
    const payload = buildBrandKitFormPayload(answers, { logoFiles, projectUid });

    logger.info(req, 'brand_kit_generate', 'Composed the Brand Kit intake', {
      has_brand_page: !!payload.brand_page_url,
      has_notes: !!payload.notes,
      has_framework: !!payload.messaging_framework,
      logo_files: logoFiles.length,
      logo_files_as_text: logoFiles.filter((file) => file.text !== undefined).length,
      logo_files_as_bytes: logoFiles.filter((file) => file.base64 !== undefined).length,
      logo_files_as_links: logoFiles.filter((file) => file.url !== undefined).length,
      has_project: !!projectUid,
    });

    const framework = await this.documentStore.captureFramework(req, projectUid, payload.messaging_framework, expectedFramework);
    const sessionId = await (this.structuredAgentInputEnabled
      ? this.guildService.createSession(req, { agentInput: payload, handle: guildAgentHandle })
      : this.guildService.createSession(req, { message: renderBrandKitFormText(payload), handle: guildAgentHandle }));
    await this.documentStore.rememberGenerationFramework(req, this.artifactSpec.agentKey, projectUid, sessionId, framework);
    return sessionId;
  }

  /**
   * Send the requester's answers to the session's questions turn as the
   * brand-kit-answers/v1 turn, on the SAME session (the agent's research and
   * questions live there). The owner-token check is the controller's.
   */
  public async sendAnswers(req: Request, sessionId: string, answers: MktgRunAnswer[], guildAgentHandle: string): Promise<void> {
    logger.info(req, 'brand_kit_answers', 'Sending the answers turn', {
      answers: answers.length,
      keys: answers.map((answer) => answer.key),
      origins: answers.map((answer) => answer.origin),
    });
    await this.guildService.sendFollowUp(req, sessionId, { message: renderBrandKitAnswersText(answers), handle: guildAgentHandle });
  }

  /**
   * Fetch the session's current result: `ready` once a valid envelope appears
   * in the event stream, with the kit the page renders, the Markdown
   * rendering the store keeps and (when the write succeeded) the persistence
   * receipt of the stored revision; `questions` whenever the session holds a
   * questions block and no valid envelope yet — the LATEST block the agent
   * wrote, reported on every poll until a newer block or the envelope
   * appears, with a `questionsId` so the run shell ignores the block it
   * already answered; `refused` when the agent ended the session with its
   * refusal reply instead of running (brand-kit-output.md §2d), the reply
   * as the requester reads it; `pending` otherwise. `projectUid` decides the storage
   * partition and is entitlement-checked before anything is written; without
   * it the kit is still returned, just not stored.
   */
  public async getResult(req: Request, sessionId: string, projectUid?: string): Promise<BrandKitResultResponse> {
    const payloads = await this.guildService.getRawEventPayloads(req, sessionId);
    const envelope = this.findAuthoritativeEnvelope(req, payloads);
    // What the agent has done so far, in plain sentences, for the run page's live feed — on every status.
    const activity = buildMktgRunActivity(payloads);

    if (!envelope) {
      const questions = this.findLatestQuestions(req, payloads);
      if (questions) {
        return { status: 'questions', questions, questionsId: brandKitQuestionsId(questions), activity };
      }
      const reply = this.findRefusal(req, payloads);
      if (reply) {
        return { status: 'refused', reply, activity };
      }
      return { status: 'pending', activity };
    }

    logger.info(req, 'brand_kit_result', 'Brand Kit ready', {
      project: envelope.project,
      version: envelope.version,
      mode: envelope.mode,
      agent_version: envelope.agent.agent_version,
      colors: envelope.kit.colors.length,
      logo_placeholder: envelope.chapters.logo.placeholder,
      gaps: envelope.report.gaps.length,
      document_chars: envelope.document_markdown.length,
    });

    const persistence = await this.persistEnvelope(req, envelope, sessionId, projectUid);

    return {
      status: 'ready',
      documentMarkdown: envelope.document_markdown,
      version: envelope.version,
      projectName: envelope.project_name,
      project: envelope.project,
      brandKit: brandKitRevisionOf(envelope),
      activity,
      ...(persistence && { persistence }),
    };
  }

  /**
   * Approved current supplies plain and sidecar branding reads, or null
   * when no approved selection exists. The sidecar carries kit tokens,
   * chapters and artwork. Only true pre-revision plain fallback remains.
   */
  public async getStoredBrandKit(req: Request, project: string, withSidecar = false): Promise<BrandKitStoredResponse | null> {
    return this.documentStore.readLatest(req, this.artifactSpec, project, { withSidecar });
  }

  /**
   * The latest questions block the AGENT wrote in the session, when there is
   * one: the raw payloads are chronological and so are the agent's texts
   * within each, so the last block found is the latest. Only the agent's own
   * text turns are read — never a tool result, where a fetched page could
   * plant a block, and never a user event, which `getRawEventPayloads` drops.
   */
  private findLatestQuestions(req: Request, payloads: string[]): MktgRunQuestion[] | null {
    let latest: MktgRunQuestion[] | null = null;
    for (const payload of payloads) {
      for (const text of extractMktgAgentTexts(payload)) {
        latest = extractBrandKitQuestions(text) ?? latest;
      }
    }
    if (latest) {
      logger.debug(req, 'brand_kit_result', 'The agent is asking questions', { questions: latest.length, keys: latest.map((question) => question.key) });
    }
    return latest;
  }

  /**
   * The agent's refusal reply, when the session holds one (brand-kit 2.1.0
   * refuses a run with no messaging framework, or a JSON that is not one, up
   * front — brand-kit-output.md §2d): the only text the agent writes then,
   * read from its own text turns like the questions block, never from a
   * tool result. Null while the agent is running or asking.
   */
  private findRefusal(req: Request, payloads: string[]): string | null {
    for (const payload of payloads) {
      for (const text of extractMktgAgentTexts(payload)) {
        const reply = extractBrandKitRefusal(text);
        if (reply) {
          logger.info(req, 'brand_kit_result', 'The agent refused the run', { reply_chars: reply.length });
          return reply;
        }
      }
    }
    return null;
  }

  /**
   * Persist the validated envelope and record it as a new revision of the
   * project's Brand Kit document. Every refusal and storage failure degrades
   * to null at WARN — the kit still reaches the user, without a receipt, and
   * the next poll retries the idempotent write.
   */
  private async persistEnvelope(req: Request, envelope: BrandKitEnvelope, sessionId: string, projectUid?: string): Promise<BrandKitPersistReceipt | null> {
    return this.documentStore.persistGeneration(req, this.artifactSpec, envelope, projectUid, sessionId);
  }

  /**
   * The authoritative envelope of the session: the LATEST valid result of the
   * agent's finalize tool (`finalize_brand_kit`), read only from that tool's
   * result events. The raw payloads are chronological, so a later valid
   * finalize (the agent fixed a gate failure and finalized again) supersedes
   * an earlier one; the envelope's self-declared `version` plays no part in
   * the choice. The sha256 integrity gate runs PER CANDIDATE — a later
   * candidate that fails the recompute does not shadow an earlier valid one.
   */
  private findAuthoritativeEnvelope(req: Request, payloads: string[]): BrandKitEnvelope | null {
    let latest: BrandKitEnvelope | null = null;
    let candidateCount = 0;
    let invalidCount = 0;

    for (const payload of payloads) {
      for (const resultText of extractMktgToolResults(payload, BRAND_KIT_FINALIZE_TOOL)) {
        for (const candidate of extractMktgEnvelopeCandidates(resultText, BRAND_KIT_CONTRACT_ID)) {
          candidateCount++;
          const result = validateBrandKitEnvelope(candidate);
          if (!result.valid) {
            invalidCount++;
            logger.debug(req, 'brand_kit_result', 'Rejected envelope candidate', { errors: result.errors });
            continue;
          }
          // Safe: validateBrandKitEnvelope passed every schema gate.
          const envelope = candidate as BrandKitEnvelope;
          const recomputedSha = createHash('sha256').update(Buffer.from(envelope.document_markdown, 'utf8')).digest('hex');
          if (recomputedSha !== envelope.content_sha256) {
            invalidCount++;
            logger.warning(req, 'brand_kit_result', 'Envelope content_sha256 does not match the document bytes — discarding candidate', {
              expected: envelope.content_sha256,
              recomputed: recomputedSha,
            });
            continue;
          }
          latest = envelope;
        }
      }
    }

    logger.debug(req, 'brand_kit_result', 'Envelope scan complete', {
      events: payloads.length,
      candidates: candidateCount,
      invalid: invalidCount,
      found: !!latest,
    });

    return latest;
  }
}
