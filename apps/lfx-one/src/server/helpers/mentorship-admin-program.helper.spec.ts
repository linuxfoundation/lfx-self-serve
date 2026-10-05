// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MentorshipUpstreamAdministeredProgram } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { mapMentorshipAdminProgram } from './mentorship-admin-program.helper';

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
