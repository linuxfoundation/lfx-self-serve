// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_MESSAGE_ANSWER_ORIGINS } from '../constants/foundation-message.constants';
import {
  LINKEDIN_ANSWERS_HEADER,
  LINKEDIN_MAX_QUESTIONS,
  LINKEDIN_CONTRACT_ID,
  LINKEDIN_PROFILE_GAP_LABELS,
  LINKEDIN_QUESTIONS_CONTRACT,
  LINKEDIN_QUESTIONS_HEADER,
  LINKEDIN_SOURCE_MAX_BYTES,
} from '../constants/linkedin-post.constants';
import { MKTG_RUN_ACTIVITY_DETAIL_MAX_CHARS } from '../constants/mktg-run-activity.constants';
import type { LinkedinQuestionsTurn, LinkedinQuestionItem, MktgRunActivity, MktgRunActivityKind, MktgRunAnswer, MktgRunQuestion } from '../interfaces';
import { buildMktgRunActivity } from './mktg-run-activity.utils';
import { extractMktgAgentTexts } from './mktg-session-event.utils';
import { neutralizeDelimiters } from './linkedin-post.utils';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function json(value: unknown): Record<string, unknown> | null {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    return record(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Never inspect or return reasoning-progress content, including streaming/final notifications. */
export function publicLinkedinPayloads(payloads: string[]): string[] {
  return payloads.filter((payload) => {
    const event = json(payload);
    if (!event || ['user_message', 'trigger_message'].includes(String(event['type']))) return false;
    const content = json(event['content']);
    return content?.['type'] !== 'application/guild-reasoning-progress';
  });
}

/** Only agent-authored text (not source/tool/user text) can stop on a profile gap round. */
export function linkedinQuestionsFromPayloads(payloads: string[]): LinkedinQuestionsTurn | null {
  let latest: LinkedinQuestionsTurn | null = null;
  for (const payload of publicLinkedinPayloads(payloads)) for (const text of extractMktgAgentTexts(payload)) latest = parseLinkedinQuestions(text) ?? latest;
  return latest;
}

export function parseLinkedinQuestions(text: string): LinkedinQuestionsTurn | null {
  if (text.length > LINKEDIN_SOURCE_MAX_BYTES) return null;
  const start = text.indexOf(LINKEDIN_QUESTIONS_HEADER);
  if (start < 0) return null;
  const match = /^\s+```json\s*\n([\s\S]*?)\n```\s*$/.exec(text.slice(start + LINKEDIN_QUESTIONS_HEADER.length));
  const value = match ? json(match[1]) : null;
  if (
    !value ||
    value['contract'] !== LINKEDIN_QUESTIONS_CONTRACT ||
    typeof value['project'] !== 'string' ||
    !value['project'].trim() ||
    Object.keys(value).some((key) => !['contract', 'project', 'questions'].includes(key))
  )
    return null;
  const items = value['questions'];
  if (!Array.isArray(items) || !items.length || items.length > LINKEDIN_MAX_QUESTIONS) return null;
  const ids = new Set<string>();
  const questions: LinkedinQuestionItem[] = [];
  for (const item of items) {
    if (!record(item) || Object.keys(item).some((key) => !['id', 'question', 'why', 'suggested_answer', 'basis'].includes(key))) return null;
    const { id, question, why, suggested_answer: suggestion, basis } = item;
    if (
      typeof id !== 'string' ||
      !Object.keys(LINKEDIN_PROFILE_GAP_LABELS).includes(id) ||
      ids.has(id) ||
      typeof question !== 'string' ||
      question.trim().length < 10 ||
      question.length > 400 ||
      !question.trimEnd().endsWith('?') ||
      typeof why !== 'string' ||
      !why.trim() ||
      why.length > 400 ||
      typeof suggestion !== 'string' ||
      suggestion.length > 2000 ||
      typeof basis !== 'string' ||
      basis.length > 600 ||
      !!suggestion.trim() !== !!basis.trim()
    )
      return null;
    ids.add(id);
    questions.push({ id, question, why, suggested_answer: suggestion, basis });
  }
  return { contract: LINKEDIN_QUESTIONS_CONTRACT, project: value['project'], questions };
}

export function linkedinRunQuestions(turn: LinkedinQuestionsTurn): MktgRunQuestion[] {
  return turn.questions.map((question) => ({
    key: question.id,
    label: LINKEDIN_PROFILE_GAP_LABELS[question.id] ?? question.id,
    question: question.question,
    why: question.why,
    suggestedAnswer: question.suggested_answer,
    basis: question.basis ? [question.basis] : [],
  }));
}

export function validLinkedinAnswers(value: unknown): value is MktgRunAnswer[] {
  if (!Array.isArray(value) || value.length > LINKEDIN_MAX_QUESTIONS) return false;
  const seen = new Set<string>();
  return value.every((answer) => {
    if (
      !record(answer) ||
      typeof answer['key'] !== 'string' ||
      !Object.keys(LINKEDIN_PROFILE_GAP_LABELS).includes(answer['key']) ||
      seen.has(answer['key']) ||
      typeof answer['text'] !== 'string' ||
      !answer['text'].trim() ||
      answer['text'].length > 4000 ||
      !FOUNDATION_MESSAGE_ANSWER_ORIGINS.some((origin) => origin === answer['origin'])
    )
      return false;
    seen.add(answer['key']);
    return true;
  });
}

/** Byte-compatible with PR61 renderAnswersTurn; delimiters cannot forge another answer. */
export function renderLinkedinAnswers(answers: MktgRunAnswer[]): string {
  const lines = [LINKEDIN_ANSWERS_HEADER];
  for (const answer of answers)
    lines.push(
      `--- A ${answer.key} (${answer.origin}) ---`,
      'ANSWER: follows',
      neutralizeDelimiters(answer.text).replace(/^---.*(?:END A| A ).*---$/gm, (value) => value.replace(/-/g, '~')),
      `--- END A ${answer.key} ---`
    );
  return lines.join('\n');
}

function progressKind(label: string): MktgRunActivityKind {
  if (/\b(?:read(?:ing)?|fetch(?:ing)?|open(?:ing)?|load(?:ing)?)\b/i.test(label)) return 'reading';
  if (/\b(?:search(?:ing)?|research(?:ing)?)\b/i.test(label)) return 'search';
  if (/\b(?:check(?:ing)?|verify(?:ing)?|validat(?:e|ing))\b/i.test(label)) return 'checking';
  return 'writing';
}

/** Reuse main's tool activity labels, adding only ordinary public text progress. */
export function linkedinRunActivity(payloads: string[], completed = false): MktgRunActivity[] {
  const safe = publicLinkedinPayloads(payloads);
  const activity = buildMktgRunActivity(safe);
  const progress = new Map<string, MktgRunActivity>();
  for (const [index, payload] of safe.entries()) {
    const event = json(payload);
    if (event?.['type'] !== 'agent_notification_progress') continue;
    const content = json(event['content']);
    const text =
      content?.['type'] === 'text' ? (content['data'] ?? content['text']) : typeof event['content'] === 'string' && !content ? event['content'] : null;
    if (typeof text !== 'string' || !text.trim() || text.includes(LINKEDIN_CONTRACT_ID) || text.includes(LINKEDIN_QUESTIONS_CONTRACT)) continue;
    const label = text.replace(/\s+/g, ' ').trim().slice(0, MKTG_RUN_ACTIVITY_DETAIL_MAX_CHARS);
    const created =
      typeof event['created_at'] === 'string' && Number.isFinite(Date.parse(event['created_at'])) ? event['created_at'] : '1970-01-01T00:00:00.000Z';
    progress.set(label, { id: `linkedin-progress-${index}`, kind: progressKind(label), label, status: 'done', startedAt: created });
  }
  const rows = [...activity, ...progress.values()].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  if (completed) return rows.map((row): MktgRunActivity => ({ ...row, status: row.status === 'failed' ? 'failed' : 'done' }));
  const last = rows.at(-1);
  return rows.map((row): MktgRunActivity => (row === last && row.status !== 'failed' ? { ...row, status: 'running' } : row));
}
