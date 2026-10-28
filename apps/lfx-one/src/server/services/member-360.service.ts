// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MEMBER_360_CONTRACT_ID,
  MEMBER_360_FINALIZE_TOOL,
  MEMBER_360_FINALIZE_RECEIPT_ID,
  MEMBER_360_PARTIAL_SUMMARY_PREFIX,
  MEMBER_360_MAX_BYTES,
  MEMBER_360_COMPARISON_UNAVAILABLE,
  MEMBER_360_REDACTED_SUMMARY,
  MEMBER_360_INVALID_RESULT,
  MKTG_AGENTS,
  MKTG_ARTIFACT_PARTITION_REGEX,
  MKTG_ARTIFACT_SHA256_REGEX,
} from '@lfx-one/shared/constants';
import {
  Member360Envelope,
  Member360FinalizeReceipt,
  Member360GenerateRequest,
  Member360GenerationStart,
  Member360PriorRun,
  Member360Result,
  Member360AnswersBody,
  MktgGenerationAttribution,
  MktgRunResultResponse,
  Project,
} from '@lfx-one/shared/interfaces';
import {
  findMktgDocumentType,
  extractMktgEnvelopeCandidates,
  envelopeSchema,
  formInputSchema,
  renderMember360FormMessage,
  createMember360Redactor,
  member360CandidateContacts,
  redactMember360Tabs,
  redactMember360Research,
  findMember360Questions,
  member360TerminalResult,
  mktgOneOffTerminalFacts,
  parseMember360Questions,
  member360QuestionsId,
  renderMember360Answers,
} from '@lfx-one/shared/server';
import { extractMktgToolResults, isMktgReasoningEvent, isMktgToolTaskEvent, mktgFailureAfterQuestions } from '@lfx-one/shared/utils/mktg-session-event.utils';
import { isMember360Question } from '@lfx-one/shared/server/member-360.utils';
import { buildMktgRunActivity } from '@lfx-one/shared/utils/mktg-run-activity.utils';
import { createHash } from 'node:crypto';
import { Request } from 'express';

import { AuthorizationError, ConflictError, InvalidRequestError, MicroserviceError, ServiceValidationError } from '../errors';
import { buildMktgRunDocumentId } from '../utils/mktg-document-store.util';
import { GuildService } from './guild.service';
import { logger } from './logger.service';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { ProjectService } from './project.service';

/** Form-only Member 360. Project identity and previous output come from trusted server reads. */
export class Member360Service {
  private readonly guild = new GuildService();
  private readonly projects = new ProjectService();
  private readonly documents: MktgDocumentStoreService;

  public constructor(attribution?: MktgGenerationAttribution) {
    this.documents = new MktgDocumentStoreService(attribution);
  }

  /** One domain adaptation shared by creator polls and durable Documents reconciliation. */
  public static toRunResult(result: Member360Result): MktgRunResultResponse {
    return {
      status: result.status === 'needs_input' ? 'questions' : result.status,
      activity: result.activity,
      ...(result.questions && { questions: result.questions, questionsId: result.questionsId }),
      persistence: result.persistence,
      failureText: result.status === 'needs_input' ? undefined : result.message,
      failureReason: result.reason,
    };
  }

  public async start(req: Request, body: Member360GenerateRequest): Promise<Member360GenerationStart> {
    const agent = MKTG_AGENTS.find((entry) => entry.id === 'member-360');
    if (agent?.status !== 'active')
      throw new InvalidRequestError('Member 360 is not available.', 'MEMBER_360_UNAVAILABLE', { operation: 'member_360_generate', service: 'member_360' });
    const project = await this.resolveProject(req, body.project);
    const prior = body.compare === false ? undefined : await this.previousRun(req, project.uid);
    const payload = formInputSchema.parse({
      type: 'member_360_intake_form',
      project_name: project.name,
      project_uid: project.uid,
      project_slug: project.slug,
      ...this.window(body.window ?? '12'),
      trackers: body.trackers,
      ...(prior && { prior_run: prior }),
    });
    logger.debug(req, 'member_360_generate', 'Starting entitled form-only run', { project: project.uid, comparison: !!prior });
    // The agent requires an exact intake header line; an inline mention makes its scope guard refuse data reads.
    const sessionId = await this.guild.createSession(req, {
      handle: agent.guildAgentHandle,
      message: renderMember360FormMessage(payload),
      mentionOnOwnLine: true,
    });
    return { sessionId, documentId: buildMktgRunDocumentId(sessionId) };
  }

  /** Only a validated, creator-authorized controller call reaches this transport. */
  public async sendAnswers(req: Request, body: Member360AnswersBody): Promise<void> {
    const payloads = await this.guild.getRawEventPayloads(req, body.sessionId);
    const text = findMember360Questions(payloads);
    const turn = text ? parseMember360Questions(text) : null;
    if (!text || !turn || member360QuestionsId(text) !== body.questionsId || mktgFailureAfterQuestions(payloads, isMember360Question) !== null) {
      throw new ConflictError('These questions are no longer waiting for answers. Refresh the run.', 'MEMBER_360_QUESTIONS_CHANGED');
    }
    if (body.answers.length !== turn.questions.length || body.answers.some((answer) => !turn.questions.some((question) => question.id === answer.id))) {
      throw ServiceValidationError.forField('answers', 'Answer each of the current questions exactly once.');
    }
    const agent = MKTG_AGENTS.find((entry) => entry.id === 'member-360');
    if (agent?.status !== 'active' || !agent.guildAgentHandle) throw ServiceValidationError.forField('agentId', 'Member 360 is unavailable.');
    await this.guild.sendFollowUp(req, body.sessionId, {
      message: renderMember360Answers(body.answers.map(({ id, ...answer }) => ({ ...answer, key: id }))),
      handle: agent.guildAgentHandle, // sendFollowUp routes on its own line by default.
    });
    logger.info(req, 'member_360_answers', 'Sent the requester answers', {
      session_id: body.sessionId,
      questions_id: body.questionsId,
      count: body.answers.length,
    });
  }

  public async result(req: Request, sessionId: string, projectUid: string): Promise<Member360Result> {
    const project = await this.resolveProject(req, projectUid);
    const redactIdentity = createMember360Redactor([]);
    let best: Member360Envelope | null = null;
    const payloads = await this.guild.getRawEventPayloads(req, sessionId);
    // Raw candidates supply privacy masks only, never authoritative output.
    const contacts = payloads.flatMap((payload) => extractMktgEnvelopeCandidates(payload, MEMBER_360_CONTRACT_ID).flatMap(member360CandidateContacts));
    const redactActivity = createMember360Redactor(contacts);
    const activity = buildMktgRunActivity(payloads).map((step) => ({
      ...step,
      label: redactActivity(step.label),
      ...(step.detail !== undefined && { detail: redactActivity(step.detail) }),
    }));
    const finalizeResults = payloads.flatMap((event) => extractMktgToolResults(event, MEMBER_360_FINALIZE_TOOL));
    for (const payload of finalizeResults) {
      for (const candidate of extractMktgEnvelopeCandidates(payload, MEMBER_360_CONTRACT_ID)) {
        const envelope = this.acceptCandidate(req, candidate, project, redactIdentity, 'finalize_result');
        if (envelope && (!best || envelope.version >= best.version)) best = envelope;
      }
    }
    if (!best) {
      const receipts = new Map<string, Pick<Member360FinalizeReceipt, 'partial' | 'rows'>>();
      for (const text of finalizeResults) {
        try {
          const receipt: unknown = JSON.parse(text);
          if (
            receipt &&
            typeof receipt === 'object' &&
            !Array.isArray(receipt) &&
            'finalize_receipt' in receipt &&
            receipt.finalize_receipt === MEMBER_360_FINALIZE_RECEIPT_ID &&
            'ok' in receipt &&
            receipt.ok === true &&
            'sha256' in receipt &&
            typeof receipt.sha256 === 'string' &&
            MKTG_ARTIFACT_SHA256_REGEX.test(receipt.sha256) &&
            'partial' in receipt &&
            typeof receipt.partial === 'boolean' &&
            'rows' in receipt &&
            receipt.rows &&
            typeof receipt.rows === 'object' &&
            !Array.isArray(receipt.rows) &&
            'ranking' in receipt.rows &&
            typeof receipt.rows.ranking === 'number' &&
            Number.isInteger(receipt.rows.ranking) &&
            receipt.rows.ranking >= 0 &&
            'evidence' in receipt.rows &&
            typeof receipt.rows.evidence === 'number' &&
            Number.isInteger(receipt.rows.evidence) &&
            receipt.rows.evidence >= 0
          )
            receipts.set(receipt.sha256, { partial: receipt.partial, rows: { ranking: receipt.rows.ranking, evidence: receipt.rows.evidence } });
        } catch {
          // Direct envelopes and non-JSON tool replies are not receipts.
        }
      }
      if (receipts.size) {
        logger.debug(req, 'member_360_result', 'Found finalize receipts', { receipts: receipts.size });
        // Agent code writes a receipt only after finalize validation succeeds.
        // Bind its tabs hash, partial flag and row counts; summary text itself
        // remains model prose in both paths, not hash-authenticated bytes.
        // The BFF still checks schema, size, original tabs hash and project scope;
        // the unchanged storage path redacts both tabs and summary before saving.
        for (const payload of payloads) {
          for (const text of this.finalCarrierTexts(payload)) {
            for (const candidate of extractMktgEnvelopeCandidates(text, MEMBER_360_CONTRACT_ID)) {
              if (!candidate || typeof candidate !== 'object') continue;
              if (!('content_sha256' in candidate) || typeof candidate.content_sha256 !== 'string' || !receipts.has(candidate.content_sha256)) {
                logger.debug(req, 'member_360_result', 'Rejected envelope receipt binding', { source: 'receipt_bound_final', check: 'hash' });
                continue;
              }
              const receipt = receipts.get(candidate.content_sha256);
              const envelope = this.acceptCandidate(req, candidate, project, redactIdentity, 'receipt_bound_final');
              if (!receipt || !envelope) continue;
              if (receipt.partial !== envelope.summary_markdown.startsWith(MEMBER_360_PARTIAL_SUMMARY_PREFIX)) {
                logger.debug(req, 'member_360_result', 'Rejected envelope receipt binding', { source: 'receipt_bound_final', check: 'partial' });
                continue;
              }
              if (receipt.rows.ranking !== envelope.tabs.member_ranking.length || receipt.rows.evidence !== envelope.tabs.evidence.length) {
                logger.debug(req, 'member_360_result', 'Rejected envelope receipt binding', { source: 'receipt_bound_final', check: 'rows' });
                continue;
              }
              if (!best || envelope.version >= best.version) best = envelope;
            }
          }
        }
        if (best)
          logger.info(req, 'member_360_result', 'Accepted the receipt-bound final envelope', { source: 'receipt_bound_final', receipts: receipts.size });
      }
    }
    if (!best) {
      const questionsText = findMember360Questions(payloads);
      const turn = questionsText ? parseMember360Questions(questionsText) : null;
      const questions = turn?.questions.map((item) => ({
        key: item.id,
        label: item.id.replace(/-/g, ' '),
        question: item.question,
        why: item.why,
        suggestedAnswer: item.suggested_answer,
        basis: [],
      }));
      const questionsResult: Member360Result = {
        status: 'needs_input',
        activity,
        ...(questions && questionsText && { questions, questionsId: member360QuestionsId(questionsText) }),
      };
      if (questionsText && mktgFailureAfterQuestions(payloads, isMember360Question) === null) {
        return questionsResult;
      }
      const failed = member360TerminalResult(payloads.slice(mktgOneOffTerminalFacts(payloads).currentTurnOffset), contacts);
      if (failed) {
        logger.debug(req, 'member_360_result', 'Session ended without a valid envelope', {});
        return failed;
      }
      if (questionsText) return questionsResult;
      return { status: 'pending', activity };
    }
    const type = findMktgDocumentType('member-360');
    if (!type)
      throw new MicroserviceError('Member 360 document type is not configured.', 503, 'MEMBER_360_UNAVAILABLE', {
        operation: 'member_360_result',
        service: 'member_360',
      });
    try {
      // Verify upstream bytes first, then exclude contact identity from the immutable store.
      const redact = createMember360Redactor(best.tabs.member_ranking.map((row) => row.key_contact));
      const tabs = redactMember360Tabs(best.tabs, redact);
      // This provenance field is BFF-owned, never trusted from the agent contract.
      const storedEnvelope = { ...best };
      delete storedEnvelope.lfx_project_uid;
      let member360 = {
        ...storedEnvelope,
        inputs: {
          ...storedEnvelope.inputs,
          ...(storedEnvelope.inputs.research && { research: redactMember360Research(storedEnvelope.inputs.research, redact) }),
        },
        project_uid: project.uid,
        ...(best.project_uid !== undefined && best.project_uid !== project.uid && { lfx_project_uid: best.project_uid }),
        project_name: redactIdentity(best.project_name),
        ...(best.lfx_project_name !== undefined && { lfx_project_name: redactIdentity(best.lfx_project_name) }),
        tabs,
        summary_markdown: redact(best.summary_markdown),
        content_sha256: this.sha(JSON.stringify(tabs)),
      };
      if (!envelopeSchema.safeParse(member360).success) {
        logger.warning(req, 'member_360_redaction', 'Replacing the redacted summary to preserve a readable document', {});
        member360 = { ...member360, summary_markdown: MEMBER_360_REDACTED_SUMMARY };
        if (!envelopeSchema.safeParse(member360).success) {
          logger.warning(req, 'member_360_redaction_invalid', 'Privacy-safe result failed validation after fallback', {});
          throw new InvalidRequestError('The run could not be validated after privacy filtering.', MEMBER_360_INVALID_RESULT);
        }
      }
      const summary = member360.summary_markdown;
      const bundle = {
        version: best.version,
        intake: best.intake,
        member360,
        document_markdown: summary,
        content_sha256: this.sha(summary),
      };
      if (best.project_uid !== undefined && best.project_uid !== project.uid) {
        logger.info(req, 'member_360_result', 'Envelope uid differs from the LFX One project uid; accepted by name and slug', {
          project: project.uid,
          envelope_project_uid: best.project_uid,
        });
      }
      const stored = await this.documents.recordGeneration(req, type, project.uid, bundle, sessionId);
      return {
        status: 'ready',
        stored: true,
        documentId: stored.record.documentId,
        persistence: {
          project: project.uid,
          version: best.version,
          s3_key: stored.key,
          content_sha256: bundle.content_sha256,
          document_location: { agent_key: type.agentKey, document_id: stored.record.documentId, revision_id: stored.id },
        },
      };
    } catch (err) {
      if (err instanceof InvalidRequestError && err.code === MEMBER_360_INVALID_RESULT) throw err;
      logger.warning(req, 'member_360_result', 'Run ready but document write failed; next poll retries the same one-off document', {
        project: project.uid,
        err,
      });
      return { status: 'ready', stored: false };
    }
  }

  private finalCarrierTexts(payload: string): string[] {
    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(payload);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
      event = parsed as Record<string, unknown>;
    } catch {
      return [];
    }
    if (isMktgReasoningEvent(event) || isMktgToolTaskEvent(event)) return [];
    const task = event['task'];
    const root = task && typeof task === 'object' && !Array.isArray(task) ? (task as Record<string, unknown>) : null;
    if (root && (root['entity_type'] !== 'EntTaskAgent' || root['parent_task_id'] != null)) return [];
    const content = event['content'];
    // Guild's task-less notifications are root output bound by the receipt; task metadata, when present, must identify the root agent.
    if (event['type'] === 'agent_notification_message' && typeof content === 'string') return [content];
    if (!content || typeof content !== 'object' || Array.isArray(content) || !('type' in content) || content.type !== 'text') return [];
    if (event['type'] === 'runtime_done' && root && 'text' in content && typeof content.text === 'string') return [content.text];
    if (event['type'] === 'agent_notification_message' && 'data' in content && typeof content.data === 'string') return [content.data];
    return [];
  }

  private acceptCandidate(
    req: Request,
    candidate: unknown,
    project: Project,
    redactIdentity: ReturnType<typeof createMember360Redactor>,
    source: 'finalize_result' | 'receipt_bound_final'
  ): Member360Envelope | null {
    const parsed = envelopeSchema.safeParse(candidate);
    if (!parsed.success) {
      logger.debug(req, 'member_360_result', 'Rejected envelope schema', { source, issues: parsed.error.issues.map((issue) => issue.path.join('.')) });
      return null;
    }
    // Hash the ORIGINAL property order, never zod's reconstructed object.
    const envelope = candidate as Member360Envelope;
    if (Buffer.byteLength(JSON.stringify(envelope)) > MEMBER_360_MAX_BYTES || this.sha(JSON.stringify(envelope.tabs)) !== envelope.content_sha256) {
      logger.debug(req, 'member_360_result', 'Rejected envelope size or integrity', { source });
      return null;
    }
    if (!this.member360EnvelopeMatchesProject(envelope, project)) {
      logger.debug(req, 'member_360_result', 'Rejected envelope scope', {
        source,
        project: project.uid,
        envelope_project_uid: envelope.project_uid && redactIdentity(envelope.project_uid),
        envelope_project_slug: envelope.project_slug && redactIdentity(envelope.project_slug),
      });
      return null;
    }
    return parsed.data;
  }

  private member360EnvelopeMatchesProject(envelope: Member360Envelope, project: Project): boolean {
    if (envelope.project_uid !== undefined && !MKTG_ARTIFACT_PARTITION_REGEX.test(envelope.project_uid)) return false;
    return (
      envelope.project_name === project.name &&
      ((envelope.project_uid === project.uid && (envelope.project_slug === undefined || envelope.project_slug === project.slug)) ||
        (envelope.project_slug !== undefined && envelope.project_slug === project.slug))
    );
  }

  private async resolveProject(req: Request, uid: string): Promise<Project> {
    if (typeof uid !== 'string' || !MKTG_ARTIFACT_PARTITION_REGEX.test(uid)) {
      throw ServiceValidationError.forField('project', 'A single-segment project uid is required', { operation: 'member_360_project', service: 'member_360' });
    }
    const project = await this.projects.getProjectById(req, uid, true);
    if (!project.writer || !MKTG_ARTIFACT_PARTITION_REGEX.test(project.uid)) {
      throw new AuthorizationError('You need write access to this project to run Member 360.', { operation: 'member_360_project', service: 'member_360' });
    }
    // Scope headers are line-oriented. Never let upstream display values add
    // another header, even though requester strings cannot reach these fields.
    if ([project.name, project.uid, project.slug].some((value) => !value || /[\r\n]/.test(value))) {
      throw ServiceValidationError.forField('project', 'The project identity cannot be rendered safely. Retry after correcting the project details.', {
        operation: 'member_360_project',
        service: 'member_360',
      });
    }
    return project;
  }

  private async previousRun(req: Request, project: string): Promise<Member360PriorRun | undefined> {
    let prior: Member360Envelope | undefined;
    try {
      const listing = await this.documents.listDocuments(req, project, 'member-360');
      const group = listing.groups.find((candidate) => candidate.type.agentKey === 'member-360');
      const latest = group?.documents[0];
      if (!group || !latest) return undefined;
      const revision = await this.documents.getRevision(req, project, group.type, latest.documentId, latest.latestRevisionId);
      prior = revision?.member360;
    } catch (error) {
      logger.debug(req, 'member_360_comparison', 'Previous run read unavailable', { project, err: error });
    }
    if (!prior)
      throw new ConflictError('The previous run could not be read. Turn off comparison or retry.', MEMBER_360_COMPARISON_UNAVAILABLE, {
        operation: 'member_360_comparison',
        service: 'member_360',
      });
    const envelope = prior;
    return {
      period_label: envelope.period.label,
      generated_at: envelope.generated_at,
      member_ranking: envelope.tabs.member_ranking.map((row) => ({
        member_organization: row.member_organization,
        engagement_score: row.engagement_score,
        committees_score: row.committees_score,
        events_score: row.events_score,
        speaking_score: row.speaking_score,
        content_score: row.content_score,
        community_programs_score: row.community_programs_score,
        marketing_social_score: row.marketing_social_score,
      })),
    };
  }

  private window(choice: '12' | '6' | 'year'): { window_start: string; window_end: string } {
    const end = new Date();
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
    if (choice === 'year') start.setUTCMonth(0, 1);
    else {
      // Clamp leap days/month ends before adding the inclusive-window day.
      const day = start.getUTCDate();
      start.setUTCDate(1);
      start.setUTCMonth(start.getUTCMonth() - Number(choice));
      const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
      start.setUTCDate(Math.min(day, last) + 1);
    }
    return { window_start: start.toISOString().slice(0, 10), window_end: end.toISOString().slice(0, 10) };
  }

  private sha(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
