// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { APPOINTED_BY_OPTIONS, MEMBER_FORM_VOTING_STATUSES, MEMBER_ROLES } from '../constants/committees.constants';
import {
  MEMBER_IMPORT_COLUMNS,
  MEMBER_IMPORT_EMAIL_PATTERN,
  MEMBER_IMPORT_ENCODING_COLUMN,
  MEMBER_IMPORT_ERRORS_COLUMN,
  MEMBER_IMPORT_FIELDS,
  MEMBER_IMPORT_HTTP_URL_PATTERN,
  MEMBER_IMPORT_MAX_RECORDS,
  MEMBER_IMPORT_PAUSE_DELAYS_MS,
  MEMBER_IMPORT_RECOVERY_ENCODING,
  MEMBER_IMPORT_RETRY_AFTER_DEFAULT_MS,
  MEMBER_IMPORT_RETRY_AFTER_MIN_MS,
  MEMBER_IMPORT_TEXT_PREFIX,
  MEMBER_IMPORT_VOTING_COLUMNS,
  MEMBER_IMPORT_VOTING_STATUS_LABELS,
} from '../constants/member-import.constants';
import { LINKEDIN_PROFILE_PATTERN } from '../constants/validation.constants';
import type { CommitteeMemberBulkCreateRowResult, CreateCommitteeMemberRequest } from '../interfaces/member.interface';
import type {
  MemberImportCells,
  MemberImportColumn,
  MemberImportDecodedFile,
  MemberImportFieldDefinition,
  MemberImportFieldGuide,
  MemberImportGroupRules,
  MemberImportParseResult,
  MemberImportRecord,
  MemberImportRow,
  MemberImportValidationIssue,
} from '../interfaces/member-import.interface';
import { buildCommitteeOrganizationPayload } from './invitation.utils';

const COLUMN_BY_HEADER_KEY = new Map<string, MemberImportColumn>(MEMBER_IMPORT_COLUMNS.map((column) => [headerKey(column), column]));
const ROLE_BY_NAME = new Map(MEMBER_ROLES.map(({ value }) => [valueKey(value), value]));
const VOTING_STATUS_BY_NAME = new Map(MEMBER_FORM_VOTING_STATUSES.map(({ value }) => [valueKey(value), value]));
const APPOINTED_BY_BY_NAME = new Map(APPOINTED_BY_OPTIONS.map(({ value }) => [valueKey(value), value]));
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RETRY_AFTER_SECONDS_PATTERN = /^\d+$/;

/** Template guidance for the columns that apply to a group, with group-specific requiredness. */
export function getMemberImportFieldGuide(rules: MemberImportGroupRules): MemberImportFieldGuide[] {
  return MEMBER_IMPORT_FIELDS.filter((field) => rules.votingEnabled || !field.votingOnly).map((field) => ({
    column: field.column,
    required: isColumnRequired(field.requiredWhen, rules),
    description: field.description,
  }));
}

/** Header row of the downloadable template for a group — voting columns only for voting groups. */
export function getMemberImportTemplateHeaders(rules: MemberImportGroupRules): MemberImportColumn[] {
  return getMemberImportFieldGuide(rules).map((field) => field.column);
}

/**
 * Recovery CSV records: group template plus any supplied known columns, versioned text encoding
 * and ignored diagnostics. Prefix formula-leading/literal prefix-looking values so spreadsheet
 * protection remains reversible without changing ordinary CSVs or the generic serializer.
 */
export function buildMemberImportInvalidRowsCsv(rows: MemberImportRow[], rules: MemberImportGroupRules): string[][] {
  const invalidRows = rows.filter((row) => row.status === 'invalid');
  const templateHeaders = new Set(getMemberImportTemplateHeaders(rules));
  const headers = MEMBER_IMPORT_COLUMNS.filter((column) => templateHeaders.has(column) || invalidRows.some((row) => row.cells[column] !== undefined));
  const records = invalidRows.map((row) => [
    ...headers.map((column) => {
      const value = row.cells[column] ?? '';
      return /^[=+\-@\t\r]/.test(value) || value.startsWith(MEMBER_IMPORT_TEXT_PREFIX) ? `${MEMBER_IMPORT_TEXT_PREFIX}${value}` : value;
    }),
    MEMBER_IMPORT_RECOVERY_ENCODING,
    row.issues.map((issue) => issue.message).join(' '),
  ]);
  return [[...headers, MEMBER_IMPORT_ENCODING_COLUMN, MEMBER_IMPORT_ERRORS_COLUMN], ...records];
}

/**
 * Strictly parses member import CSV text (comma delimiter, RFC 4180 quoting) and checks its header.
 * Reserved recovery diagnostics are ignored. Only rows with the supported encoding marker decode
 * one safety prefix; returned headers/cells contain member data only.
 *
 * Handles a UTF-8 BOM, CRLF/LF line endings, quoted commas/newlines and escaped `""` quotes, and
 * skips blank records while still counting them, so every `rowNumber` matches the source record
 * (the first record is row 1). Headers match the template's columns ignoring case, whitespace,
 * hyphens and underscores; other columns are left out of the records and named in `ignoredColumns`.
 * Anything that could shift or lose data — unterminated quotes, text after a closing quote, a cell
 * count that differs from the header, repeated/missing headers — is reported in `errors` and no
 * records are returned. Never truncates: more than {@link MEMBER_IMPORT_MAX_RECORDS} member rows is an error.
 */
export function parseMemberImportCsv(text: string, rules: MemberImportGroupRules): MemberImportParseResult {
  const failed = (errors: string[]): MemberImportParseResult => ({ headers: [], records: [], ignoredColumns: [], errors });

  const tokenized = tokenizeCsv(text.startsWith('﻿') ? text.slice(1) : text);
  if ('error' in tokenized) {
    return failed([tokenized.error]);
  }

  // Tokenization discards blank records but keeps each retained record's original logical row number.
  const header = tokenized.rows[0];
  if (!header) {
    return failed(['The file is empty. Download the template and add one member per row.']);
  }

  const headerResult = readHeaders(header.cells, rules);
  if (headerResult.errors.length > 0) {
    return failed(headerResult.errors);
  }
  const { columns, ignored } = headerResult;
  const headers = columns.filter((column): column is MemberImportColumn => column !== null);
  const encodingColumn = header.cells.findIndex((column) => headerKey(column) === headerKey(MEMBER_IMPORT_ENCODING_COLUMN));

  const errors: string[] = [];
  const records: MemberImportRecord[] = [];
  const ignoredWithValues = new Set<number>();
  tokenized.rows.slice(1).forEach(({ cells, rowNumber }) => {
    // Ignored columns still count, so a value with an unquoted comma cannot shift into a used column.
    if (cells.length !== columns.length) {
      errors.push(`Row ${rowNumber} has ${cells.length} cells but the header has ${columns.length}. Put quotes around values that contain commas.`);
      return;
    }
    if (encodingColumn !== -1 && cells[encodingColumn].trim() !== MEMBER_IMPORT_RECOVERY_ENCODING) {
      errors.push(`Row ${rowNumber} has an unsupported recovery encoding. Keep the downloaded ${MEMBER_IMPORT_ENCODING_COLUMN} value unchanged.`);
      return;
    }
    const record: MemberImportCells = {};
    cells.forEach((cell, index) => {
      const column = columns[index];
      if (column) {
        const value = cell.trim();
        record[column] = encodingColumn !== -1 && value.startsWith(MEMBER_IMPORT_TEXT_PREFIX) ? value.slice(MEMBER_IMPORT_TEXT_PREFIX.length) : value;
      } else if (cell.trim()) {
        ignoredWithValues.add(index);
      }
    });
    records.push({ rowNumber, cells: record });
  });

  if (errors.length > 0) {
    return failed(errors);
  }
  if (records.length === 0) {
    return failed(['The file has a header but no member rows.']);
  }
  const ignoredColumns = ignored
    .filter(({ index, label }) => label || ignoredWithValues.has(index))
    .map(({ index, label }) => label || `Column ${index + 1} (no header)`);
  return { headers, records, ignoredColumns, errors: [] };
}

/**
 * Reads an uploaded import file as UTF-8, or as Windows-1252 — what Excel's "CSV (Comma delimited)"
 * saves — when the bytes are not valid UTF-8. A UTF-8 BOM is kept for {@link parseMemberImportCsv}.
 */
export function decodeMemberImportFile(buffer: ArrayBuffer): MemberImportDecodedFile {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer), encoding: 'utf-8' };
  } catch {
    // Windows-1252 maps every byte, so the preview is the user's chance to spot another encoding.
    return { text: new TextDecoder('windows-1252').decode(buffer), encoding: 'windows-1252' };
  }
}

/** Row-specific problems for one record, judged against the group's member requirements. */
export function validateMemberImportRow(cells: MemberImportCells, rules: MemberImportGroupRules): MemberImportValidationIssue[] {
  const issues: MemberImportValidationIssue[] = [];
  const add = (column: MemberImportColumn | null, message: string): void => {
    issues.push({ column, message });
  };
  const value = (column: MemberImportColumn): string => cells[column] ?? '';

  const email = value('email');
  if (!email) {
    add('email', 'Email is required.');
  } else if (!MEMBER_IMPORT_EMAIL_PATTERN.test(email)) {
    add('email', 'Email is not a valid address.');
  }

  checkLength(value('first_name'), 100, 'first_name', 'First name', add);
  checkLength(value('last_name'), 100, 'last_name', 'Last name', add);
  checkLength(value('job_title'), 200, 'job_title', 'Job title', add);

  const linkedin = value('linkedin_profile');
  if (linkedin && !(isAbsoluteHttpUrl(linkedin, ['http:', 'https:']) && LINKEDIN_PROFILE_PATTERN.test(linkedin))) {
    add('linkedin_profile', 'LinkedIn profile must be a full linkedin.com URL starting with https://.');
  }

  validateOrganization(value('organization_name'), value('organization_website'), rules, add);

  const role = value('role');
  if (!role && rules.votingEnabled) {
    add('role', 'Role is required for voting groups.');
  } else if (role && !ROLE_BY_NAME.has(valueKey(role))) {
    add('role', `Role "${role}" is not a recognized role.`);
  }
  validateDateRange(cells, 'role_start_date', 'role_end_date', !!role, 'role', add);

  if (rules.votingEnabled) {
    const votingStatus = value('voting_status');
    if (!votingStatus) {
      add('voting_status', 'Voting status is required for voting groups.');
    } else if (!VOTING_STATUS_BY_NAME.has(valueKey(votingStatus))) {
      add('voting_status', `Voting status "${votingStatus}" is not allowed. Use ${MEMBER_IMPORT_VOTING_STATUS_LABELS}.`);
    }
    validateDateRange(cells, 'voting_start_date', 'voting_end_date', !!votingStatus, 'voting status', add);
  } else {
    for (const column of MEMBER_IMPORT_VOTING_COLUMNS) {
      if (value(column)) {
        add(column, 'This group does not use voting. Clear the voting columns.');
      }
    }
  }

  const appointedBy = value('appointed_by');
  if (appointedBy && !APPOINTED_BY_BY_NAME.has(valueKey(appointedBy))) {
    add('appointed_by', `Appointed by "${appointedBy}" is not a recognized option.`);
  }

  return issues;
}

/**
 * Native create-member body for a valid record. Empty cells and absent nested objects are omitted,
 * and the organization is always a name + website pair with a null id — CSV never carries an
 * organization or CDP id. The email is sent trimmed and lowercased, like the pasted-email direct-add.
 */
export function buildMemberImportPayload(cells: MemberImportCells): CreateCommitteeMemberRequest {
  const value = (column: MemberImportColumn): string => cells[column] ?? '';
  const payload: CreateCommitteeMemberRequest = { email: value('email').toLowerCase() };

  if (value('first_name')) payload.first_name = value('first_name');
  if (value('last_name')) payload.last_name = value('last_name');
  if (value('job_title')) payload.job_title = value('job_title');
  if (value('linkedin_profile')) payload.linkedin_profile = value('linkedin_profile');

  const organization = buildCommitteeOrganizationPayload({
    organization: value('organization_name'),
    organization_url: value('organization_website'),
    organization_id: null,
  });
  if (organization) {
    payload.organization = organization;
  }

  const role = ROLE_BY_NAME.get(valueKey(value('role')));
  if (role) {
    payload.role = { name: role };
    if (value('role_start_date')) payload.role.start_date = value('role_start_date');
    if (value('role_end_date')) payload.role.end_date = value('role_end_date');
  }

  const votingStatus = VOTING_STATUS_BY_NAME.get(valueKey(value('voting_status')));
  if (votingStatus) {
    payload.voting = { status: votingStatus };
    if (value('voting_start_date')) payload.voting.start_date = value('voting_start_date');
    if (value('voting_end_date')) payload.voting.end_date = value('voting_end_date');
  }

  const appointedBy = APPOINTED_BY_BY_NAME.get(valueKey(value('appointed_by')));
  if (appointedBy) {
    payload.appointed_by = appointedBy;
  }

  return payload;
}

/**
 * Turns parsed records into preview rows: validates each, then skips people already in the group
 * and later repeats of an email earlier in the file (trimmed + lowercased comparison). The first
 * occurrence is always the one kept — even when it is invalid — so fixing it is the user's call.
 * Ready rows show the canonical role, voting status and appointed-by values their payload sends;
 * invalid and skipped rows keep the values as written.
 */
export function prepareMemberImportRows(
  records: MemberImportRecord[],
  rules: MemberImportGroupRules,
  existingMemberEmails: ReadonlySet<string>
): MemberImportRow[] {
  const firstRowByEmail = new Map<string, number>();

  return records.map(({ rowNumber, cells }): MemberImportRow => {
    const email = cells.email ?? '';
    const normalizedEmail = email.toLowerCase();
    const base = { rowNumber, email, normalizedEmail, cells };

    if (normalizedEmail && existingMemberEmails.has(normalizedEmail)) {
      firstRowByEmail.set(normalizedEmail, firstRowByEmail.get(normalizedEmail) ?? rowNumber);
      return { ...base, status: 'skipped', issues: [], payload: null, reason: 'Already a member of this group.' };
    }

    const firstRow = normalizedEmail ? firstRowByEmail.get(normalizedEmail) : undefined;
    if (firstRow !== undefined) {
      return { ...base, status: 'skipped', issues: [], payload: null, reason: `Duplicate of row ${firstRow}.` };
    }
    if (normalizedEmail) {
      firstRowByEmail.set(normalizedEmail, rowNumber);
    }

    const issues = validateMemberImportRow(cells, rules);
    if (issues.length > 0) {
      return { ...base, status: 'invalid', issues, payload: null };
    }
    return { ...base, cells: withCanonicalValues(cells), status: 'ready', issues, payload: buildMemberImportPayload(cells) };
  });
}

/**
 * Row patch for one bulk member create result (GH-5111).
 *
 * Added rows and people already in the group never go back into the queue. An `already_member`
 * result confirms presence, not which request created the membership or applied its details.
 * Temporary and not-attempted rows wait for resubmission; invalid rows cannot succeed unchanged.
 */
export function classifyMemberImportBulkResult(result: CommitteeMemberBulkCreateRowResult, row: MemberImportRow): Partial<MemberImportRow> {
  if (result.status === 'added') {
    return { status: 'added', reason: undefined, retryable: undefined, uncertain: false };
  }

  if (result.status === 'skipped') {
    if (result.reason === 'already_member') {
      if (row.uncertain) {
        return {
          status: 'skipped',
          conflict: true,
          reason:
            'Already a member of this group. The earlier addition could not be confirmed; imported details may not have been applied. Review pending invitations.',
          retryable: undefined,
          uncertain: false,
        };
      }
      return { status: 'skipped', conflict: true, reason: 'Already a member of this group.', retryable: undefined, uncertain: false };
    }
    return { status: 'skipped', reason: 'Duplicate of an earlier row in the file.', retryable: undefined, uncertain: false };
  }

  if (result.reason === 'temporary') {
    return {
      status: 'waiting',
      reason: 'A temporary problem interrupted this row. It will be sent again automatically.',
      retryable: undefined,
      uncertain: true,
    };
  }
  if (result.reason === 'not_attempted' || (result.reason === undefined && result.retryable)) {
    return { status: 'waiting', reason: 'Not sent yet. It will be sent automatically.', retryable: undefined };
  }

  const detail = (result.message ?? '').trim() || 'The member details were rejected.';
  return {
    status: row.uncertain ? 'unknown' : 'failed',
    reason: `${row.uncertain ? 'The earlier outcome is unknown. ' : ''}${/[.!?]$/.test(detail) ? detail : `${detail}.`} Fix this row in the file and import it again.`,
    retryable: false,
    uncertain: !!row.uncertain,
  };
}

/**
 * Milliseconds to pause before resubmitting rows (GH-5111).
 *
 * A non-null `retryAfter` (a 429's Retry-After header) is read as delay seconds or an HTTP-date,
 * falling back to {@link MEMBER_IMPORT_RETRY_AFTER_DEFAULT_MS} when unreadable. Without a header,
 * the backoff for this pause number applies. Valid server minimums are never shortened; callers
 * must stop automatic recovery if the delay exceeds their supported wait budget.
 */
export function getMemberImportRetryDelayMs(retryAfter: string | null, pauseIndex: number, now: number = Date.now()): number {
  const backoff = MEMBER_IMPORT_PAUSE_DELAYS_MS[Math.min(Math.max(pauseIndex, 0), MEMBER_IMPORT_PAUSE_DELAYS_MS.length - 1)];
  const delay = retryAfter === null ? backoff : (parseRetryAfterMs(retryAfter, now) ?? MEMBER_IMPORT_RETRY_AFTER_DEFAULT_MS);
  return Math.max(delay, MEMBER_IMPORT_RETRY_AFTER_MIN_MS);
}

function parseRetryAfterMs(value: string, now: number): number | null {
  const trimmed = value.trim();
  if (RETRY_AFTER_SECONDS_PATTERN.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : date - now;
}

function isColumnRequired(requiredWhen: MemberImportFieldDefinition['requiredWhen'], rules: MemberImportGroupRules): boolean {
  switch (requiredWhen) {
    case 'always':
      return true;
    case 'organization':
      return rules.requiresOrganization;
    case 'voting':
      return rules.votingEnabled;
    default:
      return false;
  }
}

/** Retains only a header and up to the member limit; blank records still advance the logical row number. */
function tokenizeCsv(text: string): { rows: { rowNumber: number; cells: string[] }[] } | { error: string } {
  const rows: { rowNumber: number; cells: string[] }[] = [];
  let rowNumber = 1;
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let quoteClosed = false;
  let quoteStartRow = 0;

  const endRecord = (): string | null => {
    row.push(cell);
    if (!isBlankRecord(row)) {
      // The first retained record is the header, so rows.length is the next member's count.
      if (rows.length > MEMBER_IMPORT_MAX_RECORDS) {
        return `The file has more than ${MEMBER_IMPORT_MAX_RECORDS} member rows; up to ${MEMBER_IMPORT_MAX_RECORDS} can be imported at once. Split it into smaller files.`;
      }
      rows.push({ rowNumber, cells: row });
    }
    rowNumber++;
    row = [];
    cell = '';
    quoteClosed = false;
    return null;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char !== '"') {
        cell += char;
      } else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = false;
        quoteClosed = true;
      }
      continue;
    }

    if (char === ',') {
      row.push(cell);
      cell = '';
      quoteClosed = false;
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') {
        i++;
      }
      const error = endRecord();
      if (error) {
        return { error };
      }
    } else if (quoteClosed) {
      return { error: `Row ${rowNumber} has text after a closing quote. Quote the whole value, and write a quote inside it as "".` };
    } else if (char === '"') {
      if (cell !== '') {
        return { error: `Row ${rowNumber} has a quote inside an unquoted value. Quote the whole value, and write a quote inside it as "".` };
      }
      inQuotes = true;
      quoteStartRow = rowNumber;
    } else {
      cell += char;
    }
  }

  if (inQuotes) {
    return { error: `Row ${quoteStartRow} has a quote that is never closed.` };
  }
  if (cell !== '' || quoteClosed || row.length > 0) {
    const error = endRecord();
    if (error) {
      return { error };
    }
  }
  return { rows };
}

function isBlankRecord(cells: string[]): boolean {
  return cells.every((cell) => cell.trim() === '');
}

/** Header comparison key: lowercase with whitespace, hyphens and underscores removed (`First Name` → `firstname`). */
function headerKey(header: string): string {
  return header.toLowerCase().replace(/[\s_-]+/g, '');
}

/** Value comparison key: trimmed, lowercase, inner whitespace collapsed (` Voting  Rep ` → `voting rep`). */
function valueKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Cells with recognized role, voting status and appointed-by values replaced by their canonical spelling. */
function withCanonicalValues(cells: MemberImportCells): MemberImportCells {
  const canonical = { ...cells };
  const role = ROLE_BY_NAME.get(valueKey(cells.role ?? ''));
  const votingStatus = VOTING_STATUS_BY_NAME.get(valueKey(cells.voting_status ?? ''));
  const appointedBy = APPOINTED_BY_BY_NAME.get(valueKey(cells.appointed_by ?? ''));
  if (role) canonical.role = role;
  if (votingStatus) canonical.voting_status = votingStatus;
  if (appointedBy) canonical.appointed_by = appointedBy;
  return canonical;
}

/**
 * Maps each header position to its template column, or null for a column the import ignores
 * (unrecognized or without a header). Repeated columns and missing required columns are errors.
 */
function readHeaders(
  headerCells: string[],
  rules: MemberImportGroupRules
): { columns: (MemberImportColumn | null)[]; ignored: { index: number; label: string }[]; errors: string[] } {
  const errors: string[] = [];
  const columns: (MemberImportColumn | null)[] = [];
  const ignored: { index: number; label: string }[] = [];
  const seen = new Set<string>();

  headerCells.forEach((raw, index) => {
    const label = raw.trim();
    const key = headerKey(label);
    const column = COLUMN_BY_HEADER_KEY.get(key) ?? null;
    const isMetadata = key === headerKey(MEMBER_IMPORT_ERRORS_COLUMN) || key === headerKey(MEMBER_IMPORT_ENCODING_COLUMN);
    if (!column && !isMetadata) {
      ignored.push({ index, label });
    } else if (seen.has(key)) {
      errors.push(`The column "${column ?? label}" appears more than once.`);
    } else {
      seen.add(key);
    }
    columns.push(column);
  });

  const missing = getMemberImportFieldGuide(rules)
    .filter((field) => field.required && !seen.has(headerKey(field.column)))
    .map((field) => `"${field.column}"`);
  if (missing.length > 0) {
    const unrecognized = ignored.filter(({ label }) => label).map(({ label }) => `"${label}"`);
    const hint = unrecognized.length > 0 ? ` Columns not recognized: ${unrecognized.join(', ')}.` : '';
    errors.push(`Missing required columns for this group: ${missing.join(', ')}.${hint}`);
  }

  return { columns, ignored, errors };
}

function checkLength(value: string, max: number, column: MemberImportColumn, label: string, add: (column: MemberImportColumn, message: string) => void): void {
  // Count Unicode code points, not UTF-16 units, to match the upstream MaxLength.
  if ([...value].length > max) {
    add(column, `${label} must be ${max} characters or fewer.`);
  }
}

function validateOrganization(name: string, website: string, rules: MemberImportGroupRules, add: (column: MemberImportColumn, message: string) => void): void {
  if (!name && !website) {
    if (rules.requiresOrganization) {
      add('organization_name', 'Organization name is required for this group.');
      add('organization_website', 'Organization website is required for this group.');
    }
    return;
  }

  if (!name) {
    add('organization_name', 'Organization name is required when a website is given.');
  } else {
    checkLength(name, 200, 'organization_name', 'Organization name', add);
  }

  if (!website) {
    add('organization_website', 'Organization website is required when a name is given.');
  } else if (!isAbsoluteHttpUrl(website, ['https:'])) {
    add('organization_website', 'Organization website must be a full https:// address.');
  }
}

function validateDateRange(
  cells: MemberImportCells,
  startColumn: MemberImportColumn,
  endColumn: MemberImportColumn,
  hasOwner: boolean,
  ownerLabel: string,
  add: (column: MemberImportColumn, message: string) => void
): void {
  const start = cells[startColumn] ?? '';
  const end = cells[endColumn] ?? '';
  let datesValid = true;

  for (const [column, date] of [
    [startColumn, start],
    [endColumn, end],
  ] as const) {
    if (!date) {
      continue;
    }
    if (!isRealDate(date)) {
      add(column, `"${date}" is not a real date in YYYY-MM-DD format.`);
      datesValid = false;
    } else if (!hasOwner) {
      add(column, `Dates need a ${ownerLabel}.`);
    }
  }

  // ISO YYYY-MM-DD strings sort chronologically.
  if (datesValid && start && end && start > end) {
    add(endColumn, 'End date must not be before the start date.');
  }
}

function isRealDate(value: string): boolean {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isAbsoluteHttpUrl(value: string, protocols: string[]): boolean {
  // Match the upstream HTTP(S) spelling before WHATWG parsing can repair missing slashes or backslashes.
  if (!MEMBER_IMPORT_HTTP_URL_PATTERN.test(value) || value.includes('\\')) {
    return false;
  }
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
