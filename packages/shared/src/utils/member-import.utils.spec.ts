// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Member CSV import contract (GH-3849). All people, organizations and domains are synthetic.

import { describe, expect, it } from 'vitest';

import { APPOINTED_BY_OPTIONS, MEMBER_FORM_VOTING_STATUSES, MEMBER_ROLES } from '../constants/committees.constants';
import { MEMBER_IMPORT_MAX_RECORDS, MEMBER_IMPORT_VOTING_COLUMNS } from '../constants/member-import.constants';
import { CommitteeMemberAppointedBy, CommitteeMemberRole, CommitteeMemberVotingStatus } from '../enums/committee-member.enum';
import type { MemberImportCells, MemberImportGroupRules } from '../interfaces/member-import.interface';
import {
  buildMemberImportPayload,
  getMemberImportFieldGuide,
  getMemberImportTemplateHeaders,
  parseMemberImportCsv,
  prepareMemberImportRows,
  validateMemberImportRow,
} from './member-import.utils';

const OPEN: MemberImportGroupRules = { requiresOrganization: false, votingEnabled: false };
const BUSINESS_EMAIL: MemberImportGroupRules = { requiresOrganization: true, votingEnabled: false };
const VOTING: MemberImportGroupRules = { requiresOrganization: true, votingEnabled: true };

const VOTING_HEADER = 'email,organization_name,organization_website,role,voting_status';
const VOTING_ROW = 'ada@example.com,Acme Motors,https://acme-motors.example,None,Voting Rep';

function messages(cells: MemberImportCells, rules: MemberImportGroupRules = OPEN): string[] {
  return validateMemberImportRow(cells, rules).map((issue) => `${issue.column}: ${issue.message}`);
}

describe('getMemberImportTemplateHeaders / getMemberImportFieldGuide', () => {
  it('leaves voting columns out of a non-voting template and requires only email for an open group', () => {
    const headers = getMemberImportTemplateHeaders(OPEN);
    expect(headers).not.toContain('voting_status');
    expect(headers).toContain('organization_name');
    expect(
      getMemberImportFieldGuide(OPEN)
        .filter((field) => field.required)
        .map((field) => field.column)
    ).toEqual(['email']);
  });

  it('requires organization, role and voting status for a voting group', () => {
    expect(getMemberImportTemplateHeaders(VOTING)).toContain('voting_end_date');
    expect(
      getMemberImportFieldGuide(VOTING)
        .filter((field) => field.required)
        .map((field) => field.column)
    ).toEqual(['email', 'organization_name', 'organization_website', 'role', 'voting_status']);
  });

  it('derives voting-only validation and guidance from the configured choices', () => {
    const labels = MEMBER_FORM_VOTING_STATUSES.map(({ label }) => label).join(', ');
    const guide = getMemberImportFieldGuide(VOTING).find(({ column }) => column === 'voting_status');
    expect(guide?.description).toBe(`${labels}.`);
    expect(messages({ email: 'ada@example.com', voting_status: 'unsupported' }, VOTING)).toContain(
      `voting_status: Voting status "unsupported" is not allowed. Use ${labels}.`
    );
    for (const column of MEMBER_IMPORT_VOTING_COLUMNS) {
      expect(getMemberImportTemplateHeaders(OPEN)).not.toContain(column);
      expect(messages({ email: 'ada@example.com', [column]: 'unsupported' })).toContain(`${column}: This group does not use voting. Clear the voting columns.`);
    }
  });

  it('lists every accepted role and appointment value from the configured options', () => {
    const guide = getMemberImportFieldGuide(OPEN);
    expect(guide.find(({ column }) => column === 'role')?.description).toBe(`Allowed values: ${MEMBER_ROLES.map(({ value }) => value).join(', ')}.`);
    expect(guide.find(({ column }) => column === 'appointed_by')?.description).toBe(
      `Allowed values: ${APPOINTED_BY_OPTIONS.map(({ value }) => value).join(', ')}. Leave blank for the default.`
    );
    for (const { value } of MEMBER_ROLES) {
      expect(messages({ email: 'ada@example.com', role: value })).toEqual([]);
    }
    for (const { value } of APPOINTED_BY_OPTIONS) {
      expect(messages({ email: 'ada@example.com', appointed_by: value })).toEqual([]);
    }
  });

  it('never offers username, status, permission or id columns', () => {
    const headers: string[] = getMemberImportTemplateHeaders(VOTING);
    for (const forbidden of ['username', 'status', 'permission', 'writer', 'organization_id', 'agency', 'country']) {
      expect(headers).not.toContain(forbidden);
    }
  });
});

describe('parseMemberImportCsv', () => {
  it('handles a BOM, CRLF endings and a trailing newline', () => {
    const result = parseMemberImportCsv('﻿email,first_name\r\nada@example.com,Ada\r\n', OPEN);
    expect(result.errors).toEqual([]);
    expect(result.headers).toEqual(['email', 'first_name']);
    expect(result.records).toEqual([{ rowNumber: 2, cells: { email: 'ada@example.com', first_name: 'Ada' } }]);
  });

  it('accepts flexible header order, trims header and cell whitespace, and allows omitted optional columns', () => {
    const result = parseMemberImportCsv(' last_name , email \nLovelace ,  ada@example.com', OPEN);
    expect(result.errors).toEqual([]);
    expect(result.records[0].cells).toEqual({ last_name: 'Lovelace', email: 'ada@example.com' });
  });

  it('keeps quoted commas, escaped quotes and embedded newlines inside one cell, numbering by record', () => {
    const csv = 'email,job_title\n"ada@example.com","Engineer, ""Platform""\nTeam"\ngrace@example.com,Admiral';
    const result = parseMemberImportCsv(csv, OPEN);
    expect(result.errors).toEqual([]);
    expect(result.records).toEqual([
      { rowNumber: 2, cells: { email: 'ada@example.com', job_title: 'Engineer, "Platform"\nTeam' } },
      { rowNumber: 3, cells: { email: 'grace@example.com', job_title: 'Admiral' } },
    ]);
  });

  it('skips blank records but still counts them in row numbers', () => {
    const result = parseMemberImportCsv('\nemail,first_name\n\n,\nada@example.com,Ada', OPEN);
    expect(result.errors).toEqual([]);
    expect(result.records.map((record) => record.rowNumber)).toEqual([5]);
  });

  it('preserves non-ASCII text', () => {
    const result = parseMemberImportCsv('email,first_name,last_name\nzoe@example.com,Zoë,Ñúñez 李', OPEN);
    expect(result.records[0].cells).toMatchObject({ first_name: 'Zoë', last_name: 'Ñúñez 李' });
  });

  it.each([
    ['', 'The file is empty'],
    ['\n \n', 'The file is empty'],
    ['email,first_name\n', 'no member rows'],
  ])('rejects empty or header-only input %#', (csv, expected) => {
    const result = parseMemberImportCsv(csv, OPEN);
    expect(result.records).toEqual([]);
    expect(result.errors[0]).toContain(expected);
  });

  it.each([
    ['email\n"ada@example.com', 'Row 2 has a quote that is never closed'],
    ['email,first_name\n"ada@example.com"x,Ada', 'Row 2 has text after a closing quote'],
    ['email,first_name\nada@example.com,Ad"a', 'Row 2 has a quote inside an unquoted value'],
  ])('rejects malformed quoting %#', (csv, expected) => {
    const result = parseMemberImportCsv(csv, OPEN);
    expect(result.records).toEqual([]);
    expect(result.errors).toEqual([expect.stringContaining(expected)]);
  });

  it('rejects rows whose cell count differs from the header instead of shifting columns', () => {
    const result = parseMemberImportCsv('email,first_name\nada@example.com,Ada,Lovelace\ngrace@example.com', OPEN);
    expect(result.records).toEqual([]);
    expect(result.errors).toEqual([expect.stringContaining('Row 2 has 3 cells but the header has 2'), expect.stringContaining('Row 3 has 1 cells')]);
  });

  it('rejects unknown, case-mismatched and unsupported permission/identity headers', () => {
    const result = parseMemberImportCsv('Email,username,permission,organization_id,status\na,b,c,d,e', OPEN);
    expect(result.records).toEqual([]);
    expect(result.errors).toContain(
      'Unknown columns: "Email", "username", "permission", "organization_id", "status". Use only the template\'s lowercase column names.'
    );
    expect(result.errors).toContain('Missing required columns for this group: "email".');
  });

  it('rejects repeated and empty headers', () => {
    const result = parseMemberImportCsv('email,,email\na,b,c', OPEN);
    expect(result.errors).toEqual(['Column 2 has no header.', 'The column "email" appears more than once.']);
  });

  it('requires organization columns for organization-required groups and role/voting columns for voting groups', () => {
    expect(parseMemberImportCsv('email\nada@example.com', BUSINESS_EMAIL).errors).toEqual([
      'Missing required columns for this group: "organization_name", "organization_website".',
    ]);
    expect(parseMemberImportCsv('email,organization_name,organization_website\nada@example.com,A,https://a.example', VOTING).errors).toEqual([
      'Missing required columns for this group: "role", "voting_status".',
    ]);
    expect(parseMemberImportCsv(`${VOTING_HEADER}\n${VOTING_ROW}`, VOTING).errors).toEqual([]);
  });

  it('skips large runs of blank records while preserving logical row numbers and quoting errors', () => {
    const blanks = '\n'.repeat(100_000);
    const result = parseMemberImportCsv(`${blanks}email,first_name\n${blanks}ada@example.com,"Ada\nExample"\n,\ngrace@example.com,Grace`, OPEN);
    expect(result.errors).toEqual([]);
    expect(result.records).toEqual([
      { rowNumber: 200_002, cells: { email: 'ada@example.com', first_name: 'Ada\nExample' } },
      { rowNumber: 200_004, cells: { email: 'grace@example.com', first_name: 'Grace' } },
    ]);
    expect(parseMemberImportCsv(`${blanks}email\n"unclosed`, OPEN).errors).toEqual(['Row 100002 has a quote that is never closed.']);
  });

  it('rejects over-limit input before tokenizing the remaining records', () => {
    const rows = Array.from({ length: MEMBER_IMPORT_MAX_RECORDS + 1 }, (_, i) => `person${i}@example.com`).join('\n');
    const result = parseMemberImportCsv(`email\n${rows}\n"unclosed`, OPEN);
    expect(result.records).toEqual([]);
    expect(result.errors).toEqual(['The file has more than 500 member rows; up to 500 can be imported at once. Split it into smaller files.']);
  });

  it('accepts exactly the record limit and rejects one more without truncating', () => {
    const rows = (count: number): string => Array.from({ length: count }, (_, i) => `person${i}@example.com`).join('\n');
    expect(parseMemberImportCsv(`email\n${rows(500)}`, OPEN).records).toHaveLength(500);

    const over = parseMemberImportCsv(`email\n${rows(501)}`, OPEN);
    expect(over.records).toEqual([]);
    expect(over.errors[0]).toContain('up to 500');
  });
});

describe('validateMemberImportRow', () => {
  it('accepts an email-only row for an open group — names are optional upstream', () => {
    expect(messages({ email: 'ada@example.com' })).toEqual([]);
  });

  it('requires a valid email', () => {
    expect(messages({ email: '' })).toEqual(['email: Email is required.']);
    expect(messages({ email: 'not-an-email' })).toEqual(['email: Email is not a valid address.']);
  });

  it.each([
    'ada,grace@example.com',
    'ada;grace@example.com',
    '.ada@example.com',
    'ada.@example.com',
    'ada..grace@example.com',
    'ada@-example.test',
    'ada@example..com',
    `${'a'.repeat(65)}@example.com`,
  ])('rejects malformed single addresses: %s', (email) => {
    expect(messages({ email })).toEqual(['email: Email is not a valid address.']);
  });

  it.each(['ada+group@example.com', "o'connor@example.com", 'Ada.Grace@sub.example.com', 'ada@localhost'])(
    'accepts single addresses supported by the individual member form: %s',
    (email) => expect(messages({ email })).toEqual([])
  );

  it('counts name and title lengths in Unicode code points', () => {
    expect(messages({ email: 'ada@example.com', first_name: '😀'.repeat(100) })).toEqual([]);
    expect(messages({ email: 'ada@example.com', last_name: 'x'.repeat(101), job_title: 'y'.repeat(201) })).toEqual([
      'last_name: Last name must be 100 characters or fewer.',
      'job_title: Job title must be 200 characters or fewer.',
    ]);
  });

  it('requires an absolute linkedin.com URL', () => {
    expect(messages({ email: 'ada@example.com', linkedin_profile: 'https://www.linkedin.com/in/ada-example' })).toEqual([]);
    expect(messages({ email: 'ada@example.com', linkedin_profile: 'http://www.linkedin.com/in/example-person' })).toEqual([]);
    expect(messages({ email: 'ada@example.com', linkedin_profile: 'linkedin.com/in/ada-example' })).toHaveLength(1);
    expect(messages({ email: 'ada@example.com', linkedin_profile: 'https://profiles.example/ada' })).toHaveLength(1);
  });

  it('requires the complete organization name + https website pair whenever either is given', () => {
    expect(messages({ email: 'ada@example.com', organization_name: 'Acme Motors' })).toEqual([
      'organization_website: Organization website is required when a name is given.',
    ]);
    expect(messages({ email: 'ada@example.com', organization_website: 'https://acme-motors.example' })).toEqual([
      'organization_name: Organization name is required when a website is given.',
    ]);
    expect(messages({ email: 'ada@example.com', organization_name: 'Acme Motors', organization_website: 'http://acme-motors.example' })).toEqual([
      'organization_website: Organization website must be a full https:// address.',
    ]);
    expect(messages({ email: 'ada@example.com', organization_name: 'Acme Motors', organization_website: 'acme-motors.example' })).toHaveLength(1);
    expect(messages({ email: 'ada@example.com', organization_name: 'o'.repeat(201), organization_website: 'https://acme-motors.example' })).toEqual([
      'organization_name: Organization name must be 200 characters or fewer.',
    ]);
  });

  it.each(['https:org.example', 'https:/org.example', 'https:///org.example', 'https:\\\\org.example', 'https://\\org.example', 'https://org.example\\team'])(
    'rejects an organization website whose spelling URL parsing repairs: %s',
    (website) => {
      expect(messages({ email: 'ada@example.com', organization_name: 'Example Org', organization_website: website }, BUSINESS_EMAIL)).toEqual([
        'organization_website: Organization website must be a full https:// address.',
      ]);
    }
  );

  it('preserves an accepted HTTPS website including its path, query and fragment', () => {
    const cells = { email: 'ada@example.com', organization_name: 'Example Org', organization_website: 'https://org.example/team?lang=en#people' };
    expect(messages(cells, BUSINESS_EMAIL)).toEqual([]);
    expect(buildMemberImportPayload(cells).organization?.website).toBe(cells.organization_website);
  });

  it('requires an organization for business-email and voting groups', () => {
    expect(messages({ email: 'ada@example.com' }, BUSINESS_EMAIL)).toEqual([
      'organization_name: Organization name is required for this group.',
      'organization_website: Organization website is required for this group.',
    ]);
  });

  it('accepts only existing role values and dates that need a role', () => {
    expect(messages({ email: 'ada@example.com', role: 'Chair', role_start_date: '2026-01-01', role_end_date: '2026-12-31' })).toEqual([]);
    expect(messages({ email: 'ada@example.com', role: 'chair' })).toEqual(['role: Role "chair" is not a recognized role.']);
    expect(messages({ email: 'ada@example.com', role_start_date: '2026-01-01' })).toEqual(['role_start_date: Dates need a role.']);
  });

  it('rejects impossible or non-ISO dates and reversed ranges', () => {
    expect(messages({ email: 'ada@example.com', role: 'Chair', role_start_date: '2026-02-30' })).toEqual([
      'role_start_date: "2026-02-30" is not a real date in YYYY-MM-DD format.',
    ]);
    expect(messages({ email: 'ada@example.com', role: 'Chair', role_end_date: '12/31/2026' })).toHaveLength(1);
    expect(messages({ email: 'ada@example.com', role: 'Chair', role_start_date: '2026-06-01', role_end_date: '2026-05-31' })).toEqual([
      'role_end_date: End date must not be before the start date.',
    ]);
  });

  it('requires role and a non-None voting status for voting groups', () => {
    const base = { email: 'ada@example.com', organization_name: 'Acme Motors', organization_website: 'https://acme-motors.example' };
    expect(messages(base, VOTING)).toEqual(['role: Role is required for voting groups.', 'voting_status: Voting status is required for voting groups.']);
    expect(messages({ ...base, role: 'None', voting_status: 'None' }, VOTING)).toEqual([
      `voting_status: Voting status "None" is not allowed. Use ${MEMBER_FORM_VOTING_STATUSES.map(({ label }) => label).join(', ')}.`,
    ]);
    expect(messages({ ...base, role: 'None', voting_status: 'Observer', voting_start_date: '2026-01-01' }, VOTING)).toEqual([]);
  });

  it('rejects populated voting cells for non-voting groups instead of dropping them', () => {
    expect(messages({ email: 'ada@example.com', voting_status: 'Voting Rep', voting_end_date: '2026-01-01' })).toEqual([
      'voting_status: This group does not use voting. Clear the voting columns.',
      'voting_end_date: This group does not use voting. Clear the voting columns.',
    ]);
    expect(messages({ email: 'ada@example.com', voting_status: '' })).toEqual([]);
  });

  it('accepts only existing appointed-by values and allows blank', () => {
    expect(messages({ email: 'ada@example.com', appointed_by: 'Community' })).toEqual([]);
    expect(messages({ email: 'ada@example.com', appointed_by: '' })).toEqual([]);
    expect(messages({ email: 'ada@example.com', appointed_by: 'The Board' })).toHaveLength(1);
  });
});

describe('buildMemberImportPayload', () => {
  it('maps every supported column to the native create-member body', () => {
    expect(
      buildMemberImportPayload({
        email: 'Ada@Example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        job_title: 'Engineer',
        linkedin_profile: 'https://www.linkedin.com/in/ada-example',
        organization_name: 'Acme Motors',
        organization_website: 'https://acme-motors.example',
        role: 'Chair',
        role_start_date: '2026-01-01',
        role_end_date: '2026-12-31',
        voting_status: 'Voting Rep',
        voting_start_date: '2026-02-01',
        voting_end_date: '2026-11-30',
        appointed_by: 'Community',
      })
    ).toEqual({
      email: 'ada@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      job_title: 'Engineer',
      linkedin_profile: 'https://www.linkedin.com/in/ada-example',
      organization: { id: null, name: 'Acme Motors', website: 'https://acme-motors.example' },
      role: { name: CommitteeMemberRole.CHAIR, start_date: '2026-01-01', end_date: '2026-12-31' },
      voting: { status: CommitteeMemberVotingStatus.VOTING_REP, start_date: '2026-02-01', end_date: '2026-11-30' },
      appointed_by: CommitteeMemberAppointedBy.COMMUNITY,
    });
  });

  it('omits empty optional fields and nested objects instead of sending empty strings', () => {
    expect(
      buildMemberImportPayload({ email: 'ada@example.com', first_name: '', role: '', role_start_date: '', organization_name: '', voting_status: '' })
    ).toEqual({
      email: 'ada@example.com',
    });
    expect(buildMemberImportPayload({ email: 'ada@example.com', role: 'Lead' })).toEqual({ email: 'ada@example.com', role: { name: 'Lead' } });
  });

  it('never sends an organization id', () => {
    const payload = buildMemberImportPayload({
      email: 'ada@example.com',
      organization_name: 'Acme Motors',
      organization_website: 'https://acme-motors.example',
    });
    expect(payload.organization?.id).toBeNull();
    expect(Object.keys(payload)).toEqual(['email', 'organization']);
  });
});

describe('prepareMemberImportRows', () => {
  const rows = (csv: string, rules: MemberImportGroupRules, existing: string[] = []) =>
    prepareMemberImportRows(parseMemberImportCsv(csv, rules).records, rules, new Set(existing));

  it('marks valid rows ready with a payload and invalid rows with their issues', () => {
    const [ready, invalid] = rows('email,first_name\nada@example.com,Ada\nbad,Grace', OPEN);
    expect(ready).toMatchObject({ rowNumber: 2, status: 'ready', payload: { email: 'ada@example.com', first_name: 'Ada' } });
    expect(invalid).toMatchObject({ rowNumber: 3, status: 'invalid', payload: null, issues: [{ column: 'email' }] });
  });

  it('skips existing members and later duplicates using trimmed, case-insensitive email', () => {
    const result = rows('email\n Ada@Example.com \nGRACE@example.com\ngrace@example.com\nada@example.com', OPEN, ['ada@example.com']);
    expect(result.map((row) => [row.rowNumber, row.status, row.reason])).toEqual([
      [2, 'skipped', 'Already a member of this group.'],
      [3, 'ready', undefined],
      [4, 'skipped', 'Duplicate of row 3.'],
      [5, 'skipped', 'Already a member of this group.'],
    ]);
  });

  it('keeps the first occurrence even when it is invalid and a later duplicate is valid', () => {
    const result = rows(`${VOTING_HEADER}\nada@example.com,,,None,Voting Rep\n${VOTING_ROW}`, VOTING);
    expect(result.map((row) => row.status)).toEqual(['invalid', 'skipped']);
    expect(result[1].reason).toBe('Duplicate of row 2.');
  });

  it('builds a separate organization per row', () => {
    const result = rows(
      'email,organization_name,organization_website\nada@example.com,Acme Motors,https://acme-motors.example\ngrace@example.com,Vendor Corp,https://vendor-corp.example',
      BUSINESS_EMAIL
    );
    expect(result.map((row) => row.payload?.organization)).toEqual([
      { id: null, name: 'Acme Motors', website: 'https://acme-motors.example' },
      { id: null, name: 'Vendor Corp', website: 'https://vendor-corp.example' },
    ]);
  });
});
