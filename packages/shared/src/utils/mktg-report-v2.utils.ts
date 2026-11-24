// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The v2 report every agent may write (the Brand Kit's first, brand-kit ≥
// 2.2.0; the framework, boilerplates and FAQ agents after it): the shape check
// each agent's envelope validator runs on the v2 fields, and the view model
// the Sources tabs and the approve dialog read the findings through. One
// reading for every agent; a v1 report (no `findings`) has none of it and
// renders as it always did.

import { MKTG_REPORT_BARE_URL_REGEX, MKTG_REPORT_LIST_MAX, MKTG_REPORT_TEXT_MAX_CHARS, MKTG_REPORT_V2 } from '../constants/mktg-asset.constants';
import type { MktgAssetReport, MktgReportFindingsView, MktgReportV2Enums } from '../interfaces/mktg-asset.interface';

type UnknownRecord = Record<string, unknown>;

/**
 * The v2 fields of a report, each checked only when present: absent means the v1 report. A present field with a bad
 * shape is an error, so an agent's malformed output surfaces instead of vanishing from the Sources tab. The limits are
 * the kit's contract as written: reason, text and fix are trimmed sentences of 1–300 characters and never a bare URL
 * (URLs travel in `source`); `detail` is non-empty text with no cap; each group holds at most 50 entries. `kind`,
 * `asset` and `code` are non-empty text, or one of `enums` where a validator closes them (the kit's own does; the
 * family's agents name their own and leave them open).
 */
export function mktgReportV2Errors(report: UnknownRecord, enums: MktgReportV2Enums = {}): string[] {
  const errors: string[] = [];
  if (report['version'] !== undefined && report['version'] !== MKTG_REPORT_V2) {
    errors.push(`report.version must be ${MKTG_REPORT_V2} when present`);
  }
  const findings = report['findings'];
  if (findings === undefined) return errors;
  if (!isRecord(findings) || !onlyKeys(findings, ['sources_failed', 'missing_assets', 'warnings'])) {
    errors.push('report.findings must be an object of { sources_failed, missing_assets, warnings }');
    return errors;
  }
  const failedOk = (entry: unknown): boolean =>
    isRecord(entry) &&
    onlyKeys(entry, ['source', 'kind', 'reason', 'detail']) &&
    isText(entry['source']) &&
    isOneOf(entry['kind'], enums.kinds) &&
    isSentence(entry['reason']) &&
    (entry['detail'] === undefined || isText(entry['detail']));
  const missingOk = (entry: unknown): boolean =>
    isRecord(entry) &&
    onlyKeys(entry, ['asset', 'reason', 'fix']) &&
    isOneOf(entry['asset'], enums.assets) &&
    isSentence(entry['reason']) &&
    (entry['fix'] === undefined || isSentence(entry['fix']));
  const warningOk = (entry: unknown): boolean =>
    isRecord(entry) &&
    onlyKeys(entry, ['code', 'text', 'source']) &&
    isOneOf(entry['code'], enums.codes) &&
    isSentence(entry['text']) &&
    (entry['source'] === undefined || isText(entry['source']));
  if (!isListOf(findings['sources_failed'], failedOk)) {
    errors.push('report.findings.sources_failed must be a list of { source, kind, reason, detail? }');
  }
  if (!isListOf(findings['missing_assets'], missingOk)) {
    errors.push('report.findings.missing_assets must be a list of { asset, reason, fix? }');
  }
  if (!isListOf(findings['warnings'], warningOk)) {
    errors.push('report.findings.warnings must be a list of { code, text, source? }');
  }
  return errors;
}

/**
 * A report sentence: trimmed text of 1–300 characters that is not a bare URL (a URL inside a sentence is fine; a
 * reason that is only an address belongs in `source`). The looser reading of the agents' own rule, so the UI never
 * rejects what an agent accepts.
 */
function isSentence(value: unknown): value is string {
  return isText(value) && value === value.trim() && value.length <= MKTG_REPORT_TEXT_MAX_CHARS && !MKTG_REPORT_BARE_URL_REGEX.test(value);
}

/** A findings group: at most 50 entries, each of the given shape. */
function isListOf(value: unknown, ok: (entry: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length <= MKTG_REPORT_LIST_MAX && value.every(ok);
}

/** A warning's source is a link only when it is an http(s) URL; anything else is shown as text. */
export function mktgReportSourceHref(source: string | null): string | null {
  return source && /^https?:\/\//i.test(source) ? source : null;
}

/** How the UI names a missing asset: its label when the map has one, else its id as the agent wrote it. */
export function mktgReportAssetLabel(asset: string, labels: Readonly<Record<string, string>>): string {
  return Object.prototype.hasOwnProperty.call(labels, asset) ? labels[asset] : asset;
}

/**
 * The Sources tab's findings from a report, in the agent's plain words, never rewritten: a v2 report's failed
 * sources (source, reason, detail), missing assets (label or id, reason, fix) and warnings (text, source, a link only
 * for an http(s) address); a v1 report's legacy failed list as title and reason, nothing missing, no warning and
 * `hasFindings` false, so the tab adds no card. Null or no report gives the empty v1 view.
 */
export function mktgReportFindingsView(report: MktgAssetReport | null | undefined, labels: Readonly<Record<string, string>>): MktgReportFindingsView {
  const findings = report?.findings;
  if (!findings) {
    return {
      hasFindings: false,
      failed: (report?.sources_failed ?? []).map((entry) => ({ title: entry.name, text: entry.reason, detail: null })),
      missing: [],
      warnings: [],
    };
  }
  return {
    hasFindings: true,
    failed: findings.sources_failed.map((entry) => ({ title: entry.source, text: entry.reason, detail: entry.detail ?? null })),
    missing: findings.missing_assets.map((entry) => ({ title: mktgReportAssetLabel(entry.asset, labels), text: entry.reason, fix: entry.fix ?? null })),
    warnings: findings.warnings.map((entry) => ({ text: entry.text, source: entry.source ?? null, href: mktgReportSourceHref(entry.source ?? null) })),
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Non-empty text, and one of `allowed` where the validator closes the list. */
function isOneOf(value: unknown, allowed: readonly string[] | undefined): value is string {
  return isText(value) && (allowed === undefined || allowed.includes(value));
}

/** Strict to its keys: no key outside the contract's. */
function onlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
