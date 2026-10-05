// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MentorshipUpstreamAdministeredProgram, MentorshipUpstreamProgramHeader } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { mapMentorshipAdminHeaderProgram, mapMentorshipAdminProgram } from './mentorship-admin-program.helper';

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
    ['draft', 'pending-review'],
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
