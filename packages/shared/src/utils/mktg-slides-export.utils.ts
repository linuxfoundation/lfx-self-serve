// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Export to Google Slides: the intake renderer (a line-for-line mirror of
// renderFormMessage in marketing-os-agents agents/slides-export/src/form.ts),
// the result envelope's validator, the plain message of a failed export, and
// the export record's key and reader. Platform-neutral: no hashing here — the
// BFF recomputes `content_sha256` itself.

import {
  MKTG_SLIDES_EXPORT_AGENT_IDENTIFIER,
  MKTG_SLIDES_EXPORT_AGENT_KEYS,
  MKTG_SLIDES_EXPORT_ASSET_KINDS,
  MKTG_SLIDES_EXPORT_ASSETS_CLOSE,
  MKTG_SLIDES_EXPORT_ASSETS_OPEN,
  MKTG_SLIDES_EXPORT_CONTRACT_ID,
  MKTG_SLIDES_EXPORT_DECK_LINK_REGEX,
  MKTG_SLIDES_EXPORT_DECK_NONE,
  MKTG_SLIDES_EXPORT_DECK_TITLE_LABELS,
  MKTG_SLIDES_EXPORT_DRIVE_ID_REGEX,
  MKTG_SLIDES_EXPORT_FAILURE_MESSAGES,
  MKTG_SLIDES_EXPORT_HEX_REGEX,
  MKTG_SLIDES_EXPORT_INTAKE_HEADER,
  MKTG_SLIDES_EXPORT_KEY_PREFIX,
  MKTG_SLIDES_EXPORT_KEY_TIME_DIGITS,
  MKTG_SLIDES_EXPORT_KIND,
  MKTG_SLIDES_EXPORT_LOGO_NOTES,
  MKTG_SLIDES_EXPORT_MODES,
  MKTG_SLIDES_EXPORT_PROJECT_SLUG_REGEX,
  MKTG_SLIDES_EXPORT_RECORD_SCHEMA,
  MKTG_SLIDES_EXPORT_SHA256_REGEX,
  MKTG_SLIDES_EXPORT_SLIDE_KINDS,
} from '../constants/mktg-slides-export.constants';
import type {
  MktgSlidesExportAgentKey,
  MktgSlidesExportAssetKind,
  MktgSlidesExportBranded,
  MktgSlidesExportBrandSummary,
  MktgSlidesExportContent,
  MktgSlidesExportDeckRecord,
  MktgSlidesExportFailure,
  MktgSlidesExportForm,
  MktgSlidesExportLogoNote,
  MktgSlidesExportRecord,
  MktgSlidesExportResultResponse,
  MktgSlidesExportRevisionRef,
  MktgSlidesExportValidationResult,
} from '../interfaces/mktg-slides-export.interface';

type UnknownRecord = Record<string, unknown>;

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCount(value: unknown, min = 0): value is number {
  return Number.isInteger(value) && (value as number) >= min;
}

// ---------------------------------------------------------------------------
// The intake (agents/slides-export/src/form.ts, renderFormMessage)
// ---------------------------------------------------------------------------

/** Today's date (UTC), YYYY-MM-DD. */
export function mktgSlidesExportToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The agent's default title of a new deck (`defaultDeckTitle`). */
export function defaultMktgSlidesExportDeckTitle(projectName: string, runDate: string): string {
  return `${projectName} · Messaging · ${runDate}`;
}

/** The title LFX One gives a new deck: the project, what the deck holds, the date. */
export function mktgSlidesExportDeckTitle(agentKey: MktgSlidesExportAgentKey, projectName: string, runDate: string): string {
  return `${projectName} · ${MKTG_SLIDES_EXPORT_DECK_TITLE_LABELS[agentKey]} · ${runDate}`;
}

/** A value the form takes on one line (a project name, a title): line breaks become spaces. */
export function mktgSlidesExportOneLine(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Embedded JSON can never forge a marker line: a line that would start like one ("--- ") gets one leading space (`guardText`). */
export function guardMktgSlidesExportText(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.startsWith('--- ') ? ` ${line}` : line))
    .join('\n');
}

/** The asset members named on the form, in the deck's order (`namedAssets`). */
export function namedMktgSlidesExportAssets(assets: MktgSlidesExportForm['assets']): MktgSlidesExportAssetKind[] {
  return MKTG_SLIDES_EXPORT_ASSET_KINDS.filter((kind) => assets[kind] !== undefined && assets[kind] !== null);
}

/** The form as the one text message the agent reads; mirrors `renderFormMessage` line for line. */
export function renderMktgSlidesExportFormMessage(form: MktgSlidesExportForm, now: Date = new Date()): string {
  const runDate = form.run_date ?? mktgSlidesExportToday(now);
  const lines: string[] = [
    MKTG_SLIDES_EXPORT_INTAKE_HEADER,
    `PROJECT NAME: ${form.project_name}`,
    `RUN DATE: ${runDate}`,
    `FOLDER ID: ${form.folder_id ?? 'none'}`,
    `DECK ID: ${form.deck_id ?? MKTG_SLIDES_EXPORT_DECK_NONE}`,
    `DECK TITLE: ${form.deck_title ?? defaultMktgSlidesExportDeckTitle(form.project_name, runDate)}`,
    `LOGO URL: ${form.logo_url ?? 'none'}`,
    `ASSETS: ${namedMktgSlidesExportAssets(form.assets).join(', ') || 'none'}`,
    MKTG_SLIDES_EXPORT_ASSETS_OPEN,
    guardMktgSlidesExportText(JSON.stringify(form.assets, null, 2)),
    MKTG_SLIDES_EXPORT_ASSETS_CLOSE,
  ];
  return lines.join('\n');
}

/** Whether a value is a Drive file id as the agent's form takes it. */
export function isMktgSlidesExportDriveId(value: unknown): value is string {
  return typeof value === 'string' && MKTG_SLIDES_EXPORT_DRIVE_ID_REGEX.test(value);
}

/** The link the exporter gives a deck (`deckLink`); the only link LFX One ever shows for one. */
export function mktgSlidesExportDeckLink(deckId: string): string {
  return `https://docs.google.com/presentation/d/${deckId}/edit`;
}

/** Whether a value is one of the documents that export. */
export function isMktgSlidesExportAgentKey(value: unknown): value is MktgSlidesExportAgentKey {
  return (MKTG_SLIDES_EXPORT_AGENT_KEYS as readonly unknown[]).includes(value);
}

// ---------------------------------------------------------------------------
// The result envelope (agents/slides-export/src/envelope.ts)
// ---------------------------------------------------------------------------

/** What `content_sha256` hashes: the content as JSON, key order as emitted. */
export function mktgSlidesExportContentJson(content: MktgSlidesExportContent): string {
  return JSON.stringify(content);
}

function brandedErrors(value: unknown): string[] {
  if (!isRecord(value)) {
    return ['content.branded must be an object'];
  }
  const errors: string[] = [];
  for (const key of ['kit', 'logo']) {
    if (typeof value[key] !== 'boolean') {
      errors.push(`content.branded.${key} must be a boolean`);
    }
  }
  for (const key of ['backgrounds', 'text_colors', 'fonts', 'bars', 'logos', 'logos_skipped']) {
    if (!isCount(value[key])) {
      errors.push(`content.branded.${key} must be an integer >= 0`);
    }
  }
  const header = value['tables_header'];
  if (header !== null && !(typeof header === 'string' && MKTG_SLIDES_EXPORT_HEX_REGEX.test(header))) {
    errors.push('content.branded.tables_header must be #RRGGBB or null');
  }
  return errors;
}

function contentErrors(value: unknown): string[] {
  if (!isRecord(value)) {
    return ['content must be an object'];
  }
  const errors: string[] = [];
  const assets = value['assets'];
  if (!Array.isArray(assets) || assets.length === 0 || !assets.every((kind) => (MKTG_SLIDES_EXPORT_ASSET_KINDS as readonly unknown[]).includes(kind))) {
    errors.push(`content.assets must be a non-empty list of ${MKTG_SLIDES_EXPORT_ASSET_KINDS.join(', ')}`);
  }
  const slides = value['slides'];
  if (!Array.isArray(slides) || slides.length === 0) {
    errors.push('content.slides must be a non-empty list');
  } else {
    slides.forEach((slide, index) => {
      const valid =
        isRecord(slide) &&
        isCount(slide['index'], 1) &&
        (MKTG_SLIDES_EXPORT_SLIDE_KINDS as readonly unknown[]).includes(slide['kind']) &&
        isText(slide['layout']) &&
        typeof slide['title'] === 'string' &&
        isText(slide['object_id']);
      if (!valid) {
        errors.push(`content.slides[${index}] must be { index, kind, layout, title, object_id }`);
      }
    });
  }
  errors.push(...brandedErrors(value['branded']));
  return errors;
}

function deckErrors(value: unknown): string[] {
  if (!isRecord(value)) {
    return ['deck must be an object'];
  }
  const errors: string[] = [];
  if (!isMktgSlidesExportDriveId(value['id'])) {
    errors.push('deck.id must be a Drive file id');
  } else if (value['link'] !== mktgSlidesExportDeckLink(value['id'])) {
    // The link is the deck's own Slides address, never anything else.
    errors.push('deck.link must be the deck’s Google Slides link');
  }
  if (value['title'] !== null && typeof value['title'] !== 'string') {
    errors.push('deck.title must be a string or null');
  }
  if (value['folder_id'] !== null && typeof value['folder_id'] !== 'string') {
    errors.push('deck.folder_id must be a string or null');
  }
  return errors;
}

/**
 * Validate a candidate against the slides-export-output/v1 schema (the
 * `content_sha256` recompute is the caller's). The deck's link must be its
 * own Google Slides address, and the agent must be the exporter.
 */
export function validateMktgSlidesExportEnvelope(candidate: unknown): MktgSlidesExportValidationResult {
  if (!isRecord(candidate)) {
    return { valid: false, errors: ['envelope must be a JSON object'] };
  }
  const errors: string[] = [];
  if (candidate['contract'] !== MKTG_SLIDES_EXPORT_CONTRACT_ID) {
    errors.push(`contract must be "${MKTG_SLIDES_EXPORT_CONTRACT_ID}"`);
  }
  if (candidate['kind'] !== MKTG_SLIDES_EXPORT_KIND) {
    errors.push(`kind must be "${MKTG_SLIDES_EXPORT_KIND}"`);
  }
  if (typeof candidate['project'] !== 'string' || !MKTG_SLIDES_EXPORT_PROJECT_SLUG_REGEX.test(candidate['project'])) {
    errors.push('project must be a lowercase kebab-case slug');
  }
  if (!isText(candidate['project_name'])) {
    errors.push('project_name must be a non-empty string');
  }
  if (!(MKTG_SLIDES_EXPORT_MODES as readonly unknown[]).includes(candidate['mode'])) {
    errors.push(`mode must be one of ${MKTG_SLIDES_EXPORT_MODES.join(', ')}`);
  }
  errors.push(...deckErrors(candidate['deck']));
  if (!isCount(candidate['slide_count'], 1)) {
    errors.push('slide_count must be an integer >= 1');
  }
  errors.push(...contentErrors(candidate['content']));
  if (typeof candidate['content_sha256'] !== 'string' || !MKTG_SLIDES_EXPORT_SHA256_REGEX.test(candidate['content_sha256'])) {
    errors.push('content_sha256 must be 64 lowercase hex characters');
  }
  if (typeof candidate['generated_at'] !== 'string' || !ISO_DATE_TIME.test(candidate['generated_at'])) {
    errors.push('generated_at must be an ISO-8601 date-time');
  }
  const agent = candidate['agent'];
  if (!isRecord(agent) || agent['identifier'] !== MKTG_SLIDES_EXPORT_AGENT_IDENTIFIER || !isText(agent['agent_version'])) {
    errors.push(`agent must be { identifier: "${MKTG_SLIDES_EXPORT_AGENT_IDENTIFIER}", agent_version }`);
  }
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// A failed export, in plain words
// ---------------------------------------------------------------------------

/**
 * What kind of failure the exporter's error text describes (its own error
 * messages, agents/slides-export/src), and the deck it names when the deck
 * was already copied or opened. The text itself is never shown.
 */
export function classifyMktgSlidesExportFailure(text: string): { failure: MktgSlidesExportFailure; deckLink: string | null } {
  const deckLink = MKTG_SLIDES_EXPORT_DECK_LINK_REGEX.exec(text)?.[0] ?? null;
  if (/is not a Google Slides presentation/i.test(text)) {
    return { failure: 'not-a-deck', deckLink: null };
  }
  if (/failed after the deck was (?:copied|opened)/i.test(text)) {
    return { failure: 'partial', deckLink };
  }
  if (/not a Slides export intake|intake:|assets[.:]|kit:|nothing to export/i.test(text)) {
    return { failure: 'intake', deckLink: null };
  }
  if (/\bfailed:|returned no|Drive|Slides|presentation|BadGateway|MCP|fetch failed|timed? ?out|rate limit|quota/i.test(text)) {
    return { failure: 'google', deckLink };
  }
  return { failure: 'unknown', deckLink };
}

/** The failed result a poll answers: the plain message, and the deck when one was left behind. */
export function mktgSlidesExportFailed(
  failure: MktgSlidesExportFailure,
  deckLink: string | null = null
): Extract<MktgSlidesExportResultResponse, { status: 'failed' }> {
  return { status: 'failed', failure, message: MKTG_SLIDES_EXPORT_FAILURE_MESSAGES[failure], deckLink };
}

// ---------------------------------------------------------------------------
// The export record
// ---------------------------------------------------------------------------

/** The prefix of a document's export records. */
export function buildMktgSlidesExportPrefix(project: string, agentKey: MktgSlidesExportAgentKey, documentId: string): string {
  return `${MKTG_SLIDES_EXPORT_KEY_PREFIX}/${project}/${agentKey}/${documentId}/`;
}

/** A record's key: the export time (zero-padded epoch ms, so the newest sorts last) and the hash of its bytes. */
export function buildMktgSlidesExportRecordKey(
  project: string,
  agentKey: MktgSlidesExportAgentKey,
  documentId: string,
  exportedAtMs: number,
  sha: string
): string {
  return buildMktgSlidesExportTimedRecordKey(buildMktgSlidesExportPrefix(project, agentKey, documentId), exportedAtMs, sha);
}

/** Both export scopes share the same sortable time and content-addressed suffix. */
export function buildMktgSlidesExportTimedRecordKey(prefix: string, exportedAtMs: number, sha: string): string {
  const time = String(Math.max(0, Math.trunc(exportedAtMs))).padStart(MKTG_SLIDES_EXPORT_KEY_TIME_DIGITS, '0');
  return `${prefix}${time}-${sha}.json`;
}

/** The hash a record key names, or null when the key is not a record key under the prefix. */
export function parseMktgSlidesExportRecordKey(key: string, prefix: string): { time: string; sha: string } | null {
  if (!key.startsWith(prefix)) {
    return null;
  }
  const match = new RegExp(`^([0-9]{${MKTG_SLIDES_EXPORT_KEY_TIME_DIGITS}})-([0-9a-f]{64})\\.json$`).exec(key.slice(prefix.length));
  return match ? { time: match[1], sha: match[2] } : null;
}

/** Deck metadata validation shared by both record scopes; each reader checks its own schema and identity. */
export function isMktgSlidesExportDeckRecord(value: unknown): value is MktgSlidesExportDeckRecord {
  if (!isRecord(value)) return false;
  return (
    isText(value['project']) &&
    (MKTG_SLIDES_EXPORT_MODES as readonly unknown[]).includes(value['mode']) &&
    isMktgSlidesExportDriveId(value['deckId']) &&
    value['link'] === mktgSlidesExportDeckLink(value['deckId']) &&
    (value['title'] === null || typeof value['title'] === 'string') &&
    isCount(value['slideCount'], 1) &&
    Array.isArray(value['assets']) &&
    brandedErrors(value['branded']).length === 0 &&
    typeof value['exportedAt'] === 'string' &&
    ISO_DATE_TIME.test(value['exportedAt']) &&
    typeof value['agentVersion'] === 'string'
  );
}

/** Whether a stored value has every field of a document export record. */
export function isMktgSlidesExportRecord(value: unknown): value is MktgSlidesExportRecord {
  if (!isMktgSlidesExportDeckRecord(value) || !isRecord(value)) return false;
  return (
    value['schema'] === MKTG_SLIDES_EXPORT_RECORD_SCHEMA &&
    isMktgSlidesExportAgentKey(value['agentKey']) &&
    isText(value['documentId']) &&
    isText(value['revisionId']) &&
    isCount(value['revisionNumber'], 1) &&
    typeof value['contentSha256'] === 'string' &&
    MKTG_SLIDES_EXPORT_SHA256_REGEX.test(value['contentSha256'])
  );
}

/** A stored record read back and shape-checked, or null when it is not one. */
export function readMktgSlidesExportRecord(value: unknown): MktgSlidesExportRecord | null {
  return isMktgSlidesExportRecord(value) ? value : null;
}

/** Whether the last export is out of date: the document's latest revision holds other content than the revision exported. */
export function isMktgSlidesExportStale(last: MktgSlidesExportRecord | null, latest: MktgSlidesExportRevisionRef | null): boolean {
  return !!last && !!latest && latest.contentSha256 !== last.contentSha256;
}

/** What a finished export says about its brand. */
export function mktgSlidesExportBrandSummary(branded: MktgSlidesExportBranded, logoNote: MktgSlidesExportLogoNote | null): MktgSlidesExportBrandSummary {
  if (!branded.kit) {
    return { text: 'In the Linux Foundation look: the project has no brand kit yet.', logoNote: '' };
  }
  if (branded.logo && branded.logos > 0) {
    const layouts = branded.logos === 1 ? '1 layout' : `${branded.logos} layouts`;
    return { text: `In the kit’s colours and typeface, with the project logo on ${layouts}.`, logoNote: '' };
  }
  // A logo that was sent and not placed is Google's refusal; otherwise the reason it was never sent.
  const note = logoNote ?? 'not-placed';
  return { text: 'In the kit’s colours and typeface.', logoNote: MKTG_SLIDES_EXPORT_LOGO_NOTES[note] };
}
