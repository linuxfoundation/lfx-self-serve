// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  AEO_GEO_CONTRACT_ID,
  AEO_GEO_FINALIZE_TOOL,
  AEO_GEO_QUESTIONS_HEADER,
  AEO_GEO_ANSWERS_HEADER,
  AEO_GEO_QUESTION_KEY_PREFIX,
  MKTG_ARTIFACT_SPECS,
} from '@lfx-one/shared/constants';
import { AeoGeoAnswer, AeoGeoEnvelope, MktgRunResultResponse, MktgRunSessionResponse } from '@lfx-one/shared/interfaces';
import {
  aeoGeoRunQuestions,
  buildAeoGeoFormPayload,
  buildMktgRunActivity,
  extractAeoGeoEnvelopeCandidates,
  extractMktgToolResults,
  isAeoGeoEnvelope,
  latestAeoGeoFinalText,
  parseAeoGeoQuestionsTurn,
  renderAeoGeoAnswers,
  renderAeoGeoFormText,
} from '@lfx-one/shared/utils';
import { createHash } from 'node:crypto';
import { Request } from 'express';

import { ServiceValidationError } from '../errors';
import { GuildService } from './guild.service';
import { logger } from './logger.service';
import { MktgDocumentStoreService } from './mktg-document-store.service';

/** Reports come only from the finalize tool, never chat text; final-answer text is read only as a questions turn or a refusal. */
export class AeoGeoService {
  private readonly guild = new GuildService();
  private readonly documents = new MktgDocumentStoreService();

  public async startGeneration(
    req: Request,
    answers: Record<string, string>,
    handle: string
  ): Promise<Pick<MktgRunSessionResponse, 'sessionId' | 'documentId'>> {
    const payload = buildAeoGeoFormPayload(answers);
    logger.debug(req, 'aeo_geo_generate', 'Submitting the rendered AEO/GEO form', { key_pages_count: payload.key_pages?.length ?? 0 });
    const sessionId = await this.guild.createSession(req, { message: renderAeoGeoFormText(payload), handle, mentionOnOwnLine: true });
    return { sessionId, documentId: this.documents.runDocumentId(sessionId) };
  }

  public async getResult(req: Request, sessionId: string, project: string): Promise<MktgRunResultResponse> {
    const payloads = await this.guild.getRawEventPayloads(req, sessionId);
    const activity = buildMktgRunActivity(payloads);
    let best: AeoGeoEnvelope | null = null;
    for (const payload of payloads) {
      for (const output of extractMktgToolResults(payload, AEO_GEO_FINALIZE_TOOL)) {
        for (const candidate of extractAeoGeoEnvelopeCandidates(output)) {
          if (!isAeoGeoEnvelope(candidate)) {
            logger.debug(req, 'aeo_geo_result', 'Discarding a schema-invalid report', { contract: AEO_GEO_CONTRACT_ID });
            continue;
          }
          const sha = createHash('sha256').update(candidate.document_markdown, 'utf8').digest('hex');
          if (sha !== candidate.content_sha256) {
            logger.warning(req, 'aeo_geo_result', 'Discarding a report whose content hash does not match', {});
            continue;
          }
          if (!best || candidate.version >= best.version) {
            best = candidate;
          }
        }
      }
    }
    if (!best) {
      const text = latestAeoGeoFinalText(payloads);
      const turn = text ? parseAeoGeoQuestionsTurn(text) : null;
      if (turn) {
        // History decides only whether the user answered, never what the agent's report contains.
        const history = await this.guild.getHistory(req, sessionId);
        const answered = history.map((message) => message.sender === 'user' && message.text.trimStart().startsWith(AEO_GEO_ANSWERS_HEADER)).lastIndexOf(true);
        const asked = history.map((message) => message.sender === 'agent' && parseAeoGeoQuestionsTurn(message.text) !== null).lastIndexOf(true);
        if (answered > asked) {
          return { status: 'pending', activity };
        }
        return {
          status: 'questions',
          questions: aeoGeoRunQuestions(turn),
          questionsId: createHash('sha256').update(JSON.stringify(turn)).digest('hex'),
          activity,
        };
      }
      if (text) {
        let reply = text.slice(0, 4000);
        if (text.includes(AEO_GEO_QUESTIONS_HEADER)) {
          reply = 'The audit questions could not be read. Start a new audit.';
        } else if (text.trimStart().startsWith('{') || text.trimStart().startsWith('```')) {
          reply = 'The agent did not return a valid audit report. Start a new audit.';
        }
        return { status: 'refused', reply, activity };
      }
      return { status: 'pending', activity };
    }
    const persistence = await this.documents.persistGeneration(req, MKTG_ARTIFACT_SPECS['aeo-geo'], best, project, sessionId);
    return {
      status: 'ready',
      activity,
      documentMarkdown: best.document_markdown,
      version: best.version,
      ...(persistence ? { persistence } : {}),
    };
  }

  public async sendAnswers(
    req: Request,
    sessionId: string,
    documentId: string,
    project: string,
    answers: AeoGeoAnswer[],
    handle: string
  ): Promise<MktgRunResultResponse> {
    if (documentId !== this.documents.runDocumentId(sessionId)) {
      throw ServiceValidationError.forField('documentId', 'The answers must belong to this audit document.');
    }
    const result = await this.getResult(req, sessionId, project);
    if (result.status !== 'questions' || !result.questions) {
      const history = await this.guild.getHistory(req, sessionId);
      if (history.some((message) => message.sender === 'user' && message.text.trimStart().startsWith(AEO_GEO_ANSWERS_HEADER))) return result;
      throw ServiceValidationError.forField('answers', 'This audit is not waiting for answers.');
    }
    for (const answer of answers) {
      const question = result.questions.find((entry) => entry.key === `${AEO_GEO_QUESTION_KEY_PREFIX}${answer.id}`);
      if (!question || (answer.origin === 'accepted' && answer.text.trim() !== question.suggestedAnswer)) {
        throw ServiceValidationError.forField('answers', 'Answer only the questions asked; an accepted answer must keep its suggestion.');
      }
    }
    logger.debug(req, 'aeo_geo_answers', 'Continuing the same audit session', { answers: answers.length, agent_handle: handle });
    // The agent's answers frame must start at the first line; this session already routes to the agent.
    await this.guild.sendFollowUp(req, sessionId, { message: renderAeoGeoAnswers(answers) });
    return { status: 'pending' };
  }
}
