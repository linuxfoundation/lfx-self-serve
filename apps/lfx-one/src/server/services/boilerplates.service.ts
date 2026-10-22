// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BOILERPLATES_CONTRACT_ID, BOILERPLATES_FINALIZE_TOOL, MKTG_ARTIFACT_SPECS } from '@lfx-one/shared/constants';
import {
  BoilerplatesEnvelope,
  BoilerplatesPersistReceipt,
  BoilerplatesResultResponse,
  BoilerplatesRunOutcome,
  MktgRunAnswer,
  MktgRevisionRef,
} from '@lfx-one/shared/interfaces';
import {
  boilerplatesAsset,
  boilerplatesContentJson,
  buildBoilerplatesFormPayload,
  buildMktgRunActivity,
  extractBoilerplatesQuestions,
  extractBoilerplatesRefusal,
  extractMktgCurrentTurnAgentTexts,
  mktgFailureAfterQuestions,
  extractMktgEnvelopeCandidates,
  extractMktgCurrentTurnToolResults,
  foundationMessageQuestionsId,
  renderBoilerplatesAnswersText,
  renderBoilerplatesFormText,
  validateBoilerplatesEnvelope,
} from '@lfx-one/shared/utils';
import { createHash } from 'node:crypto';
import { Request } from 'express';

import { GuildService } from './guild.service';
import { logger } from './logger.service';
import { MktgDocumentStoreService } from './mktg-document-store.service';

/**
 * Boilerplates generation flow (boilerplates-output/v1; Guild
 * linux-foundation~boilerplates 1.0.0).
 *
 * 1. The form travels as the one rendered text message the agent parses back
 *    (`renderBoilerplatesFormText`, a mirror of its renderer;
 *    dec-qa-form-path-only): the project, the website whose host is the
 *    domain the 100-word version ends on, the notes, and the project's
 *    messaging framework as its content — the latest stored revision, which
 *    the run page attaches and the controller requires; the boilerplates
 *    carry its positioning and proof. The agent reads the website, the launch
 *    press release and the LFX record itself. A run the agent refuses up
 *    front — no framework, or a JSON that is not one (boilerplates-output.md
 *    §2b) — ends in one plain-text reply, and so does a run that ended
 *    without a validated result (§3); `getResult` reports either as
 *    `refused`: the session is over, and the reply is the run's outcome.
 * 2. It then asks only the gaps it could not settle — a text turn carrying
 *    the boilerplates-questions/v1 block. `getResult` reports it as
 *    `questions`; the answers come back through `sendAnswers` as the
 *    boilerplates-answers/v1 turn on the SAME session, and the run polls on.
 * 3. The authoritative output is the finalize tool RESULT riding raw session
 *    events. Every candidate is schema-validated and its content sha256
 *    recomputed over `JSON.stringify(content)` before anything reaches the
 *    user, and the validated boilerplates are stored as a revision of the
 *    project's Boilerplates document — the JSON content as the revision's
 *    content, the report, checks and provenance in its sidecar.
 *
 * Who wrote what matters here: the agent fetches pages and searches the web,
 * and every page it reads comes back as a tool result in the same event
 * stream. A questions block or a reply is therefore taken only from the
 * agent's own text turns and an envelope only from the finalize tool's
 * results — never from whatever string in a payload carries a contract id.
 */
export class BoilerplatesService {
  private readonly guildService = new GuildService();

  /** The Marketing OS document store: every validated result is a revision of the project's Boilerplates document. */
  private readonly documentStore = new MktgDocumentStoreService();

  /** The Boilerplates' knobs for the shared persistence layer: the document type and the log namespace. */
  private readonly artifactSpec = MKTG_ARTIFACT_SPECS['boilerplates'];

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
    projectUid: string | undefined,
    guildAgentHandle: string,
    expectedFramework?: MktgRevisionRef
  ): Promise<string> {
    const payload = buildBoilerplatesFormPayload(answers, { projectUid });

    logger.info(req, 'boilerplates_generate', 'Composed the Boilerplates intake', {
      has_website: !!payload.website_url,
      has_notes: !!payload.notes,
      has_framework: !!payload.messaging_framework,
      has_project: !!projectUid,
    });

    const framework = await this.documentStore.captureFramework(req, projectUid, payload.messaging_framework, expectedFramework);
    const sessionId = await (this.structuredAgentInputEnabled
      ? this.guildService.createSession(req, { agentInput: payload, handle: guildAgentHandle })
      : this.guildService.createSession(req, { message: renderBoilerplatesFormText(payload), handle: guildAgentHandle }));
    await this.documentStore.rememberGenerationFramework(req, this.artifactSpec.agentKey, projectUid, sessionId, framework);
    return sessionId;
  }

  /**
   * Send the requester's answers to the session's questions turn as the
   * boilerplates-answers/v1 turn, on the SAME session (the agent's research
   * and questions live there). The owner-token check is the controller's.
   */
  public async sendAnswers(req: Request, sessionId: string, answers: MktgRunAnswer[], guildAgentHandle: string): Promise<void> {
    logger.info(req, 'boilerplates_answers', 'Sending the answers turn', {
      answers: answers.length,
      origins: answers.map((answer) => answer.origin),
    });
    await this.guildService.sendFollowUp(req, sessionId, { message: renderBoilerplatesAnswersText(answers), handle: guildAgentHandle });
  }

  /**
   * Read only the latest queued turn's finalize results and agent texts.
   * `ready` carries validated boilerplates and, after a successful write, the
   * exact revision receipt. Otherwise the latest outcome decides: `questions`
   * carries its unanswered block and `questionsId`; `refused` carries a later
   * refusal reply, including after answered questions. `failed` means the
   * runtime ended with no valid asset or open questions pause; `pending` means
   * it is still running. Without `projectUid` the asset is not stored; with
   * it, writer entitlement is checked before persistence.
   */
  public async getResult(req: Request, sessionId: string, projectUid?: string): Promise<BoilerplatesResultResponse> {
    const payloads = await this.guildService.getRawEventPayloads(req, sessionId);
    const envelope = this.findAuthoritativeEnvelope(req, payloads);
    // What the agent has done so far, in plain sentences, for the run page's live feed — on every status.
    const activity = buildMktgRunActivity(payloads);

    if (!envelope) {
      const outcome = this.findLatestOutcome(req, payloads);
      if (outcome?.kind === 'refused') {
        return { status: 'refused', reply: outcome.reply, activity };
      }
      const failure = mktgFailureAfterQuestions(payloads, (text) => !!extractBoilerplatesQuestions(text));
      if (failure) {
        return { status: 'failed', failureText: failure.replyText, activity };
      }
      if (outcome?.kind === 'questions') {
        return { status: 'questions', questions: outcome.questions, questionsId: foundationMessageQuestionsId(outcome.questions), activity };
      }
      return { status: 'pending', activity };
    }

    logger.info(req, 'boilerplates_result', 'Boilerplates ready', {
      project: envelope.project,
      version: envelope.version,
      mode: envelope.mode,
      agent_version: envelope.agent.agent_version,
      word_counts: envelope.checks.word_counts,
      findings: envelope.checks.findings.length,
      gaps: envelope.report.gaps.length,
    });

    const persistence = await this.persistEnvelope(req, envelope, sessionId, projectUid);

    return {
      status: 'ready',
      asset: boilerplatesAsset(envelope),
      version: envelope.version,
      projectName: envelope.project_name,
      project: envelope.project,
      activity,
      ...(persistence && { persistence }),
    };
  }

  /**
   * The latest outcome the AGENT wrote in the session, when there is one: a
   * questions block, or its end-of-run reply — the refusal of a run with no
   * messaging framework (or a JSON that is not one, §2b), or the reply of a
   * run that ended without a validated result (§3). One chronological pass:
   * the raw payloads are chronological and so are the agent's texts within
   * each, so the last outcome found wins. A §3 reply after an answered
   * questions block therefore ends the run, and a questions block after a
   * reply is the one to answer. Only the agent's own text turns are read —
   * never a tool result, where a fetched page could plant a block, and never
   * user content, replaced by content-free queued-turn markers. Null while the agent is
   * still working.
   */
  private findLatestOutcome(req: Request, payloads: string[]): BoilerplatesRunOutcome | null {
    let latest: BoilerplatesRunOutcome | null = null;
    for (const text of extractMktgCurrentTurnAgentTexts(payloads)) {
      const questions = extractBoilerplatesQuestions(text);
      if (questions) {
        latest = { kind: 'questions', questions };
        continue;
      }
      const reply = extractBoilerplatesRefusal(text);
      if (reply) {
        latest = { kind: 'refused', reply };
      }
    }
    if (latest?.kind === 'questions') {
      logger.debug(req, 'boilerplates_result', 'The agent is asking questions', { questions: latest.questions.length });
    } else if (latest?.kind === 'refused') {
      logger.info(req, 'boilerplates_result', 'The agent ended the run with a reply', { reply_chars: latest.reply.length });
    }
    return latest;
  }

  /**
   * Persist the validated boilerplates as a new revision of the project's
   * Boilerplates document: the content's JSON text as the revision's content,
   * the rest of the envelope as its sidecar. Every refusal and storage
   * failure degrades to null at WARN — the boilerplates still reach the user,
   * without a receipt, and the next poll retries the idempotent write.
   */
  private async persistEnvelope(
    req: Request,
    envelope: BoilerplatesEnvelope,
    sessionId: string,
    projectUid?: string
  ): Promise<BoilerplatesPersistReceipt | null> {
    return this.documentStore.persistJsonGeneration(req, this.artifactSpec, envelope, projectUid, sessionId);
  }

  /**
   * The latest queued turn's authoritative envelope: the LATEST valid result of the
   * agent's finalize tool (`finalize_boilerplates`), read only from that
   * tool's result events. The raw payloads are chronological, so a later
   * valid finalize (the agent fixed a gate failure and finalized again)
   * supersedes an earlier one. The sha256 integrity gate runs PER CANDIDATE
   * over the content's JSON — a later candidate that fails the recompute does
   * not shadow an earlier valid one.
   */
  private findAuthoritativeEnvelope(req: Request, payloads: string[]): BoilerplatesEnvelope | null {
    let latest: BoilerplatesEnvelope | null = null;
    let candidateCount = 0;
    let invalidCount = 0;

    for (const resultText of extractMktgCurrentTurnToolResults(payloads, BOILERPLATES_FINALIZE_TOOL)) {
      for (const candidate of extractMktgEnvelopeCandidates(resultText, BOILERPLATES_CONTRACT_ID)) {
        candidateCount++;
        const result = validateBoilerplatesEnvelope(candidate);
        if (!result.valid) {
          invalidCount++;
          logger.debug(req, 'boilerplates_result', 'Rejected envelope candidate', { errors: result.errors });
          continue;
        }
        // Safe: validateBoilerplatesEnvelope passed every schema gate.
        const envelope = candidate as BoilerplatesEnvelope;
        const recomputedSha = createHash('sha256')
          .update(Buffer.from(boilerplatesContentJson(envelope.content), 'utf8'))
          .digest('hex');
        if (recomputedSha !== envelope.content_sha256) {
          invalidCount++;
          logger.warning(req, 'boilerplates_result', 'Envelope content_sha256 does not match the content JSON — discarding candidate', {
            expected: envelope.content_sha256,
            recomputed: recomputedSha,
          });
          continue;
        }
        latest = envelope;
      }
    }

    logger.debug(req, 'boilerplates_result', 'Envelope scan complete', {
      events: payloads.length,
      candidates: candidateCount,
      invalid: invalidCount,
      found: !!latest,
    });

    return latest;
  }
}
