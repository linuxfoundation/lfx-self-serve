// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import {
  MentorshipUpstreamAdministeredProgram,
  MentorshipUpstreamMemberManagementRow,
  MentorshipUpstreamProgramHeader,
  MentorshipUpstreamProgramTerm,
  MentorshipUpstreamTermManagementRow,
} from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import {
  mapMentorshipAdminHeaderProgram,
  mapMentorshipAdminMentorRow,
  mapMentorshipAdminProgram,
  mapMentorshipAdminTermRow,
  mentorshipPublishedProgramStatus,
} from './mentorship-admin-program.helper';

const upstream = (overrides: Partial<MentorshipUpstreamAdministeredProgram> = {}): MentorshipUpstreamAdministeredProgram => ({
  id: 'p-1',
  slug: 'program-one',
  name: 'Program One',
  status: 'published',
  admin_status: 'accepting',
  project_name: 'Energy Project',
  stats: { mentors: 2, mentees: 3, graduated: 1 },
  created_on: '2026-01-01T00:00:00Z',
  updated_on: '2026-01-02T00:00:00Z',
  ...overrides,
});

describe('mapMentorshipAdminProgram', () => {
  it.each([
    ['accepting', 'accepting'],
    ['in_progress', 'in-progress'],
    ['upcoming', 'upcoming'],
    ['pending_review', 'pending-review'],
    ['completed', 'completed'],
    ['rejected', 'rejected'],
    ['hidden', 'hidden'],
  ])('reads admin_status %s as %s', (adminStatus, expected) => {
    expect(mapMentorshipAdminProgram(upstream({ admin_status: adminStatus }))).toMatchObject({ program: { status: expected }, unknownStatus: false });
  });

  it.each(['mystery', 'constructor', '', 'open', 'in-progress'])('reads the unknown admin_status "%s" as pending-review and flags it', (adminStatus) => {
    expect(mapMentorshipAdminProgram(upstream({ admin_status: adminStatus }))).toMatchObject({ program: { status: 'pending-review' }, unknownStatus: true });
  });

  it('maps the card fields', () => {
    expect(mapMentorshipAdminProgram(upstream({ logo_url: 'https://logo.example/p.png' })).program).toEqual({
      id: 'p-1',
      slug: 'program-one',
      name: 'Program One',
      projectName: 'Energy Project',
      status: 'accepting',
      stats: { mentors: 2, mentees: 3, graduated: 1 },
      logoUrl: 'https://logo.example/p.png',
      logoMissing: false,
      createdOn: '2026-01-01T00:00:00Z',
      updatedOn: '2026-01-02T00:00:00Z',
    });
  });

  it.each([
    ['pending', undefined, true],
    ['published', undefined, true],
    ['published', '', true],
    ['pending', 'https://logo.example/p.png', false],
    ['published', 'https://logo.example/p.png', false],
    ['rejected', undefined, false],
    ['submitted', undefined, false],
    ['hidden', undefined, false],
  ])('reads status %s with logo %s as logoMissing %s', (status, logoUrl, expected) => {
    expect(mapMentorshipAdminProgram(upstream({ status, logo_url: logoUrl })).program.logoMissing).toBe(expected);
  });

  it('falls back to empty text for a missing project, and to the id for a missing slug', () => {
    const { program } = mapMentorshipAdminProgram(upstream({ slug: undefined, project_name: undefined }));

    expect(program).toMatchObject({ slug: 'p-1', projectName: '' });
    expect(program).not.toHaveProperty('logoUrl');
  });
});

const header = (status: string, overrides: Partial<MentorshipUpstreamProgramHeader> = {}): MentorshipUpstreamProgramHeader => ({
  program: {
    id: 'p-1',
    slug: 'program-one',
    name: 'Program One',
    status,
    project_name: 'Energy Project',
    created_on: '2026-01-01T00:00:00Z',
    updated_on: '2026-01-02T00:00:00Z',
  },
  active_term: { id: 't-1', name: 'Spring', status: 'open' },
  stats: { mentors: 2, mentees: 3, graduated: 1 },
  ...overrides,
});

// 2026-11-09 12:00 UTC.
const NOW = new Date('2026-11-09T12:00:00Z');
const at = (iso: string) => `${iso}T00:00:00Z`;
const term = (status: MentorshipUpstreamProgramTerm['status'], dates: Partial<MentorshipUpstreamProgramTerm> = {}) => ({ status, ...dates });

describe('mentorshipPublishedProgramStatus', () => {
  const rules = [
    ['only closed terms', [term('closed'), term('deleted')], 'completed'],
    ['no terms', [], 'upcoming'],
    ['only deleted terms', [term('deleted')], 'upcoming'],
    [
      'an open term inside its application window',
      [term('open', { application_start_date: at('2026-11-01'), application_end_date: at('2026-11-30') })],
      'accepting',
    ],
    [
      'an open term whose application window ends today, at any time of day',
      [term('open', { application_start_date: at('2026-11-01'), application_end_date: '2026-11-09T00:00:00Z' })],
      'accepting',
    ],
    [
      'an open term whose application window opens today',
      [term('open', { application_start_date: '2026-11-09T23:00:00Z', application_end_date: at('2026-11-30') })],
      'accepting',
    ],
    [
      'one term taking applications and another running',
      [
        term('open', { start_date_time: at('2026-09-01'), end_date_time: at('2026-12-31') }),
        term('open', { application_start_date: at('2026-11-01'), application_end_date: at('2026-11-30') }),
      ],
      'accepting',
    ],
    [
      'an open term inside its term window, beside one whose application window has not opened',
      [
        term('open', {
          application_start_date: at('2026-08-01'),
          application_end_date: at('2026-08-15'),
          start_date_time: at('2026-09-01'),
          end_date_time: at('2026-12-31'),
        }),
        term('open', { application_start_date: at('2026-12-01'), application_end_date: at('2026-12-15') }),
      ],
      'in-progress',
    ],
    [
      'an open term whose application window has not opened',
      [term('open', { application_start_date: at('2026-12-01'), application_end_date: at('2026-12-15'), start_date_time: at('2027-01-01') })],
      'upcoming',
    ],
    ['an open term with only a future application start', [term('open', { application_start_date: at('2026-12-01') })], 'in-progress'],
    [
      'an open term whose applications closed before it started',
      [
        term('open', {
          application_start_date: at('2026-10-01'),
          application_end_date: at('2026-10-31'),
          start_date_time: at('2026-12-01'),
          end_date_time: at('2027-03-31'),
        }),
      ],
      'in-progress',
    ],
    ['an open term that ended without being closed', [term('open', { start_date_time: at('2026-01-01'), end_date_time: at('2026-06-30') })], 'in-progress'],
    ['an open term with no dates', [term('open')], 'in-progress'],
    [
      'an open term beside a closed one',
      [term('closed'), term('open', { application_start_date: at('2026-12-01'), application_end_date: at('2026-12-15') })],
      'upcoming',
    ],
  ] as const;

  it.each(rules.map(([label, terms, expected]) => ({ label, terms, expected })))('reads $label as $expected', ({ terms, expected }) => {
    expect(mentorshipPublishedProgramStatus(terms, NOW)).toBe(expected);
  });

  // Beside a term whose application window is still ahead, a running term reads In Progress and one that is not
  // running reads Upcoming, so these cases fail if the running check is dropped or compares by day.
  describe('compares the term window to the time, not the day, ahead of Upcoming', () => {
    const upcoming = term('open', { application_start_date: at('2026-12-01'), application_end_date: at('2026-12-15') });
    const statusWith = (start: string, end: string) =>
      mentorshipPublishedProgramStatus([term('open', { start_date_time: start, end_date_time: end }), upcoming], NOW);

    it.each([
      ['starts now', '2026-11-09T12:00:00Z', at('2027-01-01')],
      ['ends now', at('2026-09-01'), '2026-11-09T12:00:00Z'],
    ])('reads a term that %s as in progress', (_label, start, end) => {
      expect(statusWith(start, end)).toBe('in-progress');
    });

    it.each([
      ['ended a second ago', at('2026-09-01'), '2026-11-09T11:59:59Z'],
      ['starts in a second', '2026-11-09T12:00:01Z', at('2027-01-01')],
    ])('reads a term that %s, beside an upcoming one, as upcoming', (_label, start, end) => {
      expect(statusWith(start, end)).toBe('upcoming');
    });
  });
});

describe('mapMentorshipAdminHeaderProgram', () => {
  it('reads a published program from its terms', () => {
    const terms = [term('open', { application_start_date: at('2026-11-01'), application_end_date: at('2026-11-30') })];

    expect(mapMentorshipAdminHeaderProgram(header('published'), { has_open_term: true, has_closed_term: false }, terms, NOW)).toMatchObject({
      program: { status: 'accepting' },
      unknownStatus: false,
    });
  });

  it.each([
    ['an open term', { has_open_term: true, has_closed_term: true }, 'in-progress'],
    ['only closed terms', { has_open_term: false, has_closed_term: true }, 'completed'],
    ['no terms', { has_open_term: false, has_closed_term: false }, 'upcoming'],
  ] as const)('reads a published program with %s from the summary when its terms are missing, as %s', (_label, summary, expected) => {
    expect(mapMentorshipAdminHeaderProgram(header('published'), summary)).toMatchObject({ program: { status: expected }, unknownStatus: false });
  });

  it('reads a published program as in progress when the summary and terms are missing', () => {
    expect(mapMentorshipAdminHeaderProgram(header('published')).program.status).toBe('in-progress');
  });

  it.each([
    ['pending', 'pending-review'],
    ['rejected', 'rejected'],
    ['hidden', 'hidden'],
  ])('reads the unpublished status %s as %s', (status, expected) => {
    expect(mapMentorshipAdminHeaderProgram(header(status), { has_open_term: true, has_closed_term: false })).toMatchObject({
      program: { status: expected },
      unknownStatus: false,
    });
  });

  it.each(['mystery', 'constructor', 'submitted', 'archived'])('reads the unknown status "%s" as pending-review and flags it', (status) => {
    expect(mapMentorshipAdminHeaderProgram(header(status))).toMatchObject({ program: { status: 'pending-review' }, unknownStatus: true });
  });

  it('maps the header fields, leaving out the active term', () => {
    expect(mapMentorshipAdminHeaderProgram(header('published')).program).toEqual({
      id: 'p-1',
      slug: 'program-one',
      name: 'Program One',
      projectName: 'Energy Project',
      status: 'in-progress',
      stats: { mentors: 2, mentees: 3, graduated: 1 },
      createdOn: '2026-01-01T00:00:00Z',
      updatedOn: '2026-01-02T00:00:00Z',
    });
  });

  it('leaves logoMissing to the list row, even for a pending program without a logo', () => {
    expect(mapMentorshipAdminHeaderProgram(header('pending')).program).not.toHaveProperty('logoMissing');
  });
});

const memberRow = (overrides: Partial<MentorshipUpstreamMemberManagementRow> = {}): MentorshipUpstreamMemberManagementRow => ({
  id: 'm-1',
  user_id: 'u-1',
  name: 'Ada Mentor',
  email: 'ada@example.com',
  username: 'ada',
  avatar_url: 'https://img.example/ada.png',
  status: 'approved',
  created_on: '2026-02-03T10:00:00Z',
  updated_on: '2026-02-04T10:00:00Z',
  profile_created: true,
  ...overrides,
});

describe('mapMentorshipAdminMentorRow', () => {
  it('maps the row fields', () => {
    expect(mapMentorshipAdminMentorRow(memberRow())).toEqual({
      mentor: {
        id: 'm-1',
        name: 'Ada Mentor',
        email: 'ada@example.com',
        avatarUrl: 'https://img.example/ada.png',
        status: 'approved',
        invitedOn: '2026-02-03',
        profileCreated: true,
      },
      unknownStatus: false,
    });
  });

  it.each([
    ['requested', 'requested'],
    ['pending', 'pending'],
    ['invited', 'invited'],
    ['approved', 'approved'],
    ['declined', 'declined'],
    ['withdrawn', 'withdrawn'],
  ])('reads upstream status %s as %s', (status, expected) => {
    expect(mapMentorshipAdminMentorRow(memberRow({ status }))).toMatchObject({ mentor: { status: expected }, unknownStatus: false });
  });

  it.each([undefined, 'active', 'mystery', 'constructor'])('reads the unknown status %s as pending and flags it', (status) => {
    expect(mapMentorshipAdminMentorRow(memberRow({ status }))).toMatchObject({ mentor: { status: 'pending' }, unknownStatus: true });
  });

  it("keeps the mentor's user id only when it is a UUID", () => {
    expect(mapMentorshipAdminMentorRow(memberRow({ user_id: '6f1c2d3e-4a5b-4c6d-8e7f-901234567890' })).mentor.userId).toBe(
      '6f1c2d3e-4a5b-4c6d-8e7f-901234567890'
    );
    expect(mapMentorshipAdminMentorRow(memberRow()).mentor).not.toHaveProperty('userId');
  });

  it('falls back from name to username to email to empty, and drops an absent avatar', () => {
    expect(mapMentorshipAdminMentorRow(memberRow({ name: undefined })).mentor.name).toBe('ada');
    expect(mapMentorshipAdminMentorRow(memberRow({ name: undefined, username: undefined })).mentor.name).toBe('ada@example.com');

    const { mentor } = mapMentorshipAdminMentorRow(memberRow({ name: undefined, username: undefined, email: undefined, avatar_url: undefined }));
    expect(mentor).toMatchObject({ name: '', email: '' });
    expect(mentor).not.toHaveProperty('avatarUrl');
  });
});

const termRow = (overrides: Partial<MentorshipUpstreamTermManagementRow> = {}): MentorshipUpstreamTermManagementRow => ({
  id: 't-1',
  program_id: 'p-1',
  name: 'Spring 2026',
  status: 'open',
  active_users: 4,
  start_date_time: '2026-03-01T00:00:00Z',
  end_date_time: '2026-05-31T00:00:00Z',
  application_start_date: '2026-01-05T00:00:00Z',
  application_end_date: '2026-02-15T23:59:59Z',
  created_on: '2025-12-01T00:00:00Z',
  updated_on: '2025-12-02T00:00:00Z',
  pending: 1,
  declined: 2,
  accepted: 3,
  graduated: 4,
  ...overrides,
});

describe('mapMentorshipAdminTermRow', () => {
  it('maps the row, the counts and the dates', () => {
    expect(mapMentorshipAdminTermRow(termRow())).toEqual({
      id: 't-1',
      name: 'Spring 2026',
      status: 'open',
      pending: 1,
      declined: 2,
      accepted: 3,
      graduated: 4,
      startDate: '2026-03-01',
      endDate: '2026-05-31',
      applicationStartDate: '2026-01-05',
      applicationEndDate: '2026-02-15',
    });
  });

  it('reads a closed term as closed and a missing date as empty', () => {
    expect(mapMentorshipAdminTermRow(termRow({ status: 'closed', start_date_time: undefined, application_end_date: undefined }))).toMatchObject({
      status: 'closed',
      startDate: '',
      applicationEndDate: '',
    });
  });

  it('drops a deleted term', () => {
    expect(mapMentorshipAdminTermRow(termRow({ status: 'deleted' }))).toBeNull();
  });
});
