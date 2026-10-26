// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  AEO_GEO_CATEGORIES,
  AEO_GEO_CONTRACT_ID,
  AEO_GEO_QUESTIONS_CONTRACT,
  AEO_GEO_QUESTIONS_HEADER,
  AEO_GEO_ANSWERS_HEADER,
  AEO_GEO_QUESTION_ID_PATTERN,
  AEO_GEO_QUESTION_KEY_PREFIX,
  AEO_GEO_ANSWER_ORIGINS,
  AEO_GEO_DOMAIN_PATTERN,
  AEO_GEO_HTTP_URL_PATTERN,
  AEO_GEO_INTAKE_ERRORS,
  AEO_GEO_MAX_DOCUMENT_BYTES,
  AEO_GEO_SECTIONS,
} from '../constants/aeo-geo.constants';
import type {
  AeoGeoAnswer,
  AeoGeoEnvelope,
  AeoGeoFormPayload,
  AeoGeoQuestionsTurn,
  AeoGeoReport,
  AeoGeoValidationResult,
} from '../interfaces/aeo-geo.interface';
import { extractMktgEnvelopeCandidates } from './mktg-envelope.utils';
import type { MktgRunQuestion } from '../interfaces/mktg-run.interface';

/** Intake rejects literal addresses and private namespaces; RFC 2606 test names remain supported. */
export function isPublicAeoGeoHost(host: string): boolean {
  const name = host.toLowerCase();
  let end = name.length;
  while (end > 0 && name[end - 1] === '.') end--;
  const hostname = name.slice(0, end);
  const lastDot = hostname.lastIndexOf('.');
  if (lastDot < 0 || hostname.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return false;
  }
  const lastLabel = hostname.slice(lastDot + 1);
  if (!lastLabel || Array.from(lastLabel).every((char) => char >= '0' && char <= '9')) {
    return false;
  }
  return !['localhost', 'internal', 'local', 'lan', 'home', 'home.arpa', 'corp', 'intranet', 'onion', 'ip6.arpa', 'in-addr.arpa'].some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
  );
}

/** Same normalization as the live form renderer, with an additional public-host intake guard. */
export function normalizeAeoGeoDomain(input: string): string {
  let domain = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^\/\//, '');
  domain = domain
    .split(/[/?#]/)[0]
    .replace(/^[^@]*@/, '')
    .replace(/:\d+$/, '');
  while (domain.endsWith('.')) domain = domain.slice(0, -1);
  let hostname: string;
  try {
    hostname = new URL(`https://${domain}`).hostname;
  } catch {
    throw new Error(AEO_GEO_INTAKE_ERRORS.domain);
  }
  if (hostname !== domain || !AEO_GEO_DOMAIN_PATTERN.test(hostname) || !isPublicAeoGeoHost(hostname)) {
    throw new Error(AEO_GEO_INTAKE_ERRORS.domain);
  }
  return hostname;
}

export function aeoGeoKeyPages(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Shared field and submit rule: an absolute http(s) URL with a public website hostname. */
export function isAeoGeoKeyPageUrl(url: string): boolean {
  try {
    return AEO_GEO_HTTP_URL_PATTERN.test(url) && isPublicAeoGeoHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function validateAeoGeoIntakeAnswers(answers: unknown): AeoGeoValidationResult {
  const errors: string[] = [];
  if (!isRecord(answers) || Object.keys(answers).some((key) => !['domain', 'key_pages', 'project_name', 'project_uid'].includes(key))) {
    return { valid: false, errors: ['answers must contain domain and only optional key_pages, project_name and project_uid'] };
  }
  try {
    if (typeof answers['domain'] !== 'string') {
      throw new Error();
    }
    normalizeAeoGeoDomain(answers['domain']);
  } catch {
    errors.push(AEO_GEO_INTAKE_ERRORS.domain);
  }
  const value = answers['key_pages'];
  if (value !== undefined) {
    const pages = typeof value === 'string' ? aeoGeoKeyPages(value) : [];
    if (
      typeof value !== 'string' ||
      (pages.length > 0 && (pages.length < 2 || pages.length > 5 || new Set(pages).size !== pages.length || !pages.every(isAeoGeoKeyPageUrl)))
    ) {
      errors.push(AEO_GEO_INTAKE_ERRORS.key_pages);
    }
  }
  for (const key of ['project_name', 'project_uid']) {
    const scope = answers[key];
    if (scope !== undefined && (typeof scope !== 'string' || !scope.trim() || scope.trim().length > 200)) {
      errors.push(`${key} must be a non-empty string of at most 200 characters`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Call only after validating the string answers. One-off reports always start at v1. */
export function buildAeoGeoFormPayload(answers: Record<string, string>): AeoGeoFormPayload {
  const pages = aeoGeoKeyPages(answers['key_pages'] ?? '');
  return {
    type: 'aeo_geo_intake_form',
    domain: normalizeAeoGeoDomain(answers['domain']),
    ...(pages.length ? { key_pages: pages } : {}),
    ...(answers['project_name'] ? { project_name: answers['project_name'].trim() } : {}),
    ...(answers['project_uid'] ? { project_uid: answers['project_uid'].trim() } : {}),
  };
}

/** Verbatim form-mode message from agents/aeo-geo/src/form.ts (without the unused revision block). */
export function renderAeoGeoFormText(input: AeoGeoFormPayload, now: Date = new Date()): string {
  const domain = normalizeAeoGeoDomain(input.domain);
  const lines = [
    'BATCH INTAKE SUBMISSION (form mode — see MODE RULES in your instructions).',
    'The audit request was collected on a single LFX form and is provided below.',
    'Read the sources first, then ask one round of genuine gap questions if needed.',
    'Start with Phase 1; do not stop for progress updates.',
    '',
    `TARGET DOMAIN: ${domain}`,
    `Use exactly this string as the domain: in the title line "# AEO/GEO Analysis: ${domain}",`,
    `in the filename "${domain} AEO-GEO Report.md", and as the finalize tool's`,
    '`domain` argument. Fetch the site at https://' + domain + '/ (Phase 1).',
    `Audit date for the report's "<Audit type> — <date>" line: ${now.toISOString().slice(0, 10)}.`,
    '',
  ];
  // Mirrors 2.0's scope block; 1.0's TEXT parser ignores this extra line.
  // The 1.0 structured-form schema is strict, so the BFF must keep sending text.
  if (input.project_name !== undefined || input.project_uid !== undefined) {
    lines.push(`LFX SCOPE: ${JSON.stringify({ project_name: input.project_name ?? null, project_uid: input.project_uid ?? null })}`, '');
  }
  if (input.key_pages !== undefined) {
    lines.push(
      `KEY PAGES (Phase 2): the requester named these ${input.key_pages.length} pages. Audit exactly`,
      'these (plus the homepage) as your key pages; fetch other pages only when',
      'a finding needs them, and list everything you fetched under Sources.',
      ...input.key_pages.map((url) => `- ${url}`),
      ''
    );
  } else {
    lines.push(
      'KEY PAGES (Phase 2): none provided — identify and fetch 2–5 key pages',
      'yourself from the homepage nav, llms.txt and sitemap, as your Phase 2',
      'instructions say.',
      ''
    );
  }
  return lines.join('\n');
}

export function extractAeoGeoEnvelopeCandidates(payload: string): unknown[] {
  return extractMktgEnvelopeCandidates(payload, AEO_GEO_CONTRACT_ID);
}

/** Schema + report gates S1/G1–G4. The BFF must ALSO recompute content_sha256. */
export function isAeoGeoEnvelope(value: unknown): value is AeoGeoEnvelope {
  if (
    !isRecord(value) ||
    !onlyKeys(value, [
      'contract',
      'kind',
      'domain',
      'report_filename',
      'version',
      'document_markdown',
      'content_sha256',
      'overall_score',
      'verdict',
      'scores',
      'report',
      'inputs',
      'capabilities',
      'intake',
      'generated_at',
      'agent',
    ])
  ) {
    return false;
  }
  const { domain, document_markdown: markdown, scores, inputs, capabilities, intake, agent } = value;
  if (
    value['contract'] !== AEO_GEO_CONTRACT_ID ||
    value['kind'] !== 'aeo-geo-report' ||
    typeof domain !== 'string' ||
    !AEO_GEO_DOMAIN_PATTERN.test(domain) ||
    value['report_filename'] !== `${domain} AEO-GEO Report.md` ||
    !integerIn(value['version'], 1, Number.MAX_SAFE_INTEGER) ||
    !sha(value['content_sha256']) ||
    typeof markdown !== 'string' ||
    markdown.length < 500 ||
    new TextEncoder().encode(markdown).length > AEO_GEO_MAX_DOCUMENT_BYTES ||
    typeof value['verdict'] !== 'string' ||
    !value['verdict'].length
  ) {
    return false;
  }
  if (
    !isRecord(scores) ||
    !onlyKeys(
      scores,
      AEO_GEO_CATEGORIES.map(({ key }) => key)
    ) ||
    !AEO_GEO_CATEGORIES.every(({ key }) => integerIn(scores[key], 0, 10))
  ) {
    return false;
  }
  const overall = Math.round((AEO_GEO_CATEGORIES.reduce((sum, { key }) => sum + Number(scores[key]), 0) / 6) * 10) / 10;
  if (
    value['overall_score'] !== overall ||
    !isRecord(inputs) ||
    !onlyKeys(inputs, ['key_pages_provided', 'key_pages_count', 'pages_audited']) ||
    typeof inputs['key_pages_provided'] !== 'boolean' ||
    inputs['key_pages_provided'] !== (inputs['key_pages_count'] !== undefined) ||
    (inputs['key_pages_count'] !== undefined && !integerIn(inputs['key_pages_count'], 2, 5))
  ) {
    return false;
  }
  const pages = inputs['pages_audited'];
  if (
    !Array.isArray(pages) ||
    pages.length < 1 ||
    pages.length > 20 ||
    new Set(pages).size !== pages.length ||
    !pages.every((url) => typeof url === 'string' && AEO_GEO_HTTP_URL_PATTERN.test(url) && markdown.includes(url))
  ) {
    return false;
  }
  if (
    !isRecord(capabilities) ||
    !onlyKeys(capabilities, ['web_fetch', 'web_search']) ||
    typeof capabilities['web_fetch'] !== 'boolean' ||
    typeof capabilities['web_search'] !== 'boolean' ||
    !isRecord(intake) ||
    !onlyKeys(intake, ['mode', 'completed_at']) ||
    intake['mode'] !== 'form' ||
    !timestamp(intake['completed_at']) ||
    !timestamp(value['generated_at']) ||
    !isRecord(agent) ||
    !onlyKeys(agent, ['identifier', 'agent_version', 'prompt_manifest_sha256']) ||
    typeof agent['agent_version'] !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(agent['agent_version']) ||
    !sha(agent['prompt_manifest_sha256']) ||
    (agent['identifier'] !== undefined && (typeof agent['identifier'] !== 'string' || !/^[a-z0-9][a-z0-9-]*~[a-z0-9][a-z0-9-]*$/.test(agent['identifier'])))
  ) {
    return false;
  }
  const lines = markdown.split(/\r?\n/).map((line) => line.trimEnd());
  const headings = [`# AEO/GEO Analysis: ${domain}`, ...AEO_GEO_SECTIONS];
  const positions = headings.map((heading) => lines.indexOf(heading));
  if (positions.some((position, index) => position < 0 || (index > 0 && position <= positions[index - 1]))) {
    return false;
  }
  const headline = markdown.match(/^Overall score: \*\*(\d{1,2}(?:\.\d)?) \/ 10\*\* — (.*)$/m);
  if (
    !headline ||
    headline[1] !== overall.toFixed(1) ||
    headline[2].trim().replace(/\.$/, '').trim() !== value['verdict'] ||
    !lines.includes('| Category | Score | Summary |')
  ) {
    return false;
  }
  const rows = lines.flatMap((line) => {
    if (!line.startsWith('|')) return [];
    const cells = line.split('|').map((cell) => cell.trim());
    const scoreCell = cells[2];
    if (cells.length < 4 || scoreCell === undefined || scoreCell.length > 16) return [];
    const score = scoreCell.match(/^(\d{1,2})\s*\/\s*10$/);
    return score ? [{ category: cells[1], score: Number(score[1]) }] : [];
  });
  // Mirror the agent's G1 gate: other N/10 rows are allowed anywhere in the
  // report. The first row for each exact category label determines its score.
  let lastIndex = -1;
  for (const { key, label } of AEO_GEO_CATEGORIES) {
    const index = rows.findIndex((row) => row.category === label);
    if (index === -1 || index < lastIndex || rows[index].score !== scores[key]) {
      return false;
    }
    lastIndex = Math.max(lastIndex, index);
  }
  const report = value['report'];
  return (
    report === undefined ||
    (isAeoGeoReport(report) &&
      report.overall_score === overall &&
      report.verdict === value['verdict'] &&
      report.scorecard.every((row) => row.score === scores[row.key]) &&
      pages.every((page) => report.sources.some((source) => source.url === page && source.role === 'audited')))
  );
}

/** Safe external links only; evidence that is not a URL remains readable plain text. */
export function aeoGeoHttpLink(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? value : null;
  } catch {
    return null;
  }
}

/** Frozen report fields are required; additional presentation fields remain forward compatible. */
export function isAeoGeoReport(value: unknown): value is AeoGeoReport {
  if (
    !isRecord(value) ||
    typeof value['headline'] !== 'string' ||
    value['headline'].length === 0 ||
    typeof value['verdict'] !== 'string' ||
    value['verdict'].length === 0 ||
    !Array.isArray(value['scorecard']) ||
    value['scorecard'].length !== 6 ||
    !Array.isArray(value['findings']) ||
    !value['findings'].length ||
    value['findings'].length > 8 ||
    !Array.isArray(value['recommendations']) ||
    !value['recommendations'].length ||
    value['recommendations'].length > 10 ||
    !nonemptyStringList(value['caveats']) ||
    !Array.isArray(value['sources'])
  ) {
    return false;
  }
  if (
    !value['scorecard'].every(
      (row, i) =>
        isRecord(row) &&
        row['key'] === AEO_GEO_CATEGORIES[i]?.key &&
        row['label'] === AEO_GEO_CATEGORIES[i]?.label &&
        integerIn(row['score'], 0, 10) &&
        typeof row['summary'] === 'string' &&
        row['summary'].length > 0
    )
  ) {
    return false;
  }
  const total = value['scorecard'].reduce((sum, row) => sum + Number(isRecord(row) ? row['score'] : NaN), 0);
  if (
    value['overall_score'] !== Math.round((total / 6) * 10) / 10 ||
    !value['findings'].every(
      (row) =>
        isRecord(row) &&
        typeof row['title'] === 'string' &&
        row['title'].length > 0 &&
        typeof row['detail'] === 'string' &&
        row['detail'].length > 0 &&
        reportCategory(row['category']) &&
        nonemptyStringList(row['evidence'])
    )
  ) {
    return false;
  }
  let priority = 1;
  for (const row of value['recommendations']) {
    if (
      !isRecord(row) ||
      !integerIn(row['priority'], 1, Number.MAX_SAFE_INTEGER) ||
      row['priority'] !== priority ||
      typeof row['title'] !== 'string' ||
      row['title'].length === 0 ||
      typeof row['detail'] !== 'string' ||
      row['detail'].length === 0 ||
      !reportCategory(row['category'])
    ) {
      return false;
    }
    priority++;
  }
  return value['sources'].every(
    (row) =>
      isRecord(row) &&
      typeof row['url'] === 'string' &&
      AEO_GEO_HTTP_URL_PATTERN.test(row['url']) &&
      typeof row['role'] === 'string' &&
      ['audited', 'external', 'search'].includes(row['role'])
  );
}

export function isAeoGeoQuestionsTurn(value: unknown): value is AeoGeoQuestionsTurn {
  if (
    !isRecord(value) ||
    !onlyKeys(value, ['contract', 'project', 'questions']) ||
    value['contract'] !== AEO_GEO_QUESTIONS_CONTRACT ||
    typeof value['project'] !== 'string' ||
    !value['project'].trim() ||
    !Array.isArray(value['questions']) ||
    value['questions'].length < 1 ||
    value['questions'].length > 6
  ) {
    return false;
  }
  const ids = new Set<string>();
  return value['questions'].every((q) => {
    if (
      !isRecord(q) ||
      !onlyKeys(q, ['id', 'question', 'why', 'suggested_answer', 'basis']) ||
      typeof q['id'] !== 'string' ||
      !AEO_GEO_QUESTION_ID_PATTERN.test(q['id']) ||
      q['id'].length > 40 ||
      ids.has(q['id']) ||
      typeof q['question'] !== 'string' ||
      q['question'].trim().length < 10 ||
      q['question'].trim().length > 400 ||
      !q['question'].trimEnd().endsWith('?') ||
      typeof q['why'] !== 'string' ||
      !q['why'].trim() ||
      q['why'].trim().length > 400 ||
      typeof q['suggested_answer'] !== 'string' ||
      q['suggested_answer'].trim().length > 2000 ||
      typeof q['basis'] !== 'string' ||
      q['basis'].trim().length > 600 ||
      Boolean(q['suggested_answer'].trim()) !== Boolean(q['basis'].trim())
    ) {
      return false;
    }
    ids.add(q['id']);
    return true;
  });
}

/** Same one-fence boundary as the agent's parser; only a final-answer event calls it in the BFF. */
export function parseAeoGeoQuestionsTurn(text: string): AeoGeoQuestionsTurn | null {
  if (typeof text !== 'string' || text.length > 65_536) {
    return null;
  }
  const start = text.indexOf(AEO_GEO_QUESTIONS_HEADER);
  if (start < 0) {
    return null;
  }
  const body = text.slice(start + AEO_GEO_QUESTIONS_HEADER.length);
  let i = 0;
  while (i < body.length && /\s/.test(body[i])) {
    i++;
  }
  if (!i || body[i - 1] !== '\n' || !body.startsWith('```json', i)) {
    return null;
  }
  i += 7;
  const fenceEnd = i;
  while (i < body.length && /\s/.test(body[i])) {
    i++;
  }
  const close = body.lastIndexOf('\n```');
  if (i === fenceEnd || body[i - 1] !== '\n' || close < i - 1 || body.slice(close + 4).trim()) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(body.slice(i, Math.max(i, close)));
    return isAeoGeoQuestionsTurn(value) ? value : null;
  } catch {
    return null;
  }
}

export function aeoGeoRunQuestions(turn: AeoGeoQuestionsTurn): MktgRunQuestion[] {
  return turn.questions.map((q) => ({
    key: `${AEO_GEO_QUESTION_KEY_PREFIX}${q.id}`,
    label: q.id.replace(/-/g, ' '),
    question: q.question.trim(),
    why: q.why.trim(),
    suggestedAnswer: q.suggested_answer.trim(),
    basis: q.basis
      .split(/[;,]/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  }));
}

/** Progress/tool text is never a final questions/refusal turn. */
export function latestAeoGeoFinalText(payloads: string[]): string | null {
  let latest: string | null = null;
  for (const payload of payloads) {
    try {
      const event: unknown = JSON.parse(payload);
      if (isRecord(event) && event['type'] === 'agent_notification_message') {
        const content = event['content'];
        if (typeof content === 'string') {
          latest = content;
        } else if (isRecord(content) && content['type'] === 'text' && typeof content['data'] === 'string') {
          latest = content['data'];
        }
      }
    } catch {
      /* Non-event payloads are not user-facing turns. */
    }
  }
  return latest;
}

export function isAeoGeoAnswers(value: unknown): value is AeoGeoAnswer[] {
  if (!Array.isArray(value) || value.length > 6) {
    return false;
  }
  const ids = new Set<string>();
  return value.every((a) => {
    if (
      !isRecord(a) ||
      !onlyKeys(a, ['id', 'text', 'origin']) ||
      typeof a['id'] !== 'string' ||
      a['id'].length > 40 ||
      !AEO_GEO_QUESTION_ID_PATTERN.test(a['id']) ||
      ids.has(a['id']) ||
      typeof a['text'] !== 'string' ||
      a['text'].length > 10_000 ||
      !AEO_GEO_ANSWER_ORIGINS.some((origin) => origin === a['origin'])
    ) {
      return false;
    }
    ids.add(a['id']);
    return true;
  });
}

/** Byte-for-byte equivalent of the agent's renderAnswersTurn and guardText. */
export function renderAeoGeoAnswers(answers: AeoGeoAnswer[]): string {
  if (!isAeoGeoAnswers(answers)) {
    throw new Error('Invalid audit answers.');
  }
  const lines: string[] = [AEO_GEO_ANSWERS_HEADER];
  for (const a of answers) {
    const guarded = a.text
      .replace(/\r\n?|\u2028|\u2029/g, '\n')
      .split('\n')
      .map((line) => (/^(?:BATCH INTAKE|TARGET DOMAIN:|KEY PAGES|FEEDBACK on report|LFX SCOPE:|--- |AEO\/GEO —|END NOTES)/.test(line) ? `> ${line}` : line))
      .join('\n');
    lines.push(`--- A ${a.id} (${a.origin}) ---`, 'ANSWER: follows', guarded, `--- END A ${a.id} ---`);
  }
  return lines.join('\n');
}

function nonemptyStringList(value: unknown): value is string[] {
  return stringList(value) && value.every((entry) => entry.length > 0);
}
function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
function reportCategory(value: unknown): boolean {
  return value === null || AEO_GEO_CATEGORIES.some(({ key }) => key === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function onlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).every((key) => keys.includes(key));
}
function integerIn(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
function sha(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
function timestamp(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value));
}
