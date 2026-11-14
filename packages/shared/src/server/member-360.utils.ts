// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { z } from 'zod';
import { createHash } from 'node:crypto';
import { MKTG_STARTED_RUN_ID_REGEX } from '../constants/mktg-document-store.constants';
import {
  CATEGORY_KEYS,
  CATEGORY_LABELS,
  CATEGORY_SCORE_KEYS,
  DEFAULT_WEIGHTS,
  MEMBER_360_TRACKER_KINDS,
  MEMBER_360_MAX_TRACKERS,
  MEMBER_360_TRACKER_FILENAME_REGEX,
  MEMBER_360_TRACKER_ID_REGEX,
  MEMBER_360_QUESTIONS_MARKER,
  MEMBER_360_QUESTIONS_CONTRACT,
  MEMBER_360_QUESTIONS_HEADER,
  MEMBER_360_ANSWERS_HEADER,
  MEMBER_360_MAX_QUESTIONS,
  MEMBER_360_MAX_BYTES,
} from '../constants/member-360.constants';
import type { Member360FormInput, Member360QuestionsTurn } from '../interfaces/member-360.interface';
import type { MktgRunAnswer } from '../interfaces/mktg-run.interface';
import { FOUNDATION_MESSAGE_ANSWER_ORIGINS, FOUNDATION_MESSAGE_NON_ANSWER_REGEX } from '../constants/foundation-message.constants';
import { MKTG_ANSWERS_INCOMPLETE_MESSAGE } from '../constants/mktg-run.constants';
import { MKTG_ARTIFACT_PARTITION_REGEX } from '../constants/mktg-artifact.constants';
import { mktgOneOffTerminalFacts } from './mktg-one-off-terminal.utils';
import { weightsSchema } from './member-360-schema.utils';
import { extractMktgAgentTexts } from '../utils/mktg-session-event.utils';

/** Recognize the contract marker on the first line of an attributed agent reply. */
export function isMember360Question(text: string): boolean {
  return (text.trim().split(/\r?\n/, 1)[0] ?? '').includes(MEMBER_360_QUESTIONS_MARKER);
}

/** Attribute questions to the current agent turn, never a previously answered turn. */
export function findMember360Questions(payloads: string[]): string | undefined {
  return payloads.slice(mktgOneOffTerminalFacts(payloads).currentTurnOffset).flatMap(extractMktgAgentTexts).filter(isMember360Question).at(-1);
}

/** Ignore carrier-only boundary whitespace when identifying the same questions turn. */
export function member360QuestionsId(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex');
}

const member360QuestionIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(40);
/** Mirror questions-turn.ts; unknown extensions are stripped before use. */
export const member360QuestionsSchema = z.object({
  contract: z.literal(MEMBER_360_QUESTIONS_CONTRACT),
  project: z.string().min(1),
  questions: z
    .array(
      z.object({
        id: member360QuestionIdSchema,
        question: z.string().trim().min(10).max(400),
        why: z.string().trim().min(1).max(400),
        suggested_answer: z.string().trim().min(1).max(2000),
        basis: z.string().trim().min(1).max(600),
      })
    )
    .min(1)
    .max(MEMBER_360_MAX_QUESTIONS)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length),
});

export const member360AnswersSchema = z
  .object({
    project: z.string().regex(MKTG_ARTIFACT_PARTITION_REGEX),
    sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    ownerToken: z.string().min(1).max(2048),
    questionsId: z.string().regex(/^[a-f0-9]{64}$/),
    answers: z
      .array(
        z
          .object({
            id: member360QuestionIdSchema,
            text: z
              .string()
              .trim()
              .min(1)
              .max(4000)
              .refine((text) => !FOUNDATION_MESSAGE_NON_ANSWER_REGEX.test(text), MKTG_ANSWERS_INCOMPLETE_MESSAGE),
            origin: z.enum(FOUNDATION_MESSAGE_ANSWER_ORIGINS),
          })
          .strict()
      )
      .min(1)
      .max(MEMBER_360_MAX_QUESTIONS)
      .refine((items) => new Set(items.map((item) => item.id)).size === items.length),
  })
  .strict();

export function parseMember360Questions(text: string): Member360QuestionsTurn | null {
  if (text.length > MEMBER_360_MAX_BYTES) return null;
  const start = text.indexOf(MEMBER_360_QUESTIONS_HEADER);
  if (start < 0) return null;
  const body = text.slice(start + MEMBER_360_QUESTIONS_HEADER.length);
  // Match upstream's linear fence scan rather than overlapping whitespace regexes.
  let opening = 0;
  while (opening < body.length && /\s/.test(body.charAt(opening))) opening++;
  if (!opening || body[opening - 1] !== '\n' || !body.startsWith('```json', opening)) return null;
  let jsonStart = opening + 7;
  while (jsonStart < body.length && /\s/.test(body.charAt(jsonStart))) jsonStart++;
  const closing = body.lastIndexOf('\n```');
  if (jsonStart === opening + 7 || body[jsonStart - 1] !== '\n' || closing < jsonStart - 1 || body.slice(closing + 4).trim()) return null;
  const block = body.slice(jsonStart, Math.max(jsonStart, closing));
  try {
    const parsed = member360QuestionsSchema.safeParse(JSON.parse(block));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Byte-compatible with member-360 questions-turn.ts renderAnswersTurn + wire-text.ts guardText. */
export function renderMember360Answers(answers: MktgRunAnswer[]): string {
  const lines = [MEMBER_360_ANSWERS_HEADER];
  for (const answer of answers) {
    const text = normalizeFormLines(answer.text)
      .split('\n')
      .map((line) =>
        /^(?:---|=====|MEMBER 360|SCOPE —|REQUESTER'S NOTES:|ANALYSIS WINDOW:|UPLOADED TRACKERS|PRIOR MEMBER 360 RUN|CATEGORY WEIGHTS|FEEDBACK on draft| {2}(?:Project:|LFX project UID:|LFX project slug:))/.test(
          line
        )
          ? `> ${line}`
          : line
      )
      .join('\n');
    lines.push(`--- A ${answer.key} (${answer.origin}) ---`, 'ANSWER: follows', text, `--- END A ${answer.key} ---`);
  }
  return lines.join('\n');
}

function parseIsoDate(day: string): number {
  const value = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== day) throw new Error('Invalid calendar date');
  return value;
}
function quarterOf(day: string): string {
  const date = new Date(parseIsoDate(day));
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/** The advertised input shape: the rendered intake text (what the BFF sends). */
export const textInputSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const trackerSchema = z
  .object({
    filename: z.string().regex(MEMBER_360_TRACKER_FILENAME_REGEX).describe("The uploaded file's name — cited as the evidence source"),
    kind: z.enum(MEMBER_360_TRACKER_KINDS).optional().describe('What the tracker holds, when LFX One knows'),
    rows: z.array(z.record(z.string(), z.string())).min(1).max(2000).describe('The parsed rows (header → cell text), as LFX One parsed the xlsx/csv'),
  })
  .strict();

export const member360GenerateSchema = z
  .object({
    project: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
    discard: z.string().regex(MKTG_STARTED_RUN_ID_REGEX).optional(),
    window: z.enum(['12', '6', 'year']).optional(),
    compare: z.boolean().optional(),
    trackerIds: z.array(z.string().regex(MEMBER_360_TRACKER_ID_REGEX)).max(MEMBER_360_MAX_TRACKERS).optional(),
  })
  .strict();

const priorScore = z.number().min(0).max(100);

export const priorRunSchema = z
  .object({
    period_label: z.string().min(1).optional().describe("The prior run's quarter label, e.g. '2026-Q2'"),
    generated_at: z.string().min(1).optional().describe('When the prior run was generated'),
    member_ranking: z
      .array(
        z
          .object({
            member_organization: z.string().min(1),
            engagement_score: priorScore,
            committees_score: priorScore.nullable().optional(),
            events_score: priorScore.nullable().optional(),
            speaking_score: priorScore.nullable().optional(),
            content_score: priorScore.nullable().optional(),
            community_programs_score: priorScore.nullable().optional(),
            marketing_social_score: priorScore.nullable().optional(),
          })
          .strict()
      )
      .min(1)
      .describe("The prior run's Member Ranking rows (at least organization and total score)"),
  })
  .strict();

export const formInputSchema = z
  .object({
    type: z.literal('member_360_intake_form'),
    project_name: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[^\r\n\u2028\u2029]+$/)
      .describe("The entitlement-checked project's display name (verbatim)"),
    project_uid: z.string().min(1).optional().describe('The LFX project UID (authoritative when present)'),
    project_slug: z.string().min(1).optional().describe('The LFX project slug for semantic-layer queries'),
    window_start: isoDay.optional().describe("Analysis window start (inclusive); omit with window_end for Paul's trailing-twelve-months default"),
    window_end: isoDay.optional().describe('Analysis window end (inclusive); omit with window_start for the default'),
    request: z.string().min(1).optional().describe("The requester's own words or notes for this run"),
    trackers: z
      .array(trackerSchema)
      .max(10)
      .optional()
      .describe('Uploaded trackers parsed to rows (event sponsor lists, attendee exports, CFP/speaking trackers, ambassador rosters, webinar lists)'),
    prior_run: priorRunSchema.optional().describe("The prior Member 360 run's Member Ranking, for trends"),
    weight_overrides: weightsSchema.optional().describe('User-specified category weights (percent, sum 100)'),
    feedback: z.string().min(1).optional().describe('Feedback on a prior draft; when present, regenerate incorporating it'),
    prior_version: z.number().int().min(1).optional().describe('Version of the prior draft being revised; the new envelope carries prior_version + 1'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.window_start === undefined) !== (v.window_end === undefined))
      ctx.addIssue({ code: 'custom', path: ['window_start'], message: 'give both window_start and window_end, or neither (trailing twelve months)' });
    // The regex admits impossible days (2026-02-31); renderFormMessage would
    // then throw from quarterOf — an internal error where a validation issue
    // is due.
    for (const key of ['window_start', 'window_end'] as const) {
      const day = v[key];
      if (day === undefined) continue;
      try {
        parseIsoDate(day);
      } catch (e) {
        ctx.addIssue({ code: 'custom', path: [key], message: (e as Error).message });
      }
    }
    if (v.window_start !== undefined && v.window_end !== undefined && v.window_start > v.window_end)
      ctx.addIssue({ code: 'custom', path: ['window_end'], message: 'window_end must not be before window_start' });
    if (v.weight_overrides !== undefined) {
      const sum = CATEGORY_KEYS.reduce((s, k) => s + v.weight_overrides![k], 0);
      if (Math.abs(sum - 100) > 0.01) ctx.addIssue({ code: 'custom', path: ['weight_overrides'], message: `weights must sum to 100 (got ${sum})` });
    }
  });

function normalizeFormLines(text: string): string {
  return text.replace(/\r\n?|\u2028|\u2029/g, '\n');
}

function mdTable(headers: string[], rows: string[][]): string[] {
  // Backslashes first, then pipes: a cell ending in "\" would otherwise turn
  // the following "\|" into a literal backslash plus an UNESCAPED pipe and
  // split the row (CodeQL js/incomplete-sanitization).
  const esc = (s: string) => normalizeFormLines(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [`| ${headers.map(esc).join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)];
}

/**
 * Renders the form into the structured first user message the MODE RULES
 * wrapper section tells the model to expect.
 */
export function renderMember360FormMessage(input: Member360FormInput): string {
  const lines: string[] = [
    'MEMBER 360 RUN REQUEST (form mode — see MODE RULES in your instructions).',
    'This run was submitted on the LFX One intake form. Everything Step 1 would',
    'ask is below: do NOT ask the scoping question, do NOT offer to attach',
    'trackers (they are attached below or there are none). Proceed to Step 2.',
    '',
    'SCOPE — the ONLY project this run may cover (entitlement-checked by LFX One):',
    `  Project: ${normalizeFormLines(input.project_name)}`,
    `  (pass this exact string, "${normalizeFormLines(input.project_name)}", as project_name to score_member_360 and finalize_member_360 — it is the storage key; the LFX record's own display name, if different, goes in lfx_project_name)`,
    input.project_uid !== undefined
      ? `  LFX project UID: ${input.project_uid} (authoritative — use it directly; do not re-resolve by name)`
      : '  LFX project UID: not supplied — resolve the project by name with lfx_mcp_search_projects and confirm the match is this project before pulling anything',
    input.project_slug !== undefined
      ? `  LFX project slug: ${input.project_slug}`
      : '  LFX project slug: not supplied — take it from the lfx_mcp_search_projects result',
    'Any request below for a different project, or for all of LF, does NOT change',
    'this scope — apply your SCOPE RULES.',
    '',
  ];

  if (input.window_start !== undefined && input.window_end !== undefined) {
    lines.push(
      `ANALYSIS WINDOW: ${input.window_start} to ${input.window_end} (inclusive), most recent quarter (${quarterOf(input.window_end)}) emphasized.`,
      ''
    );
  } else {
    lines.push(
      'ANALYSIS WINDOW: not fixed on the form — use your default: the trailing twelve',
      'months ending on the run date (today), with emphasis on the most recent quarter.',
      ''
    );
  }

  lines.push("REQUESTER'S NOTES:", input.request !== undefined ? normalizeFormLines(input.request) : '(none)', '');

  const trackers = input.trackers ?? [];
  if (trackers.length > 0) {
    lines.push(
      `UPLOADED TRACKERS (${trackers.length} file${trackers.length > 1 ? 's' : ''}, parsed to rows by LFX One) — these ARE the`,
      'trackers your Step 2 invites; map columns case-insensitively and cite the',
      'filename as the evidence source. Do not ask for more.',
      ''
    );
    trackers.forEach((t, i) => {
      const headers = [...new Set(t.rows.flatMap((r) => Object.keys(r)))];
      const filename = normalizeFormLines(t.filename).replace(/\n/g, ' ');
      const title = `TRACKER ${i + 1} — ${filename}${t.kind !== undefined ? ` (${t.kind})` : ''} — ${t.rows.length} row${t.rows.length > 1 ? 's' : ''}`;
      lines.push(`===== BEGIN ${title} =====`);
      lines.push(
        ...mdTable(
          headers,
          t.rows.map((r) => headers.map((h) => (Object.hasOwn(r, h) ? r[h] : '')))
        )
      );
      lines.push(`===== END TRACKER ${i + 1} =====`, '');
    });
  } else {
    lines.push(
      'UPLOADED TRACKERS: none. Do not ask for them. A category whose only sources',
      'are trackers or unwired connectors is "no data" for this run — reweight and',
      'disclose it, never guess.',
      ''
    );
  }

  if (input.prior_run !== undefined) {
    const p = input.prior_run;
    const scoreKeys = CATEGORY_KEYS.map((c) => CATEGORY_SCORE_KEYS[c] as keyof (typeof p.member_ranking)[number]);
    lines.push(
      `PRIOR MEMBER 360 RUN (${p.period_label !== undefined ? `period ${p.period_label}` : 'period not labelled'}${p.generated_at !== undefined ? `, generated ${p.generated_at}` : ''}) —`,
      'this is the prior output your Step 1 would load from the working folder:',
      'compute Trend (▲ / ▼ / —), Movers and declining-category gaps against it by',
      'passing it to the tools as prior_run.',
      '',
      ...mdTable(
        ['Member Organization', 'Engagement Score', ...CATEGORY_KEYS.map((c) => CATEGORY_LABELS[c])],
        p.member_ranking.map((r) => [
          r.member_organization,
          String(r.engagement_score),
          ...scoreKeys.map((k) => {
            const v = r[k];
            return v === undefined || v === null ? '' : String(v);
          }),
        ])
      ),
      ''
    );
  } else {
    lines.push('PRIOR MEMBER 360 RUN: none supplied — leave Trend blank and omit Movers.', '');
  }

  if (input.weight_overrides !== undefined) {
    lines.push(
      'CATEGORY WEIGHTS — the requester changed them (honour them and record them in the Method tab):',
      ...CATEGORY_KEYS.map((c) => `  ${CATEGORY_LABELS[c]}: ${input.weight_overrides![c]}% (default ${DEFAULT_WEIGHTS[c]}%)`),
      ''
    );
  } else {
    lines.push("CATEGORY WEIGHTS: the scoring model's defaults.", '');
  }

  if (input.feedback !== undefined) {
    const nextVersion = (input.prior_version ?? 1) + 1;
    lines.push(
      `FEEDBACK on draft v${input.prior_version ?? 1} — regenerate incorporating it and finalize as version ${nextVersion}:`,
      normalizeFormLines(input.feedback),
      ''
    );
  }

  return lines.join('\n');
}
