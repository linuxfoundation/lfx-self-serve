// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MentorshipUpstreamAdministeredProgram,
  MentorshipUpstreamMemberManagementRow,
  MentorshipUpstreamProgramHeader,
  MentorshipUpstreamTermManagementRow,
} from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import {
  mapMentorshipAdminHeaderProgram,
  mapMentorshipAdminMentorRow,
  mapMentorshipAdminProgram,
  mapMentorshipAdminTermRow,
} from './mentorship-admin-program.helper';

const upstream = (overrides: Partial<MentorshipUpstreamAdministeredProgram> = {}): MentorshipUpstreamAdministeredProgram => ({
  id: 'p-1',
  slug: 'program-one',
  name: 'Program One',
  status: 'published',
  admin_status: 'open',
  project_name: 'Energy Project',
  term: { id: 't-1', name: 'Spring', status: 'open' },
  stats: { mentors: 2, mentees: 3, graduated: 1 },
  created_on: '2026-01-01T00:00:00Z',
  updated_on: '2026-01-02T00:00:00Z',
  ...overrides,
});

describe('mapMentorshipAdminProgram', () => {
  it.each([
    ['open', 'open'],
    ['pending_review', 'pending-review'],
    ['completed', 'completed'],
    ['rejected', 'rejected'],
    ['hidden', 'hidden'],
  ])('reads admin_status %s as %s', (adminStatus, expected) => {
    expect(mapMentorshipAdminProgram(upstream({ admin_status: adminStatus }))).toMatchObject({ program: { status: expected }, unknownStatus: false });
  });

  it.each(['mystery', 'constructor', ''])('reads the unknown admin_status "%s" as pending-review and flags it', (adminStatus) => {
    expect(mapMentorshipAdminProgram(upstream({ admin_status: adminStatus }))).toMatchObject({ program: { status: 'pending-review' }, unknownStatus: true });
  });

  it('maps the card fields', () => {
    expect(mapMentorshipAdminProgram(upstream({ logo_url: 'https://logo.example/p.png' })).program).toEqual({
      id: 'p-1',
      slug: 'program-one',
      name: 'Program One',
      projectName: 'Energy Project',
      term: 'Spring',
      status: 'open',
      stats: { mentors: 2, mentees: 3, graduated: 1 },
      logoUrl: 'https://logo.example/p.png',
      createdOn: '2026-01-01T00:00:00Z',
      updatedOn: '2026-01-02T00:00:00Z',
    });
  });

  it('falls back to empty text for a missing project and term, and to the id for a missing slug', () => {
    const { program } = mapMentorshipAdminProgram(upstream({ slug: undefined, project_name: undefined, term: undefined }));

    expect(program).toMatchObject({ slug: 'p-1', projectName: '', term: '' });
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

describe('mapMentorshipAdminHeaderProgram', () => {
  it.each([
    ['published, an open term', { has_open_term: true, has_closed_term: true }, 'open'],
    ['published, only closed terms', { has_open_term: false, has_closed_term: true }, 'completed'],
    ['published, no terms', { has_open_term: false, has_closed_term: false }, 'open'],
  ] as const)('reads %s as %s', (_label, summary, expected) => {
    expect(mapMentorshipAdminHeaderProgram(header('published'), summary)).toMatchObject({ program: { status: expected }, unknownStatus: false });
  });

  it('reads a published program as open when the summary is missing', () => {
    expect(mapMentorshipAdminHeaderProgram(header('published')).program.status).toBe('open');
  });

  it.each([
    ['submitted', 'pending-review'],
    ['pending', 'pending-review'],
    ['rejected', 'rejected'],
    ['hidden', 'hidden'],
    ['archived', 'hidden'],
  ])('reads the unpublished status %s as %s', (status, expected) => {
    expect(mapMentorshipAdminHeaderProgram(header(status), { has_open_term: true, has_closed_term: false })).toMatchObject({
      program: { status: expected },
      unknownStatus: false,
    });
  });

  it.each(['mystery', 'constructor'])('reads the unknown status "%s" as pending-review and flags it', (status) => {
    expect(mapMentorshipAdminHeaderProgram(header(status))).toMatchObject({ program: { status: 'pending-review' }, unknownStatus: true });
  });

  it('maps the header fields, falling back to empty text and the id', () => {
    expect(mapMentorshipAdminHeaderProgram(header('published', { active_term: undefined })).program).toEqual({
      id: 'p-1',
      slug: 'program-one',
      name: 'Program One',
      projectName: 'Energy Project',
      term: '',
      status: 'open',
      stats: { mentors: 2, mentees: 3, graduated: 1 },
      createdOn: '2026-01-01T00:00:00Z',
      updatedOn: '2026-01-02T00:00:00Z',
    });
  });
});

const memberRow = (overrides: Partial<MentorshipUpstreamMemberManagementRow> = {}): MentorshipUpstreamMemberManagementRow => ({
  id: 'm-1',
  user_id: 'u-1',
  name: 'Ada Mentor',
  email: 'ada@example.com',
  username: 'ada',
  avatar_url: 'https://img.example/ada.png',
  status: 'active',
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
        status: 'active',
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
    ['active', 'active'],
    ['approved', 'active'],
    ['declined', 'declined'],
    ['withdrawn', 'withdrawn'],
  ])('reads upstream status %s as %s', (status, expected) => {
    expect(mapMentorshipAdminMentorRow(memberRow({ status }))).toMatchObject({ mentor: { status: expected }, unknownStatus: false });
  });

  it.each([undefined, 'mystery', 'constructor'])('reads the unknown status %s as pending and flags it', (status) => {
    expect(mapMentorshipAdminMentorRow(memberRow({ status }))).toMatchObject({ mentor: { status: 'pending' }, unknownStatus: true });
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
