// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { APPOINTED_BY_OPTIONS, MEMBER_FORM_VOTING_STATUSES, MEMBER_ROLES } from '../constants/committees.constants';
import {
  MEMBER_IMPORT_COLUMNS,
  MEMBER_IMPORT_EMAIL_PATTERN,
  MEMBER_IMPORT_FIELDS,
  MEMBER_IMPORT_HTTP_URL_PATTERN,
  MEMBER_IMPORT_MAX_RECORDS,
  MEMBER_IMPORT_VOTING_COLUMNS,
  MEMBER_IMPORT_VOTING_STATUS_LABELS,
} from '../constants/member-import.constants';
import { LINKEDIN_PROFILE_PATTERN } from '../constants/validation.constants';
import type { CreateCommitteeMemberRequest } from '../interfaces/member.interface';
import type {
  MemberImportCells,
  MemberImportColumn,
  MemberImportFieldDefinition,
  MemberImportFieldGuide,
  MemberImportGroupRules,
  MemberImportParseResult,
  MemberImportRecord,
  MemberImportRow,
  MemberImportValidationIssue,
} from '../interfaces/member-import.interface';
import { buildCommitteeOrganizationPayload } from './invitation.utils';

const KNOWN_COLUMNS = new Set<string>(MEMBER_IMPORT_COLUMNS);
const ROLE_BY_NAME = new Map(MEMBER_ROLES.map(({ value }) => [value as string, value]));
const VOTING_STATUS_BY_NAME = new Map(MEMBER_FORM_VOTING_STATUSES.map(({ value }) => [value as string, value]));
const APPOINTED_BY_BY_NAME = new Map(APPOINTED_BY_OPTIONS.map(({ value }) => [value as string, value]));
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

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
 * Strictly parses member import CSV text (comma delimiter, RFC 4180 quoting) and checks its header.
 *
 * Handles a UTF-8 BOM, CRLF/LF line endings, quoted commas/newlines and escaped `""` quotes, and
 * skips blank records while still counting them, so every `rowNumber` matches the source record
 * (the first record is row 1). Anything that could shift or lose data — unterminated quotes, text after a
 * closing quote, a cell count that differs from the header, unknown/repeated/missing headers — is
 * reported in `errors` and no records are returned. Never truncates: more than
 * {@link MEMBER_IMPORT_MAX_RECORDS} member rows is an error.
 */
export function parseMemberImportCsv(text: string, rules: MemberImportGroupRules): MemberImportParseResult {
  const tokenized = tokenizeCsv(text.startsWith('﻿') ? text.slice(1) : text);
  if ('error' in tokenized) {
    return { headers: [], records: [], errors: [tokenized.error] };
  }

  // Tokenization discards blank records but keeps each retained record's original logical row number.
  const header = tokenized.rows[0];
  if (!header) {
    return { headers: [], records: [], errors: ['The file is empty. Download the template and add one member per row.'] };
  }

  const headerResult = readHeaders(header.cells, rules);
  if (headerResult.errors.length > 0) {
    return { headers: [], records: [], errors: headerResult.errors };
  }
  const headers = headerResult.headers;

  const errors: string[] = [];
  const records: MemberImportRecord[] = [];
  tokenized.rows.slice(1).forEach(({ cells, rowNumber }) => {
    if (cells.length !== headers.length) {
      errors.push(`Row ${rowNumber} has ${cells.length} cells but the header has ${headers.length}. Put quotes around values that contain commas.`);
      return;
    }
    const record: MemberImportCells = {};
    headers.forEach((header, column) => {
      record[header] = cells[column].trim();
    });
    records.push({ rowNumber, cells: record });
  });

  if (errors.length > 0) {
    return { headers: [], records: [], errors };
  }
  if (records.length === 0) {
    return { headers: [], records: [], errors: ['The file has a header but no member rows.'] };
  }
  return { headers, records, errors: [] };
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
  } else if (role && !ROLE_BY_NAME.has(role)) {
    add('role', `Role "${role}" is not a recognized role.`);
  }
  validateDateRange(cells, 'role_start_date', 'role_end_date', !!role, 'role', add);

  if (rules.votingEnabled) {
    const votingStatus = value('voting_status');
    if (!votingStatus) {
      add('voting_status', 'Voting status is required for voting groups.');
    } else if (!VOTING_STATUS_BY_NAME.has(votingStatus)) {
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
  if (appointedBy && !APPOINTED_BY_BY_NAME.has(appointedBy)) {
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

  const role = ROLE_BY_NAME.get(value('role'));
  if (role) {
    payload.role = { name: role };
    if (value('role_start_date')) payload.role.start_date = value('role_start_date');
    if (value('role_end_date')) payload.role.end_date = value('role_end_date');
  }

  const votingStatus = VOTING_STATUS_BY_NAME.get(value('voting_status'));
  if (votingStatus) {
    payload.voting = { status: votingStatus };
    if (value('voting_start_date')) payload.voting.start_date = value('voting_start_date');
    if (value('voting_end_date')) payload.voting.end_date = value('voting_end_date');
  }

  const appointedBy = APPOINTED_BY_BY_NAME.get(value('appointed_by'));
  if (appointedBy) {
    payload.appointed_by = appointedBy;
  }

  return payload;
}

/**
 * Turns parsed records into preview rows: validates each, then skips people already in the group
 * and later repeats of an email earlier in the file (trimmed + lowercased comparison). The first
 * occurrence is always the one kept — even when it is invalid — so fixing it is the user's call.
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
    return { ...base, status: 'ready', issues, payload: buildMemberImportPayload(cells) };
  });
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

function readHeaders(headerCells: string[], rules: MemberImportGroupRules): { headers: MemberImportColumn[]; errors: string[] } {
  const errors: string[] = [];
  const headers: MemberImportColumn[] = [];
  const seen = new Set<string>();
  const unknown: string[] = [];

  headerCells.forEach((raw, index) => {
    const header = raw.trim();
    if (!header) {
      errors.push(`Column ${index + 1} has no header.`);
    } else if (!KNOWN_COLUMNS.has(header)) {
      unknown.push(header);
    } else if (seen.has(header)) {
      errors.push(`The column "${header}" appears more than once.`);
    } else {
      seen.add(header);
      headers.push(header as MemberImportColumn);
    }
  });

  if (unknown.length > 0) {
    errors.push(`Unknown columns: ${unknown.map((header) => `"${header}"`).join(', ')}. Use only the template's lowercase column names.`);
  }

  const missing = getMemberImportFieldGuide(rules)
    .filter((field) => field.required && !seen.has(field.column))
    .map((field) => `"${field.column}"`);
  if (missing.length > 0) {
    errors.push(`Missing required columns for this group: ${missing.join(', ')}.`);
  }

  return { headers, errors };
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
