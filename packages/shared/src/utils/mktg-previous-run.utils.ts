// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// What a revision inherits from the version it revises: the PREVIOUS RUN
// block a redraft's or a check's intake carries, and the `report.inherited`
// key the agent computes from it. A mirror of marketing-os-agents
// `agents/<agent>/src/inherited.ts` (one byte-identical file for the
// framework, FAQ, boilerplates and Brand Kit agents): `carriedKeysOf` and
// `renderPreviousRun` for the block, `inheritedSchema` for the key. The agent
// refuses a revision intake whose block is not its renderer's, so the lifts,
// the caps and the order of the keys below stay as that file has them;
// mktg-previous-run.utils.spec.ts pins blocks produced by the agent's code.

import {
  MKTG_INHERITED_BREAKS_REGEX,
  MKTG_INHERITED_LFX_METRICS_REGEX,
  MKTG_INHERITED_LFX_METRICS_SOURCE,
  MKTG_INHERITED_NAME_MAX_CHARS,
  MKTG_INHERITED_ONE_LINE_REGEX,
  MKTG_INHERITED_ROWS_MAX,
  MKTG_INHERITED_SENTENCE_MAX_CHARS,
  MKTG_INHERITED_SOURCES_MAX,
  MKTG_PREVIOUS_RUN_END,
  MKTG_PREVIOUS_RUN_FRAME_CHARS,
  MKTG_PREVIOUS_RUN_MAX_CHARS,
  MKTG_REPORT_INHERITED_KEY,
} from '../constants/mktg-asset.constants';
import type { MktgPreviousRun } from '../interfaces/mktg-asset.interface';

type UnknownRecord = Record<string, unknown>;
type Lift = (row: unknown) => unknown;
/** The five lists of a run's rows, in the block's order: sources read, sources failed, and the findings' three. */
type RowLists = [unknown[], unknown[], unknown[], unknown[], unknown[]];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** A stored string as a row's text: ONE line (every run of line breaks, control characters and white space is one space), trimmed, cut at `max`; null when it says nothing. */
function lineOf(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  let text = value.replace(MKTG_INHERITED_BREAKS_REGEX, ' ').trim();
  if (text.length > max) {
    text = text.slice(0, max);
    // Never half of a character.
    if (/[\ud800-\udbff]$/.test(text)) text = text.slice(0, -1);
    text = text.trimEnd();
  }
  return text.length === 0 ? null : text;
}
const nameOf = (value: unknown): string | null => lineOf(value, MKTG_INHERITED_NAME_MAX_CHARS);
const sentenceOf = (value: unknown): string | null => lineOf(value, MKTG_INHERITED_SENTENCE_MAX_CHARS);

/** How two source names compare: the scheme, a leading "www.", trailing slashes and case never split one source in two. */
function sourceKey(name: string): string {
  const key = name.trim().replace(/^https?:\/\/(?:www\.)?/i, '');
  // Trailing slashes go in one pass from the end: `/\/+$/` retries from every slash of a long run that does not close the name.
  let end = key.length;
  while (end > 0 && key.charCodeAt(end - 1) === 47) end--;
  return key.slice(0, end).toLowerCase();
}

/** Whether a stored row names the LFX standard metrics, however its agent words that line. */
function isLfxMetrics(name: string): boolean {
  return sourceKey(name) === sourceKey(MKTG_INHERITED_LFX_METRICS_SOURCE) || MKTG_INHERITED_LFX_METRICS_REGEX.test(name.trim());
}

const liftOwnRead: Lift = (row) => (typeof row === 'string' ? nameOf(row) : null);
const liftRead: Lift = (row) => {
  const source = nameOf(isRecord(row) ? row['source'] : row);
  return source === null ? null : { source };
};
const liftFailed: Lift = (row) => {
  if (!isRecord(row)) return null;
  const name = nameOf(row['name']);
  const reason = nameOf(row['reason']);
  return name === null || reason === null ? null : { name, reason };
};
const liftFailedFinding: Lift = (row) => {
  if (!isRecord(row)) return null;
  const source = nameOf(row['source']);
  const kind = nameOf(row['kind']);
  const reason = sentenceOf(row['reason']);
  const detail = nameOf(row['detail']);
  return source === null || kind === null || reason === null ? null : { source, kind, reason, ...(detail === null ? {} : { detail }) };
};
const liftMissing: Lift = (row) => {
  if (!isRecord(row)) return null;
  const asset = nameOf(row['asset']);
  const reason = sentenceOf(row['reason']);
  const fix = sentenceOf(row['fix']);
  return asset === null || reason === null || fix === null ? null : { asset, reason, fix };
};
const liftWarning: Lift = (row) => {
  if (!isRecord(row)) return null;
  const code = nameOf(row['code']);
  const text = sentenceOf(row['text']);
  const source = nameOf(row['source']);
  return code === null || text === null ? null : { code, text, ...(source === null ? {} : { source }) };
};

/** A row the stored version had inherited: the row, with the version it names (a whole number from 1 up), or null. */
const versioned =
  (lift: Lift): Lift =>
  (row) => {
    const version = isRecord(row) ? row['version'] : null;
    const lifted = typeof version === 'number' && Number.isInteger(version) && version >= 1 ? lift(row) : null;
    return isRecord(lifted) ? { ...lifted, version } : null;
  };

/** The first `cap` rows of a stored list that are rows. */
function take(list: unknown, lift: Lift, cap: number): unknown[] {
  const out: unknown[] = [];
  for (const row of listOf(list)) {
    if (out.length >= cap) break;
    const lifted = lift(row);
    if (lifted !== null) out.push(lifted);
  }
  return out;
}

/** One run's rows out of its report (or out of what that report had inherited): each list lifted, one line a text, capped. */
function rowsOf(report: UnknownRecord, read: Lift, mark: (lift: Lift) => Lift): RowLists {
  const findings = isRecord(report['findings']) ? report['findings'] : {};
  return [
    take(report['sources_read'], read, MKTG_INHERITED_SOURCES_MAX),
    take(report['sources_failed'], mark(liftFailed), MKTG_INHERITED_ROWS_MAX),
    take(findings['sources_failed'], mark(liftFailedFinding), MKTG_INHERITED_ROWS_MAX),
    take(findings['missing_assets'], mark(liftMissing), MKTG_INHERITED_ROWS_MAX),
    take(findings['warnings'], mark(liftWarning), MKTG_INHERITED_ROWS_MAX),
  ];
}

/**
 * The LFX read the stored read ledger PROVES: the standard metrics, and only
 * them. A `metrics` row read whole or in part is a read unless a failed row
 * names the metrics (by name or by kind, `lfx_metrics`), in the stored
 * version's own rows or in what it had inherited; read from the stored lists
 * WHOLE, before any cap. The record is never proven by the ledger: it is
 * carried only as a row of the stored `sources_read`.
 */
function lfxProofOf(report: UnknownRecord, quality: unknown): UnknownRecord[] {
  const older = isRecord(report['inherited']) ? report['inherited'] : {};
  const findings = [report['findings'], older['findings']].filter(isRecord);
  const rowsIn = (lists: unknown[]): UnknownRecord[] => lists.flatMap(listOf).filter(isRecord);
  /** The stored rows' own words for one key (a row need not be whole to say a source failed). */
  const said = (rows: UnknownRecord[], key: string): string[] => rows.flatMap((row) => nameOf(row[key]) ?? []);
  const failedRows = rowsIn(findings.map((group) => group['sources_failed']));
  const failedNames = [...said(rowsIn([report['sources_failed'], older['sources_failed']]), 'name'), ...said(failedRows, 'source')];
  if (failedNames.some(isLfxMetrics) || said(failedRows, 'kind').includes('lfx_metrics')) return [];
  for (const row of isRecord(quality) ? listOf(quality['reads']) : []) {
    if (!isRecord(row) || row['kind'] !== 'metrics') continue;
    const outcome = row['outcome'];
    if (outcome === 'complete' || outcome === 'partial') return [{ kind: 'metrics', outcome }];
  }
  return [];
}

/** A row's size in the rendered block: its own pretty JSON, the indentation of the deepest list on each of its lines, and its separator. */
function renderedSize(row: unknown): number {
  const text = JSON.stringify(row, null, 2);
  return text.length + (text.split('\n').length * 10 + 2);
}

/** Drops rows, the last of the longest list first, until the rows' sizes add up to `budget` at most. */
function fit(lists: unknown[][], budget: number): void {
  const sizes = lists.map((list) => list.map(renderedSize));
  const totals = sizes.map((list) => list.reduce((sum, size) => sum + size, 0));
  let total = totals.reduce((sum, size) => sum + size, 0);
  while (total > budget) {
    const longest = totals.indexOf(Math.max(...totals));
    const size = sizes[longest].pop();
    if (size === undefined) return;
    lists[longest].pop();
    totals[longest] -= size;
    total -= size;
  }
}

/** A list's key and rows, or nothing when the list is empty (the block holds no empty key). */
const listed = (key: string, rows: unknown[]): UnknownRecord => (rows.length === 0 ? {} : { [key]: rows });
/** An object's key and value, or nothing when the object is empty. */
const keyed = (key: string, value: UnknownRecord): UnknownRecord => (Object.keys(value).length === 0 ? {} : { [key]: value });

function shapeOfRows([read, failed, failedFindings, missing, warnings]: RowLists): UnknownRecord {
  return {
    ...listed('sources_read', read),
    ...listed('sources_failed', failed),
    ...keyed('findings', { ...listed('sources_failed', failedFindings), ...listed('missing_assets', missing), ...listed('warnings', warnings) }),
  };
}

/**
 * A previous run with ONLY what the agent's carry reads, in the stored
 * envelope's own shape: `report.sources_read`, `report.sources_failed`,
 * `report.findings` (its three lists), `report.inherited` (when the stored
 * version had one) and, of `quality.reads`, the `kind` and `outcome` of the
 * LFX standard metrics row when it proves a read. Every other key is dropped
 * (`gaps`, `notes`, the rest of the ledger, anything else), every text is one
 * line and cut, every list is capped, and the whole fits the block. A mirror
 * of the agents' `carriedKeysOf`; applying it twice changes nothing.
 */
export function mktgCarriedKeysOf(run: MktgPreviousRun): UnknownRecord {
  const report = isRecord(run.report) ? run.report : {};
  const older = isRecord(report['inherited']) ? report['inherited'] : null;
  const own = rowsOf(report, liftOwnRead, (lift) => lift);
  const inherited = older === null ? null : rowsOf(older, versioned(liftRead), versioned);
  const lfx = lfxProofOf(report, run.quality);
  fit([...own, ...(inherited ?? [])], MKTG_PREVIOUS_RUN_MAX_CHARS - MKTG_PREVIOUS_RUN_FRAME_CHARS);
  const carried = { ...shapeOfRows(own), ...(inherited === null ? {} : { inherited: shapeOfRows(inherited) }) };
  return { ...keyed('report', carried), ...(lfx.length === 0 ? {} : { quality: { reads: lfx } }) };
}

/** The block's opening line: the stored version's number is the one the revision line names. */
export function mktgPreviousRunOpen(priorVersion: number): string {
  return `--- PREVIOUS RUN (JSON, stored version ${priorVersion}) ---`;
}

/**
 * The PREVIOUS RUN block's lines, or none when the form carries no previous
 * run: the run's carried keys ({@link mktgCarriedKeysOf}), never the stored
 * envelope whole. `guard` is the form's own marker guard. A mirror of the
 * agents' `renderPreviousRun`; the block is the LAST of a revision intake
 * (the agent refuses any text after its last block).
 */
export function renderMktgPreviousRun(run: MktgPreviousRun | undefined | null, priorVersion: number, guard: (text: string) => string): string[] {
  if (run === undefined || run === null) return [];
  return [mktgPreviousRunOpen(priorVersion), guard(JSON.stringify(mktgCarriedKeysOf(run), null, 2)), MKTG_PREVIOUS_RUN_END];
}

// ---------------------------------------------------------------------------
// The envelope key: `report.inherited`, as the agents' `inheritedSchema` holds it
// ---------------------------------------------------------------------------

/** One line (no line break, no control character), at most `max` characters. */
const isLine = (value: unknown, max: number): boolean =>
  typeof value === 'string' && value.length >= 1 && value.length <= max && MKTG_INHERITED_ONE_LINE_REGEX.test(value);
const isName = (value: unknown): boolean => isLine(value, MKTG_INHERITED_NAME_MAX_CHARS);
const isSentence = (value: unknown): boolean => isLine(value, MKTG_INHERITED_SENTENCE_MAX_CHARS);
/** The version whose run produced a row: a whole number from 1 up. */
const isVersion = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 1;

/** A closed row: each required key passes its check, each optional key passes it when present, the version is one, and there is no other key. */
function isRow(row: unknown, required: Record<string, (value: unknown) => boolean>, optional: Record<string, (value: unknown) => boolean> = {}): boolean {
  if (!isRecord(row) || !isVersion(row['version'])) return false;
  const keys = Object.keys(row).filter((key) => key !== 'version');
  return (
    keys.every((key) => (Object.hasOwn(required, key) ? required[key](row[key]) : Object.hasOwn(optional, key) && optional[key](row[key]))) &&
    Object.keys(required).every((key) => Object.hasOwn(row, key))
  );
}

const onlyKeys = (value: UnknownRecord, allowed: readonly string[]): boolean => Object.keys(value).every((key) => allowed.includes(key));

/**
 * `report.inherited`, checked only when present: absent means a draft, or a
 * revision whose intake carried no previous run. A present key with a bad
 * shape is an error, so an agent's malformed carry surfaces instead of
 * reaching the Sources tab. The shape is the agents' `inheritedSchema`, closed
 * at every level: `from_version`, the sources read `{ source, version }`, the
 * sources failed `{ name, reason, version }` and the three findings lists,
 * every text one line within its length and every list within its cap.
 */
export function mktgReportInheritedErrors(report: UnknownRecord): string[] {
  const at = `report.${MKTG_REPORT_INHERITED_KEY}`;
  const inherited = report[MKTG_REPORT_INHERITED_KEY];
  if (inherited === undefined) return [];
  const findings = isRecord(inherited) ? inherited['findings'] : null;
  if (
    !isRecord(inherited) ||
    !onlyKeys(inherited, ['from_version', 'sources_read', 'sources_failed', 'findings']) ||
    !isRecord(findings) ||
    !onlyKeys(findings, ['sources_failed', 'missing_assets', 'warnings'])
  ) {
    return [`${at} must be an object of { from_version, sources_read, sources_failed, findings: { sources_failed, missing_assets, warnings } }`];
  }
  const errors: string[] = [];
  const list = (path: string, value: unknown, max: number, shape: string, ok: (row: unknown) => boolean): void => {
    if (!Array.isArray(value) || value.length > max || !value.every(ok)) errors.push(`${at}.${path} must be a list of at most ${max} ${shape}`);
  };
  if (!isVersion(inherited['from_version'])) errors.push(`${at}.from_version must be an integer >= 1`);
  list('sources_read', inherited['sources_read'], MKTG_INHERITED_SOURCES_MAX, '{ source, version }', (row) => isRow(row, { source: isName }));
  list('sources_failed', inherited['sources_failed'], MKTG_INHERITED_ROWS_MAX, '{ name, reason, version }', (row) =>
    isRow(row, { name: isName, reason: isName })
  );
  list('findings.sources_failed', findings['sources_failed'], MKTG_INHERITED_ROWS_MAX, '{ source, kind, reason, detail?, version }', (row) =>
    isRow(row, { source: isName, kind: isName, reason: isSentence }, { detail: isName })
  );
  list('findings.missing_assets', findings['missing_assets'], MKTG_INHERITED_ROWS_MAX, '{ asset, reason, fix, version }', (row) =>
    isRow(row, { asset: isName, reason: isSentence, fix: isSentence })
  );
  list('findings.warnings', findings['warnings'], MKTG_INHERITED_ROWS_MAX, '{ code, text, source?, version }', (row) =>
    isRow(row, { code: isName, text: isSentence }, { source: isName })
  );
  return errors;
}
