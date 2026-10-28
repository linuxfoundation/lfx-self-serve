// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  LINKEDIN_CONTRACT_ID,
  LINKEDIN_DOCUMENT_TITLE,
  LINKEDIN_FINALIZE_TOOL,
  LINKEDIN_SHARE_LINK_ANSWER_KEY,
  MKTG_ARTIFACT_SPECS,
} from '@lfx-one/shared/constants';
import {
  LinkedinEnvelope,
  LinkedinForm,
  LinkedinGeneration,
  LinkedinResult,
  LinkedinSetup,
  LinkedinQuestionsTurn,
  MktgRunAnswer,
  MktgGenerationAttribution,
  Project,
} from '@lfx-one/shared/interfaces';
import {
  extractMktgEnvelopeCandidates,
  extractMktgToolResults,
  isLinkedinEnvelope,
  normalizeLinkedinShareAnswers,
  renderLinkedinFormText,
  publicLinkedinPayloads,
  linkedinQuestionsFromPayloads,
  linkedinRunQuestions,
  linkedinRunActivity,
  renderLinkedinAnswers,
} from '@lfx-one/shared/utils';
import { mktgOneOffFailureText, mktgOneOffTerminalFacts, mktgOneOffTurnEnded } from '@lfx-one/shared/server';
import { Request } from 'express';
import { createHash } from 'node:crypto';

import { GuildService } from './guild.service';
import { LinkedinProfileService } from './linkedin-profile.service';
import { LinkedinSourceService } from './linkedin-source.service';
import { logger } from './logger.service';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { ServiceValidationError } from '../errors';
import { isImpersonating } from '../utils/auth-helper';

/** One fresh, form-only Guild session per post; output comes from validated finalize-tool events. */
export class LinkedinPostService {
  private readonly guild = new GuildService();
  private readonly profiles = new LinkedinProfileService();
  private readonly sources = new LinkedinSourceService();
  private readonly documents: MktgDocumentStoreService;

  public constructor(
    attribution?: MktgGenerationAttribution,
    private readonly initializeProfile = true
  ) {
    this.documents = new MktgDocumentStoreService(attribution);
  }

  public async start(
    req: Request,
    user: string,
    answers: Record<string, unknown>,
    setup: LinkedinSetup | undefined,
    handle: string,
    project: Pick<Project, 'name' | 'uid'>
  ): Promise<Omit<LinkedinGeneration, 'ownerToken'>> {
    if (!project?.name?.trim() || !project.uid?.trim())
      throw ServiceValidationError.forField('project', 'The project could not be resolved. Reload the page before drafting.');
    const lfxAnswers = normalizeLinkedinShareAnswers({ [LINKEDIN_SHARE_LINK_ANSWER_KEY]: answers[LINKEDIN_SHARE_LINK_ANSWER_KEY] });
    if (!lfxAnswers) throw ServiceValidationError.forField(LINKEDIN_SHARE_LINK_ANSWER_KEY, 'Enter one HTTPS link to share, or leave it empty.');
    const saved = await this.profiles.read(req, user);
    if (!saved && !setup) throw ServiceValidationError.forField('setup', 'Set up your LinkedIn profile before drafting.');
    const source = await this.sources.ingest(answers, req);
    const form: LinkedinForm = {
      ...source,
      project_name: project.name.trim(),
      project_uid: project.uid,
      today: new Date().toISOString().slice(0, 10),
      ...(saved ? { saved_profile: saved.profile } : { setup }),
    };
    logger.debug(req, 'linkedin_generate', 'Submitting the rendered form', { content_source: source.content_source, saved_profile: !!saved });
    const sessionId = await this.guild.createSession(req, { message: renderLinkedinFormText(form), handle });
    return {
      sessionId,
      documentId: this.documents.runDocumentId(sessionId),
      answers: lfxAnswers,
      source: {
        label: source.content_url ?? source.content_file_name ?? 'pasted text',
        words: source.content_text.split(/\s+/u).length,
        fetched: source.content_source === 'url',
      },
    };
  }

  /** Same generic run answers protocol and Guild follow-up transport, on the existing session. */
  public async sendAnswers(req: Request, sessionId: string, questionsId: string, answers: MktgRunAnswer[], handle: string): Promise<void> {
    const payloads = publicLinkedinPayloads(await this.guild.getRawEventPayloads(req, sessionId));
    const turn = linkedinQuestionsFromPayloads(payloads);
    if (!turn || this.questionsId(turn) !== questionsId || answers.some((answer) => !turn.questions.some((question) => question.id === answer.key)))
      throw ServiceValidationError.forField('answers', 'These questions are no longer available. Reload the run.');
    // A retry after completion must poll the existing output, not invoke the agent again.
    if (this.authoritativeEnvelope(payloads)) return;
    logger.info(req, 'linkedin_answers', 'Sending the profile gap answers', { answers: answers.length });
    await this.guild.sendFollowUp(req, sessionId, { message: renderLinkedinAnswers(answers), handle });
  }

  public async result(
    req: Request,
    user: string,
    sessionId: string,
    project: string,
    lfxAnswers?: Record<string, string>,
    sourceWords = 0
  ): Promise<LinkedinResult> {
    const answers = lfxAnswers === undefined ? undefined : normalizeLinkedinShareAnswers(lfxAnswers);
    if (answers === null) throw ServiceValidationError.forField(LINKEDIN_SHARE_LINK_ANSWER_KEY, 'Invalid link-to-share metadata.');
    const rawPayloads = await this.guild.getRawEventPayloads(req, sessionId);
    const payloads = publicLinkedinPayloads(rawPayloads);
    const best = this.authoritativeEnvelope(payloads);
    const activity = linkedinRunActivity(payloads, !!best);
    if (!best) {
      const terminal = mktgOneOffTerminalFacts(rawPayloads);
      const turn = linkedinQuestionsFromPayloads(rawPayloads.slice(terminal.currentTurnOffset));
      // Only open questions from the newest queued turn outrank its root completion.
      if (turn)
        return { status: 'questions', questions: linkedinRunQuestions(turn), questionsId: this.questionsId(turn), questionsProject: turn.project, activity };
      // Error/session-only evidence belongs to Guild's recovery-aware settled reader.
      if (mktgOneOffTurnEnded(terminal)) {
        return {
          status: 'failed',
          failureText: mktgOneOffFailureText(terminal),
          activity,
        };
      }
      return { status: 'pending', activity };
    }
    // The live agent personalizes the H1 with the profile name. Project-readable
    // artifacts/revisions must instead use a neutral title and their own hash.
    // Private profile fields remain only in the user-owned profile store.
    const markdown = best.document_markdown.replace(/^# [^\r\n]*/, LINKEDIN_DOCUMENT_TITLE);
    const document = {
      document_markdown: markdown,
      content_sha256: createHash('sha256').update(markdown, 'utf8').digest('hex'),
      version: best.version,
      intake: { mode: 'form' as const },
      options: best.options,
      ...(answers ? { answers } : {}),
      source: {
        label: best.inputs.content_url ?? best.inputs.content_file_name ?? 'pasted text',
        fetched: best.inputs.content_source === 'url',
        words: sourceWords,
      },
      ...(best.notes ? { notes: best.notes } : {}),
    };
    const persistence = await this.documents.persistGeneration(req, MKTG_ARTIFACT_SPECS['linkedin-post'], document, project, sessionId);
    if (persistence && answers) {
      await this.documents.saveLinkedinShareLink(req, project, this.documents.runDocumentId(sessionId), answers[LINKEDIN_SHARE_LINK_ANSWER_KEY], true);
    }
    // Durable per-run consumption plus create-only storage prevents edit overwrite and post-delete replay.
    let profileSaved = best.profile_source !== 'first_run_setup';
    if (best.profile_source === 'first_run_setup' && user && this.initializeProfile && !isImpersonating(req)) {
      profileSaved = await this.profiles.initializeOnce(req, user, sessionId, { profile: best.profile, profile_markdown: best.profile_markdown });
    }
    return {
      status: 'ready',
      activity,
      envelope: best,
      documentMarkdown: best.document_markdown,
      version: best.version,
      profileSaved,
      ...(answers ? { answers } : {}),
      ...(persistence ? { persistence } : {}),
    };
  }

  private authoritativeEnvelope(payloads: string[]): LinkedinEnvelope | null {
    let best: LinkedinEnvelope | null = null;
    // Main's paired finalize-tool reader excludes fetched pages, user text and orphan results.
    for (const payload of payloads) {
      for (const result of extractMktgToolResults(payload, LINKEDIN_FINALIZE_TOOL)) {
        for (const candidate of extractMktgEnvelopeCandidates(result, LINKEDIN_CONTRACT_ID)) {
          if (!isLinkedinEnvelope(candidate)) continue;
          if (createHash('sha256').update(candidate.document_markdown, 'utf8').digest('hex') !== candidate.content_sha256) continue;
          if (!best || candidate.version >= best.version) best = candidate;
        }
      }
    }
    return best;
  }

  private questionsId(turn: LinkedinQuestionsTurn): string {
    return createHash('sha256').update(JSON.stringify(turn)).digest('hex');
  }
}
