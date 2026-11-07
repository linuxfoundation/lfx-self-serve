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
  AEO_GEO_READER_CAVEATS,
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
      'quality',
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

// Reader caveats. Every pattern below is linear in the input (one quantified run per anchor), and a caveat
// above CAVEAT_MAX_CHARS is not scanned at all. No lookbehind: Safari before 16.4 has none.
const CAVEAT_MAX_CHARS = 4000;
// Quote class: straight, curly (U+2018/2019/201C/201D) and backtick.
// An abbreviation's period is masked before the split and restored after, so "e.g. the" is not a boundary.
const CAVEAT_ABBREVIATION = /\b(e\.g|i\.e|etc|vs|cf|approx|no)\.(?= )/gi;
const CAVEAT_ABBREVIATION_MARK = '\u0001';
// A boundary is . ! or ? (with closing quotes or brackets) before whitespace and any non-space, so "robots.txt …" is its own sentence.
// The whitespace inside a quoted span is masked first, so a quoted title ("What is AEO?") or a provider's
// multi-sentence message stays one unit.
const CAVEAT_SENTENCE_BOUNDARY = /([.!?]['"\u2018\u2019\u201c\u201d`)\]]*)\s+(?=\S)/g;
const CAVEAT_SENTENCE_MARK = '\u0000';
const CAVEAT_QUOTE_SPACE_MARK = '\u0002';
// A stop inside a closing quote followed by a lowercase WORD continues the sentence ("What is AEO?" as its first result).
// A word is lowercase letters with inner hyphens or apostrophes (well-known, isn't), and it ends at whitespace, sentence
// punctuation or a dot not followed by a letter or digit, so a file name (robots.txt, llms-full.txt, sitemap.xml) or a
// property (og:site_name) after the quote opens its own sentence.
const CAVEAT_QUOTE_CONTINUATION = /([.!?]['"\u2019\u201d`]+)(\s+)(?=\p{Ll}[\p{Ll}'\u2019-]*(?:$|[\s,;!?)\]]|\.(?![\p{L}\p{N}])))/gu;
const CAVEAT_PARENTHETICAL = /\(([^()]*)\)/g;
const CAVEAT_WORD_CHARACTER = /[\p{L}\p{N}]/u;
// The classifier decides by the sentence's SUBJECT. A provider subject (a search, the provider, the API, a lookup)
// that names a credits or quota limit, or quotes a message after returned/responded/failed/error/message with
// evidence of failure (a failure word or an error status, inside the quotes or outside them), is a provider
// failure: a search subject maps to one fixed sentence, another provider subject is left out. A quoted successful
// result or result title is never a failure, and a sentence about the audited site (its pages, fetches,
// statuses, rate limiting) passes verbatim.
const CAVEAT_NAME_SEARCH = /\bname search\b/i;
const CAVEAT_SEARCH_SUBJECT = /^(?:(?:the|our|a|an)\s+)?(?:(?:web|third[- ]party)[\s-]+)?search(?:es)?(?:\s+(?:provider|service|API|engine))?\b/i;
const CAVEAT_PROVIDER_SUBJECT = /^(?:(?:the|our|a|an)\s+)?(?:provider|API|lookup)\b/i;
const CAVEAT_LFX_RECORD = /LFX record could not be read/i;
const CAVEAT_PROVIDER_WORDS = /exceeded your credits|credits? limit|quota (?:exceeded|exhausted)/i;
const CAVEAT_QUOTED_MESSAGE = /\b(?:returned|responded(?: with)?|failed(?: with)?|error|message)\s*(?::\s*)?['"\u2018\u201c`]/i;
// Failure evidence: only an error status (4xx or 5xx) counts, never a successful one (HTTP 200) or a number in a title ("Top 100"):
// inside the quotes a bare error status counts; outside them only after HTTP or status ("the first 60 KB" is no status).
const CAVEAT_FAILURE_WORDS = 'unavailable|error|denied|unauthori[sz]ed|forbidden|exceeded|limit|timeout|timed out|quota|credits?|rate[- ]limited';
const CAVEAT_FAILURE_IN_QUOTES = new RegExp(`\\b(?:${CAVEAT_FAILURE_WORDS}|[45]\\d{2})\\b`, 'i');
const CAVEAT_FAILURE_OUTSIDE_QUOTES = new RegExp(`\\b(?:${CAVEAT_FAILURE_WORDS}|(?:HTTP|status)\\s*[45]\\d{2})\\b`, 'i');
const CAVEAT_RESULT_TITLE = [
  /['"\u2018\u201c`][^'"\u2019\u201d`]*['"\u2019\u201d`]\s+as (?:its|the) (?:top|first|best|second|leading)\b[^.]*\bresult/i,
  /\b(?:titled|entitled|called|named)\s*['"\u2018\u201c`]/i,
];
// Quoted spans are blanked before the credits/quota test on a result-title sentence: the words belong to the title.
const CAVEAT_QUOTED_SPANS = [/"[^"]*"/g, /`[^`]*`/g, /\u201c[^\u201d]*\u201d/g, /\u2018[^\u2019]*\u2019/g, /(^|[\s(])'[^']*'(?=$|[\s).,;:!?])/g];
// A symmetric delimiter with an odd count in the text (an inch mark, a truncated quote) opens no span: it would pair with the next one.
const CAVEAT_SYMMETRIC_QUOTES: [string, RegExp][] = [
  ['"', CAVEAT_QUOTED_SPANS[0]],
  ['`', CAVEAT_QUOTED_SPANS[1]],
];
const CAVEAT_IDENTIFIERS = [
  // a snake_case field name as a standalone token: not part of a file name, a path, an og: property or a code span
  /(?:^|[^:/.\-`\w])[a-z]+(?:_[a-z0-9]+)+(?![./\-`\w])/,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, // a UUID
  /\bslug\s+[a-z0-9]+(?:-[a-z0-9]+)+\b/i, // a hyphenated slug token
  /\b(?:uid|id)\b(?!=['"])\s*(?:[:=]\s*)?['"\u2018\u2019\u201c\u201d`]?[a-z0-9_-]*\d[a-z0-9_-]*/i, // uid/id with a value, not an HTML attribute
];

/**
 * The agent's caveats as reader sentences (web view and print). Sentence by sentence: a failed third-party
 * search and an LFX record that could not be read map to fixed wording; a parenthetical that carries plumbing
 * is removed; a sentence that still carries plumbing is left out. Plumbing is the known shapes: a snake_case
 * field name, a slug, a uid, a credits or quota phrase, or a provider subject (a search, the provider, the API,
 * a lookup) quoting a failure. A quoted result, a quoted title and any sentence about the audited site pass
 * through unchanged, as does a caveat with nothing to map (returned as is); a quotation is never split into
 * sentences; an emptied caveat, or one above 4,000 characters, becomes one fixed sentence.
 */
export function aeoGeoReaderCaveat(caveat: string): string {
  if (caveat.length > CAVEAT_MAX_CHARS) {
    return AEO_GEO_READER_CAVEATS.inputs_unavailable;
  }
  const sentences = maskQuotedSpaces(caveat)
    .replace(CAVEAT_ABBREVIATION, `$1${CAVEAT_ABBREVIATION_MARK}`)
    .replace(CAVEAT_SENTENCE_BOUNDARY, `$1${CAVEAT_SENTENCE_MARK}`)
    .split(CAVEAT_SENTENCE_MARK)
    .map((sentence) => sentence.split(CAVEAT_ABBREVIATION_MARK).join('.').split(CAVEAT_QUOTE_SPACE_MARK).join(' ').trim())
    .filter((sentence) => sentence.length > 0);
  // A sentence scrubbed to nothing but punctuation (a caveat that was only a plumbing parenthetical) is left out, never an empty bullet.
  const kept = sentences.map(readerSentence).filter((sentence) => CAVEAT_WORD_CHARACTER.test(sentence) && !carriesPlumbing(sentence));
  if (!kept.length) {
    return AEO_GEO_READER_CAVEATS.inputs_unavailable;
  }
  const changed = kept.length !== sentences.length || kept.some((sentence, index) => sentence !== sentences[index]);
  return changed ? kept.join(' ') : caveat;
}

/**
 * The report's caveats as reader sentences, in order, each distinct caveat once: two agent caveats that map to
 * the same sentence (two plumbing-only caveats, say, both falling back to the fixed one) print one bullet.
 */
export function aeoGeoReaderCaveats(caveats: readonly string[]): string[] {
  return Array.from(new Set(caveats.map(aeoGeoReaderCaveat)));
}

function readerSentence(sentence: string): string {
  if (providerSubject(sentence) === 'search' && carriesProviderFailure(sentence)) {
    return AEO_GEO_READER_CAVEATS.search_unavailable;
  }
  if (CAVEAT_LFX_RECORD.test(sentence)) {
    return AEO_GEO_READER_CAVEATS.lfx_record_unread;
  }
  const scrubbed = sentence.replace(CAVEAT_PARENTHETICAL, (parenthetical, inner: string) => (carriesPlumbing(inner) ? '' : parenthetical));
  // Only a sentence that lost a parenthetical has its whitespace normalised.
  return scrubbed === sentence
    ? sentence
    : scrubbed
        .split(/\s+/)
        .join(' ')
        .replace(/ ([.,;:!?])/g, '$1')
        .trim();
}

function carriesPlumbing(text: string): boolean {
  return CAVEAT_IDENTIFIERS.some((pattern) => pattern.test(text)) || carriesProviderFailure(text);
}

/**
 * A credits/quota phrase (outside a quoted result title), or a provider subject quoting its message with evidence
 * of failure (a failure word or a 4xx/5xx status) in or around the quotes; a quoted successful result
 * ("Example Foundation", with HTTP 200 or a number in its title) is audit content.
 */
function carriesProviderFailure(sentence: string): boolean {
  const title = CAVEAT_RESULT_TITLE.some((pattern) => pattern.test(sentence));
  if (CAVEAT_PROVIDER_WORDS.test(title ? outsideQuotes(sentence) : sentence)) {
    return true;
  }
  if (title || providerSubject(sentence) === null || !CAVEAT_QUOTED_MESSAGE.test(sentence)) {
    return false;
  }
  return CAVEAT_FAILURE_IN_QUOTES.test(insideQuotes(sentence)) || CAVEAT_FAILURE_OUTSIDE_QUOTES.test(outsideQuotes(sentence));
}

function providerSubject(sentence: string): 'search' | 'provider' | null {
  if (CAVEAT_NAME_SEARCH.test(sentence)) {
    return null;
  }
  if (CAVEAT_SEARCH_SUBJECT.test(sentence)) {
    return 'search';
  }
  return CAVEAT_PROVIDER_SUBJECT.test(sentence) ? 'provider' : null;
}

/** The quoted spans' text, joined; the single-quote rule's leading character is not part of its span. */
function insideQuotes(text: string): string {
  return quotedSpans(text)
    .flatMap((span) => Array.from(text.matchAll(span), (match) => (typeof match[1] === 'string' ? match[0].slice(match[1].length) : match[0])))
    .join(' ');
}

/** Whitespace inside a quoted span, and after a quote-closed stop the sentence continues past, is masked so the split never breaks a quotation. */
function maskQuotedSpaces(text: string): string {
  return quotedSpans(text)
    .reduce(
      (rest, span) =>
        rest.replace(span, (match, lead: unknown) => {
          const keep = typeof lead === 'string' ? lead : '';
          return keep + match.slice(keep.length).replace(/\s/g, CAVEAT_QUOTE_SPACE_MARK);
        }),
      text
    )
    .replace(CAVEAT_QUOTE_CONTINUATION, (_match, quote: string, spaces: string) => quote + spaces.replace(/\s/g, CAVEAT_QUOTE_SPACE_MARK));
}

function outsideQuotes(text: string): string {
  // Only the straight-single-quote span captures its leading character; the others have no group.
  return quotedSpans(text).reduce((rest, span) => rest.replace(span, (_match, lead: unknown) => (typeof lead === 'string' ? lead : '') + ' '), text);
}

/** The span rules that apply to this text: a straight quote or backtick with an odd count is left out (one count per delimiter, linear). */
function quotedSpans(text: string): RegExp[] {
  const unbalanced = CAVEAT_SYMMETRIC_QUOTES.filter(([mark]) => text.split(mark).length % 2 === 0).map(([, span]) => span);
  return unbalanced.length ? CAVEAT_QUOTED_SPANS.filter((span) => !unbalanced.includes(span)) : CAVEAT_QUOTED_SPANS;
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

/** Agent protocol shape: empty frames/text remain valid for rendering and retry compatibility. */
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

/** Raw HTTP input policy, deliberately separate from the agent's permissive framing codec. */
export function isAeoGeoSubmittedAnswers(value: unknown): value is AeoGeoAnswer[] {
  return isAeoGeoAnswers(value) && value.length > 0 && value.every((answer) => answer.text.trim().length > 0);
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
