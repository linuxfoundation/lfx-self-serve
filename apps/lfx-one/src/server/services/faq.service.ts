// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FAQ_CONTRACT_ID, FAQ_FINALIZE_TOOL, MKTG_ARTIFACT_SPECS } from '@lfx-one/shared/constants';
import {
  FaqEnvelope,
  FaqResultResponse,
  FaqSessionOutcome,
  MktgArtifactPersistReceipt,
  MktgIntakeDocument,
  MktgGenerationAttribution,
  MktgRunAnswer,
  MktgRevisionRef,
} from '@lfx-one/shared/interfaces';
import {
  buildFaqFormPayload,
  buildMktgRunActivity,
  extractFaqQuestions,
  extractFaqRefusal,
  extractMktgCurrentTurnAgentTexts,
  extractMktgEnvelopeCandidates,
  extractMktgCurrentTurnToolResults,
  faqAsset,
  faqContentJson,
  foundationMessageQuestionsId,
  renderFaqAnswersText,
  renderFaqFormText,
  toFaqFormDocument,
  validateFaqEnvelope,
  validateMktgRedraftResult,
} from '@lfx-one/shared/utils';
import { createHash } from 'node:crypto';
import { Request } from 'express';

import { GuildService } from './guild.service';
import { logger } from './logger.service';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { MktgDocumentCommentsService } from './mktg-document-comments.service';

/**
 * FAQ generation flow (faq-output/v1; Guild linux-foundation~faq 1.0.0).
 *
 * 1. The form travels as the one rendered text message the agent parses back
 *    (`renderFaqFormText`, a mirror of its renderer; dec-qa-form-path-only):
 *    the project, the website and the repository as links the agent reads
 *    itself, the notes, the documents — an upload as the text the BFF read
 *    from it, a link as its URL, each tagged — and the project's approved
 *    messaging framework, unwrapped to its content (the run page attaches the
 *    latest stored revision; the controller requires it, since the agent
 *    refuses a run without one).
 * 2. After reading and researching, the agent may ask the questions the
 *    sources leave open — a text turn carrying the faq-questions/v1 block.
 *    `getResult` reports it as `questions`; the answers come back through
 *    `sendAnswers` as the faq-answers/v1 turn on the SAME session, and the
 *    run polls on.
 * 3. The authoritative output is the finalize tool RESULT riding raw session
 *    events. Every candidate is schema-validated and its content sha256
 *    recomputed over `JSON.stringify(content)` before anything reaches the
 *    user; the validated FAQ is stored as a revision of the project's FAQ
 *    document — the JSON content as the revision's content, the rest of the
 *    envelope (the report, the checks with the unanswered questions) as its
 *    sidecar.
 *
 * A run can also end on a reply instead of an FAQ — the refusal of a run
 * without an approved framework, or the reply of a draft that never passed
 * its checks (faq-output.md §2d, §2e). `getResult` reports it as `refused`:
 * the session is over, the reply is the run's outcome, nothing is stored.
 *
 * Who wrote what matters here: every page the agent fetches comes back as a
 * tool result in the same event stream, so a questions block or a reply is
 * taken only from the agent's own text turns and an envelope only from the
 * finalize tool's current-turn results (`extractMktgCurrentTurnAgentTexts`, `extractMktgCurrentTurnToolResults`).
 */
export class FaqService {
  private readonly guildService = new GuildService();

  /** The Marketing OS document store: every validated FAQ is recorded as a revision of the project's FAQ document. */
  private readonly documentStore: MktgDocumentStoreService;
  private readonly comments = new MktgDocumentCommentsService();

  /** The FAQ knobs for the shared persistence layer: key prefix, size cap, log namespace. */
  private readonly artifactSpec = MKTG_ARTIFACT_SPECS['faq'];

  public constructor(attribution?: MktgGenerationAttribution) {
    this.documentStore = new MktgDocumentStoreService(attribution);
  }

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
    documents: MktgIntakeDocument[],
    projectUid: string | undefined,
    guildAgentHandle: string,
    expectedFramework?: MktgRevisionRef
  ): Promise<string> {
    const payload = buildFaqFormPayload(answers, { documents: documents.map((document) => toFaqFormDocument(document)), projectUid });

    const composedDocuments = payload.documents ?? [];
    logger.info(req, 'faq_generate', 'Composed the FAQ intake', {
      has_website: !!payload.website_url,
      links: payload.links?.length ?? 0,
      documents: composedDocuments.length,
      documents_read: composedDocuments.filter((document) => document.text !== undefined).length,
      document_kinds: composedDocuments.map((document) => document.kind),
      has_notes: !!payload.notes,
      has_framework: !!payload.messaging_framework,
      has_project: !!projectUid,
    });

    const framework = await this.documentStore.captureFramework(req, projectUid, payload.messaging_framework, expectedFramework);
    const sessionId = await (this.structuredAgentInputEnabled
      ? this.guildService.createSession(req, { agentInput: payload, handle: guildAgentHandle })
      : this.guildService.createSession(req, { message: renderFaqFormText(payload), handle: guildAgentHandle }));
    await this.documentStore.rememberGenerationFramework(req, this.artifactSpec.agentKey, projectUid, sessionId, framework);
    return sessionId;
  }

  /**
   * Send the requester's answers to the session's questions turn as the
   * faq-answers/v1 turn, on the SAME session (the agent's research and
   * questions live there). The owner-token check is the controller's.
   */
  public async sendAnswers(req: Request, sessionId: string, answers: MktgRunAnswer[], guildAgentHandle: string): Promise<void> {
    logger.info(req, 'faq_answers', 'Sending the answers turn', {
      answers: answers.length,
      keys: answers.map((answer) => answer.key),
      origins: answers.map((answer) => answer.origin),
    });
    await this.guildService.sendFollowUp(req, sessionId, { message: renderFaqAnswersText(answers), handle: guildAgentHandle });
  }

  /**
   * Fetch the session's current result: `ready` once a valid envelope appears
   * in the event stream, with the FAQ as the run's asset and (when the write
   * succeeded) the persistence receipt of the stored revision; otherwise what
   * the agent's LATEST own text says — `questions` (with a `questionsId`, so
   * the run shell ignores the block it already answered while the agent works
   * on the answers) or `refused` (the reply that ended the run); `pending`
   * when it said neither. `projectUid` decides the storage partition and is
   * entitlement-checked before anything is written; without it the FAQ is
   * still returned, just not stored. Bound redrafts must match their frozen
   * scope and comment echoes; a mismatched result fails and reopens its threads
   * before persistence rather than reporting an unstorable asset as ready.
   */
  public async getResult(req: Request, sessionId: string, projectUid?: string): Promise<FaqResultResponse> {
    const context = await this.documentStore.assertRedraftScope(req, this.artifactSpec, sessionId, projectUid);
    const payloads = await this.guildService.getRawEventPayloads(req, sessionId);
    const envelope = this.findAuthoritativeEnvelope(req, payloads);
    // What the agent has done so far, in plain sentences, for the run page's live feed — on every status.
    const activity = buildMktgRunActivity(payloads);

    if (!envelope) {
      const outcome = this.findOutcome(req, payloads);
      if (outcome.status === 'questions') {
        return { status: 'questions', questions: outcome.questions, questionsId: foundationMessageQuestionsId(outcome.questions), activity };
      }
      if (outcome.status === 'refused') {
        return { status: 'refused', reply: outcome.reply, activity };
      }
      return { status: 'pending', activity };
    }

    if (context && !validateMktgRedraftResult(context, envelope).valid) {
      const failure = { status: 'failed' as const, failureText: 'The agent result did not match the frozen redraft input.', activity };
      await this.comments.settle(req, context, failure);
      return failure;
    }

    logger.info(req, 'faq_result', 'FAQ ready', {
      project: envelope.project,
      version: envelope.version,
      mode: envelope.mode,
      agent_version: envelope.agent.agent_version,
      groups: envelope.content.faq.length,
      questions: envelope.content.faq.reduce((total, [, questions]) => total + questions.length, 0),
      unanswered: envelope.checks.unanswered.length,
      gaps: envelope.report.gaps.length,
    });

    const persistence = await this.persistEnvelope(req, envelope, sessionId, projectUid);

    return {
      status: 'ready',
      asset: faqAsset(envelope),
      version: envelope.version,
      projectName: envelope.project_name,
      project: envelope.project,
      activity,
      ...(persistence && { persistence }),
    };
  }

  /**
   * Where a session without an envelope stands: the LATEST of the agent's own
   * texts that is a questions block or a reply that ends the run. Latest, not
   * first found: a run that asked, got its answers and then ended on the
   * not-finalized reply must report the reply, or the run shell — which
   * ignores the block it already answered — would poll until it times out.
   * The raw payloads are chronological and so are the texts within each.
   */
  private findOutcome(req: Request, payloads: string[]): FaqSessionOutcome {
    let outcome: FaqSessionOutcome = { status: 'pending' };
    for (const text of extractMktgCurrentTurnAgentTexts(payloads)) {
      const questions = extractFaqQuestions(text);
      if (questions) {
        outcome = { status: 'questions', questions };
        continue;
      }
      const reply = extractFaqRefusal(text);
      if (reply) {
        outcome = { status: 'refused', reply };
      }
    }
    if (outcome.status === 'questions') {
      logger.debug(req, 'faq_result', 'The agent is asking questions', { questions: outcome.questions.length, keys: outcome.questions.map((q) => q.key) });
    } else if (outcome.status === 'refused') {
      logger.info(req, 'faq_result', 'The run ended on a reply instead of an FAQ', { reply_chars: outcome.reply.length });
    }
    return outcome;
  }

  /**
   * Persist the validated FAQ as a new revision of the project's FAQ document:
   * the content's JSON text as the revision's content, the rest of the
   * envelope as its sidecar. Every refusal and storage failure degrades to
   * null at WARN — the FAQ still reaches the user, without a receipt, and the
   * next poll retries the idempotent write.
   */
  private async persistEnvelope(req: Request, envelope: FaqEnvelope, sessionId: string, projectUid?: string): Promise<MktgArtifactPersistReceipt | null> {
    return this.documentStore.persistJsonGeneration(req, this.artifactSpec, envelope, projectUid, sessionId);
  }

  /**
   * The authoritative envelope of the current queued turn: the LATEST valid result of the
   * agent's finalize tool (`finalize_faq`), read only from that tool's result
   * events. The raw payloads are chronological, so a later valid finalize
   * supersedes an earlier one; the envelope's self-declared `version` plays
   * no part in the choice. The sha256 integrity gate runs PER CANDIDATE over
   * the content's JSON — a later candidate that fails the recompute does not
   * shadow an earlier valid one.
   */
  private findAuthoritativeEnvelope(req: Request, payloads: string[]): FaqEnvelope | null {
    let latest: FaqEnvelope | null = null;
    let candidateCount = 0;
    let invalidCount = 0;

    for (const resultText of extractMktgCurrentTurnToolResults(payloads, FAQ_FINALIZE_TOOL)) {
      for (const candidate of extractMktgEnvelopeCandidates(resultText, FAQ_CONTRACT_ID)) {
        candidateCount++;
        const result = validateFaqEnvelope(candidate);
        if (!result.valid) {
          invalidCount++;
          logger.debug(req, 'faq_result', 'Rejected envelope candidate', { errors: result.errors });
          continue;
        }
        // Safe: validateFaqEnvelope passed every schema gate.
        const envelope = candidate as FaqEnvelope;
        const recomputedSha = createHash('sha256')
          .update(Buffer.from(faqContentJson(envelope.content), 'utf8'))
          .digest('hex');
        if (recomputedSha !== envelope.content_sha256) {
          invalidCount++;
          logger.warning(req, 'faq_result', 'Envelope content_sha256 does not match the content JSON — discarding candidate', {
            expected: envelope.content_sha256,
            recomputed: recomputedSha,
          });
          continue;
        }
        latest = envelope;
      }
    }

    logger.debug(req, 'faq_result', 'Envelope scan complete', { events: payloads.length, candidates: candidateCount, invalid: invalidCount, found: !!latest });

    return latest;
  }
}
