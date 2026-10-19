// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_MESSAGE_CONTRACT_ID, FOUNDATION_MESSAGE_FINALIZE_TOOL, MKTG_ARTIFACT_SPECS } from '@lfx-one/shared/constants';
import {
  FoundationMessageEnvelope,
  FoundationMessagePersistReceipt,
  FoundationMessageResultResponse,
  FoundationMessageStoredResponse,
  MktgIntakeDocument,
  MktgRunAnswer,
  MktgRunQuestion,
} from '@lfx-one/shared/interfaces';
import {
  buildFoundationMessageFormPayload,
  buildMktgRunActivity,
  extractFoundationMessageQuestions,
  extractMktgAgentTexts,
  extractMktgEnvelopeCandidates,
  extractMktgToolResults,
  foundationMessageAsset,
  foundationMessageContentJson,
  foundationMessageQuestionsId,
  renderFoundationMessageAnswersText,
  renderFoundationMessageFormText,
  toFoundationMessageFormDocument,
  validateFoundationMessageEnvelope,
} from '@lfx-one/shared/utils';
import { createHash } from 'node:crypto';
import { Request } from 'express';

import { GuildService } from './guild.service';
import { logger } from './logger.service';
import { MktgDocumentStoreService } from './mktg-document-store.service';

/**
 * Messaging Framework generation flow (messaging-framework-output/v1; Guild
 * linux-foundation~foundation-message 4.0.0).
 *
 * 1. The sources travel as links: the agent fetches every one itself and
 *    researches the rest (web fetch, Exa search), so nothing is read here.
 *    Uploaded files arrive already read to text (`readFoundationMessageFile`)
 *    and go as text; a document given as a link goes as its URL; every
 *    document carries the kind the requester tagged it with. The form becomes
 *    the agent's `messaging_framework_intake_form`, sent as the one rendered
 *    text message the agent parses back (`renderFoundationMessageFormText`, a
 *    mirror of its renderer; dec-qa-form-path-only).
 *    `GUILD_STRUCTURED_AGENT_INPUT=true` still flips to the structured
 *    transport for when Guild passes objects through.
 * 2. After reading and researching, the agent asks only the gaps it could not
 *    settle — its questions turn, the messaging-framework-questions/v1 block,
 *    is the run's text output. `getResult` reports it as `questions`; the
 *    answers come back through `sendAnswers` as the
 *    messaging-framework-answers/v1 turn on the SAME session, and the run
 *    polls on.
 * 3. The authoritative output is the finalize tool RESULT riding raw session
 *    events. Every candidate is schema-validated and its content sha256
 *    recomputed over `JSON.stringify(content)` before anything reaches the
 *    user, and the validated bundle is stored as a revision of the project's
 *    foundation-message document — the JSON content as the revision's
 *    content, never a Markdown document.
 *
 * Who wrote what matters here: the agent fetches the requester's links and
 * searches the web, and every page it reads comes back as a tool result in
 * the same event stream. A questions block is therefore taken only from the
 * agent's own text turns and an envelope only from the finalize tool's
 * results (`extractMktgAgentTexts`, `extractMktgToolResults`) — never from
 * whatever string in a payload happens to carry a contract id.
 */
export class FoundationMessageService {
  private readonly guildService = new GuildService();

  /**
   * The Marketing OS document store: every validated bundle is recorded as a
   * revision of the project's foundation-message document (its report, inputs
   * record and provenance ride in the revision's sidecar), whose latest
   * revision is what the stored read serves.
   */
  private readonly documentStore = new MktgDocumentStoreService();

  /** The foundation-message knobs for the shared persistence layer: key prefix, size cap, log namespace. */
  private readonly artifactSpec = MKTG_ARTIFACT_SPECS['foundation-message'];

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
    guildAgentHandle: string
  ): Promise<string> {
    const formDocuments = documents.map((document) => toFoundationMessageFormDocument(document));
    const payload = buildFoundationMessageFormPayload(answers, { documents: formDocuments, projectUid });

    // Counted on the composed payload, not the form's documents alone: the
    // press release, deck and plan link fields are documents to the agent too.
    const composedDocuments = payload.documents ?? [];
    logger.info(req, 'foundation_message_generate', 'Composed the Messaging Framework intake', {
      has_website: !!payload.website_url,
      links: payload.links?.length ?? 0,
      documents: composedDocuments.length,
      documents_read: composedDocuments.filter((document) => document.text !== undefined).length,
      document_kinds: composedDocuments.map((document) => document.kind),
      has_project: !!projectUid,
    });

    return this.structuredAgentInputEnabled
      ? this.guildService.createSession(req, { agentInput: payload, handle: guildAgentHandle })
      : this.guildService.createSession(req, { message: renderFoundationMessageFormText(payload), handle: guildAgentHandle });
  }

  /**
   * Send the requester's answers to the session's questions turn as the
   * messaging-framework-answers/v1 turn, on the SAME session (the agent's
   * research and questions live there). The owner-token check is the
   * controller's.
   */
  public async sendAnswers(req: Request, sessionId: string, answers: MktgRunAnswer[], guildAgentHandle: string): Promise<void> {
    logger.info(req, 'foundation_message_answers', 'Sending the answers turn', {
      answers: answers.length,
      origins: answers.map((answer) => answer.origin),
    });
    await this.guildService.sendFollowUp(req, sessionId, { message: renderFoundationMessageAnswersText(answers), handle: guildAgentHandle });
  }

  /**
   * Fetch the session's current result: `ready` once a valid envelope appears
   * in the event stream, with the framework as the run's asset and (when the
   * write succeeded) the persistence receipt of the stored revision;
   * `questions` whenever the session holds a questions block and no valid
   * envelope yet — the LATEST block the agent wrote, reported on every poll
   * until a newer block or the envelope appears, which is why it carries a
   * `questionsId`: the run shell ignores the block it already answered by
   * that id while the agent works on the answers; `pending` otherwise.
   * `projectUid` decides the storage partition and is entitlement-checked
   * before anything is written; without it the framework is still returned,
   * just not stored.
   */
  public async getResult(req: Request, sessionId: string, projectUid?: string): Promise<FoundationMessageResultResponse> {
    const payloads = await this.guildService.getRawEventPayloads(req, sessionId);
    const envelope = this.findAuthoritativeEnvelope(req, payloads);
    // What the agent has done so far, in plain sentences, for the run page's live feed — on every status.
    const activity = buildMktgRunActivity(payloads);

    if (!envelope) {
      const questions = this.findLatestQuestions(req, payloads);
      if (questions) {
        return { status: 'questions', questions, questionsId: foundationMessageQuestionsId(questions), activity };
      }
      return { status: 'pending', activity };
    }

    logger.info(req, 'foundation_message_result', 'Messaging Framework ready', {
      project: envelope.project,
      version: envelope.version,
      mode: envelope.mode,
      agent_version: envelope.agent.agent_version,
      goals: envelope.content.mf.goals.length,
      icps: envelope.content.icp.length,
      findings: envelope.checks.findings.length,
      gaps: envelope.report.gaps.length,
    });

    const persistence = await this.persistEnvelope(req, envelope, sessionId, projectUid);

    return {
      status: 'ready',
      asset: foundationMessageAsset(envelope),
      version: envelope.version,
      projectName: envelope.project_name,
      project: envelope.project,
      activity,
      ...(persistence && { persistence }),
    };
  }

  /**
   * The project's LATEST stored framework — its latest revision, restored ones
   * included, as the JSON text of its content — which is what sibling agents
   * (the ICP) attach. Falls back to the pre-revision read path (a Markdown
   * document from before 4.0.0) when the document has no revisions yet.
   *
   * `withSidecar`: the same latest revision with its envelope JSON (the
   * stored sidecar, the framework back under `content`) and date — what the
   * Brand Kit attaches as the project's messaging framework (the latest
   * regardless of its review status: Approve is a later item). Null when the
   * document has no revision.
   */
  public async getStoredFoundationMessage(req: Request, project: string, withSidecar = false): Promise<FoundationMessageStoredResponse | null> {
    return this.documentStore.readLatest(req, this.artifactSpec, project, { withSidecar });
  }

  /**
   * The latest questions block the AGENT wrote in the session, when there is
   * one: the raw payloads are chronological and so are the agent's texts
   * within each, so the last block found is the latest, and it stays the
   * answer until the agent writes a newer block (or the envelope ends the
   * run). Only the agent's own text turns are read — never a tool result,
   * where a fetched page or a search hit could plant a block, and never a
   * user event, which `getRawEventPayloads` drops anyway.
   */
  private findLatestQuestions(req: Request, payloads: string[]): MktgRunQuestion[] | null {
    let latest: MktgRunQuestion[] | null = null;
    for (const payload of payloads) {
      for (const text of extractMktgAgentTexts(payload)) {
        latest = extractFoundationMessageQuestions(text) ?? latest;
      }
    }
    if (latest) {
      logger.debug(req, 'foundation_message_result', 'The agent is asking questions', { questions: latest.length });
    }
    return latest;
  }

  /**
   * Persist the validated bundle as a new revision of the project's
   * foundation-message document: the content's JSON text as the revision's
   * content, the rest of the envelope as its sidecar. Every refusal and
   * storage failure degrades to null at WARN — the framework still reaches
   * the user, without a receipt, and the next poll retries the idempotent
   * write.
   */
  private async persistEnvelope(
    req: Request,
    envelope: FoundationMessageEnvelope,
    sessionId: string,
    projectUid?: string
  ): Promise<FoundationMessagePersistReceipt | null> {
    return this.documentStore.persistJsonGeneration(req, this.artifactSpec, envelope, projectUid, sessionId);
  }

  /**
   * The authoritative envelope of the session: the LATEST valid result of the
   * agent's finalize tool (`finalize_messaging_framework`), read only from
   * that tool's result events — a page the agent fetched or a search hit is
   * a tool result too, but of another tool, and nothing else in a payload is
   * looked at. The raw payloads are chronological, so a later valid finalize
   * (the agent fixed a gate failure and finalized again) supersedes an
   * earlier one; the envelope's self-declared `version` plays no part in the
   * choice. The sha256 integrity gate runs PER CANDIDATE over the content's
   * JSON — a later candidate that fails the recompute does not shadow an
   * earlier valid one.
   */
  private findAuthoritativeEnvelope(req: Request, payloads: string[]): FoundationMessageEnvelope | null {
    let latest: FoundationMessageEnvelope | null = null;
    let candidateCount = 0;
    let invalidCount = 0;

    for (const payload of payloads) {
      for (const resultText of extractMktgToolResults(payload, FOUNDATION_MESSAGE_FINALIZE_TOOL)) {
        for (const candidate of extractMktgEnvelopeCandidates(resultText, FOUNDATION_MESSAGE_CONTRACT_ID)) {
          candidateCount++;
          const result = validateFoundationMessageEnvelope(candidate);
          if (!result.valid) {
            invalidCount++;
            logger.debug(req, 'foundation_message_result', 'Rejected envelope candidate', { errors: result.errors });
            continue;
          }
          // Safe: validateFoundationMessageEnvelope passed every schema gate.
          const envelope = candidate as FoundationMessageEnvelope;
          const recomputedSha = createHash('sha256')
            .update(Buffer.from(foundationMessageContentJson(envelope.content), 'utf8'))
            .digest('hex');
          if (recomputedSha !== envelope.content_sha256) {
            invalidCount++;
            logger.warning(req, 'foundation_message_result', 'Envelope content_sha256 does not match the content JSON — discarding candidate', {
              expected: envelope.content_sha256,
              recomputed: recomputedSha,
            });
            continue;
          }
          latest = envelope;
        }
      }
    }

    logger.debug(req, 'foundation_message_result', 'Envelope scan complete', {
      events: payloads.length,
      candidates: candidateCount,
      invalid: invalidCount,
      found: !!latest,
    });

    return latest;
  }
}
